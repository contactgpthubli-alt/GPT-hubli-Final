/* =============================================================
 * GPT Hubli — Persistence Bridge
 * Loaded AFTER legacy-app.js. Connects the legacy in-memory app
 * to the real PostgreSQL backend via the /api routes:
 *   - Real auth (login modals, demo quick-login, logout, register)
 *   - Session restore on page load
 *   - Hydrates legacy data stores from the DB
 *   - Persists mutations (grievances, gallery, committees, results)
 * The legacy UI code is left untouched; globals are wrapped here.
 * ============================================================= */
function __initGptBridge() {
  'use strict';

  /* ---------- tiny fetch wrapper ---------- */
  async function apiReq(path, opts) {
    try {
      const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts));
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var msg = data && data.error ? data.error : 'Request failed (status ' + res.status + ')';
        console.error('[bridge] API error at ' + path, msg, data);
        alert('⚠️ ' + msg);
        return null;
      }
      return data;
    } catch (e) {
      console.error('[bridge] network error at ' + path, e);
      alert('⚠️ Network error. Please check your connection.');
      return null;
    }
  }
  const api = {
    get: function (p) { return apiReq(p); },
    post: function (p, body) { return apiReq(p, { method: 'POST', body: JSON.stringify(body || {}) }); },
    patch: function (p, body) { return apiReq(p, { method: 'PATCH', body: JSON.stringify(body || {}) }); },
    del: function (p) { return apiReq(p, { method: 'DELETE' }); },
  };
  window.api = api;

  var bypass = false; // when true, patched login/demoLogin delegate straight to originals
  var currentUser = null;

  /* ---------- keep original functions ---------- */
  var origLogin = window.login;
  var origDemoLogin = window.demoLogin;
  var origLogout = window.logout;
  var origResolveGrievance = window.resolveGrievance;
  var origSaveResultEntry = window.saveResultEntry;
  var origDeleteGalleryItem = window.deleteGalleryItem;
  var origRemoveMember = window.removeMember;

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return String(iso || ''); }
  }
  function safeCall(fn) {
    try { if (typeof fn === 'function') fn.apply(null, Array.prototype.slice.call(arguments, 1)); }
    catch (e) { console.error('[bridge] render error', e); }
  }

  /* ---------- hydration ---------- */
  async function hydratePublic() {
    // Gallery (public landing page)
    var g = await apiReqQuiet('/api/gallery');
    if (g && Array.isArray(g.items)) {
      try {
        galleryItems.length = 0;
        g.items.forEach(function (it) {
          galleryItems.push({
            id: Number(it.id), src: it.src, caption: it.caption, category: it.category,
            date: new Date(it.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          });
        });
        safeCall(window.renderAllGalleries);
      } catch (e) { console.error('[bridge] gallery hydrate', e); }
    }
    // Committees (public landing page)
    var c = await apiReqQuiet('/api/committees');
    if (c && Array.isArray(c.committees)) {
      try {
        Object.keys(committeeMembers).forEach(function (k) { delete committeeMembers[k]; });
        c.committees.forEach(function (cm) {
          committeeMembers[cm.name] = (cm.members || []).map(function (m) {
            return { id: Number(m.id), name: m.name, role: m.role, dept: m.dept, designation: m.designation || '—', mobile: m.mobile || '—', status: 'Approved' };
          });
        });
        safeCall(window.renderCommitteeGrid);
      } catch (e) { console.error('[bridge] committees hydrate', e); }
    }
  }

  // Quiet variant: no alert on 401 (used for hydration where auth is optional)
  async function apiReqQuiet(path) {
    try {
      var res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function hydratePrivate() {
    // Students
    var s = await apiReqQuiet('/api/students');
    if (s && Array.isArray(s.students)) {
      try {
        Object.keys(students).forEach(function (k) { delete students[k]; });
        s.students.forEach(function (st) {
          students[st.reg_no] = { name: st.name, dept: st.dept, year: st.year, cgpa: st.cgpa, att: st.att, father: st.father };
        });
      } catch (e) { console.error('[bridge] students hydrate', e); }
    }
    // Results
    var r = await apiReqQuiet('/api/results');
    if (r && Array.isArray(r.results)) {
      try {
        resultDB.length = 0;
        r.results.forEach(function (row) {
          resultDB.push({
            reg: row.reg, name: row.name, branch: row.branch, sem: Number(row.sem),
            session: row.session, subjects: row.subjects || [], sgpa: Number(row.sgpa), result: row.result,
          });
        });
      } catch (e) { console.error('[bridge] results hydrate', e); }
    }
    // Grievances
    var gr = await apiReqQuiet('/api/grievances');
    if (gr && Array.isArray(gr.grievances)) {
      try {
        grievances.length = 0;
        gr.grievances.forEach(function (g) {
          grievances.push({
            id: Number(g.id), subject: g.subject, category: g.category,
            desc: g.description, expect: g.expectation,
            status: g.status === 'Resolved' ? 'resolved' : 'open',
            submittedOn: fmtDate(g.created_at), resolution: g.resolution || '',
          });
        });
        safeCall(window.renderStuGrievances);
        safeCall(window.renderPriGrievances, 'all');
        safeCall(window.updatePriGrievanceCounts);
      } catch (e) { console.error('[bridge] grievances hydrate', e); }
    }
    // Pending account registrations (admin only)
    if (currentUser && currentUser.role === 'admin') renderAccountApprovals();
    // Certificate requests
    if (currentUser && currentUser.role === 'student') renderStuCertRequests();
    if (currentUser && ['exam', 'admin', 'acm', 'registrar'].indexOf(currentUser.role) !== -1) renderExamCertRequests();
  }

  /* ---------- admin: pending account registrations ---------- */
  function esc(t) {
    var d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML;
  }
  async function renderAccountApprovals() {
    var host = document.getElementById('adUserApprovals');
    if (!host) return;
    var data = await apiReqQuiet('/api/approvals');
    if (!data) return;
    var panel = document.getElementById('bridgeAccountApprovals');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bridgeAccountApprovals';
      host.insertBefore(panel, host.firstChild);
    }
    var pending = data.pending || [];
    var rows = pending.map(function (u) {
      return '<tr><td>' + esc(u.display_name) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.role) +
        '</td><td>' + esc(u.reg_no || '—') + '</td>' +
        '<td><button class="btn btn-sm" style="background:#065f46;color:#fff;margin-right:6px" onclick="bridgeDecideAccount(' + u.id + ',\'approved\')">Approve</button>' +
        '<button class="btn btn-sm" style="background:#991b1b;color:#fff" onclick="bridgeDecideAccount(' + u.id + ',\'rejected\')">Reject</button></td></tr>';
    }).join('');
    panel.innerHTML =
      '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 10px">Pending Account Registrations (' + pending.length + ')</h3>' +
      (pending.length
        ? '<table class="tbl" style="width:100%"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Reg No</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : '<p style="opacity:.7;margin:0">No pending registrations.</p>') +
      '</div>';
    updateApprovalsBadge(pending.length);
  }

  /* Notification badge with pending count on the admin sidebar links */
  function updateApprovalsBadge(count) {
    var links = document.querySelectorAll('#dbAdmin .sl');
    links.forEach(function (link) {
      if (link.textContent.indexOf('Account Approvals') === -1 && link.textContent.indexOf('Approvals') === -1) return;
      var badge = link.querySelector('.bridge-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bridge-badge';
        badge.style.cssText = 'display:inline-block;min-width:18px;padding:1px 6px;margin-left:8px;border-radius:9px;background:#dc2626;color:#fff;font-size:0.68rem;font-weight:700;text-align:center;vertical-align:middle;';
        link.appendChild(badge);
      }
      badge.textContent = String(count);
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    });
  }

  /* Poll for new registrations while an admin session is active so the badge stays fresh */
  setInterval(function () {
    if (currentUser && currentUser.role === 'admin') renderAccountApprovals();
  }, 30000);
  window.bridgeDecideAccount = async function (id, action) {
    var res = await api.post('/api/approvals', { id: id, action: action });
    if (res && res.ok) renderAccountApprovals();
  };

  // Refresh live pending registrations every time the admin opens an approvals section
  (function hookShowSec() {
    var origShowSec = window.showSec;
    if (typeof origShowSec !== 'function') return;
    window.showSec = function (secId, linkEl) {
      origShowSec(secId, linkEl);
      if ((secId === 'adUserApprovals' || secId === 'adApprovals') && currentUser && currentUser.role === 'admin') {
        renderAccountApprovals();
        var apHost = document.getElementById('adApprovals');
        if (secId === 'adApprovals' && apHost && !document.getElementById('bridgeApprovalsHint')) {
          var hint = document.createElement('div');
          hint.id = 'bridgeApprovalsHint';
          hint.className = 'info-box';
          hint.innerHTML = 'ℹ️ <strong>Account registrations</strong> (new Faculty/Student/Principal accounts) are shown under <strong>System → Account Approvals</strong> in the sidebar.';
          apHost.insertBefore(hint, apHost.firstChild);
        }
      }
    };
  })();

  /* ---------- auth ---------- */
  // Maps demo-bar UI roles to seeded server roles.
  function serverRole(uiRole) { return uiRole === 'teaching' ? 'faculty' : uiRole; }

  function openDashboardFor(user) {
    var role = user.role;
    if (user.reg_no) { window.STU_REG_NO = user.reg_no; } // keep student modules pointed at the real logged-in student
    bypass = true;
    try {
      if (role === 'student' || role === 'admin' || role === 'principal') origLogin(role);
      else origDemoLogin(role); // faculty-family roles configure the faculty sidebar
    } finally { bypass = false; }
    if (user.force_password_change) {
      alert('🔐 For security, please change your default password now (Profile → Change Password).');
    }
  }

  window.demoLogin = async function (role) {
    if ((window.__GPT_CONFIG || {}).demoLoginEnabled === false) { alert('Demo login is disabled.'); return; }
    var res = await api.post('/api/auth/demo-login', { role: serverRole(role) });
    if (!res || !res.user) return;
    currentUser = res.user;
    bypass = true;
    try { origDemoLogin(role); } finally { bypass = false; }
    hydratePrivate();
  };

  window.login = async function (role) {
    if (bypass) return origLogin(role);
    var modalMap = { student: 'mStudent', faculty: 'mFaculty', principal: 'mPrincipal', admin: 'mAdmin' };
    var modalId = modalMap[role];
    var modal = document.getElementById(modalId);
    if (!modal) {
      console.error('[bridge] Login modal not found:', modalId);
      alert('⚠️ Login system error: modal not found.');
      return;
    }
    // Read credentials from the Login panel only (not Create Account fields).
    var loginPanel = modal.querySelector('div[id$="Login"]');
    var scope = loginPanel || modal;
    var idInput = scope.querySelector('input[type="text"], input[type="email"]');
    var pwInput = scope.querySelector('input[type="password"]');
    var identifier = idInput ? idInput.value.trim() : '';
    var password = pwInput ? pwInput.value : '';
    if (!identifier || !password) {
      alert('Please enter your login ID and password.');
      if (idInput && !identifier) idInput.focus();
      else if (pwInput) pwInput.focus();
      return;
    }
    var res = await api.post('/api/auth/login', { email: identifier, password: password });
    if (!res || !res.user) return;
    currentUser = res.user;
    if (pwInput) pwInput.value = '';
    openDashboardFor(res.user);
    hydratePrivate();
  };

  window.logout = function () {
    api.post('/api/auth/logout');
    currentUser = null;
    origLogout();
  };

  /* ---------- registration (Create Account tabs) ----------
   * The legacy submit buttons call createAccount('Student'|'Faculty'|'Principal'|'Admin'),
   * so we replace that function with a real API-backed implementation. */
  var REGISTER_PANELS = { Student: 'stuRegister', Faculty: 'facRegister', Principal: 'priRegister', Admin: 'adRegister' };
  // Map the Faculty page's "Assign Role" select values to real account roles.
  var FACULTY_ROLE_MAP = {
    principal: 'principal', hod: 'hod', teaching: 'faculty', nonteaching: 'faculty', guest: 'faculty',
    registrar: 'registrar', superintendent: 'registrar', acm: 'acm', exam: 'exam', accounts: 'accounts',
    library: 'library', stores: 'stores', est: 'est', cash: 'cash', placement: 'placement',
    nss: 'nss', yrc: 'yrc', alumni: 'alumni', sports: 'sports', swo: 'welfare',
  };
  window.createAccount = async function (type) {
    var box = document.getElementById(REGISTER_PANELS[type] || '');
    if (!box) { alert('Registration form not found.'); return; }

    // Resolve the account role
    var role = type === 'Student' ? 'student' : type === 'Principal' ? 'principal' : type === 'Admin' ? 'admin' : '';
    if (type === 'Faculty') {
      var roleSelect = document.getElementById('facRoleSelect');
      var roleVal = roleSelect ? roleSelect.value : '';
      if (!roleVal) { alert('⚠️ Please select a Role before creating the account.'); return; }
      role = FACULTY_ROLE_MAP[roleVal] || 'faculty';
    }

    // Collect form fields by their labels
    var name = '', email = '', pass = '', passConfirm = '', regNo = '';
    var pwCount = 0;
    box.querySelectorAll('input').forEach(function (inp) {
      var fg = inp.closest('.fg');
      var label = (fg ? (fg.querySelector('label') || {}).textContent : '') || '';
      var l = label.toLowerCase();
      if (inp.type === 'password') {
        pwCount++;
        if (pwCount === 1) pass = inp.value;
        else if (pwCount === 2) passConfirm = inp.value;
      } else if (inp.type === 'email' || l.indexOf('email') !== -1) email = inp.value.trim();
      else if (l.indexOf('full name') !== -1 || (l.indexOf('name') !== -1 && !name)) name = inp.value.trim();
      else if (l.indexOf('register number') !== -1) regNo = inp.value.trim().toUpperCase();
    });

    if (!name || !email) { alert('Please fill in your full name and email address.'); return; }
    if (pwCount >= 1 && !pass) { alert('Please set a password.'); return; }
    if (pwCount >= 2 && pass !== passConfirm) { alert('Passwords do not match.'); return; }
    if (pass && pass.length < 8) { alert('Password must be at least 8 characters.'); return; }
    if (type === 'Student' && !regNo) { alert('Please enter your Register Number.'); return; }

    var payload = { name: name, email: email, role: role, regNo: regNo || undefined };
    if (pass) payload.password = pass; // Faculty form has no password field -> server assigns a temporary password
    var res = await api.post('/api/auth/register', payload);
    if (!res) return;
    alert(
      '📋 ' + type + ' account request submitted!\n\nRole Requested: ' + role +
      '\n\n⏳ STATUS: PENDING ROOT ADMIN APPROVAL\n\nYour account will be activated only after the Root Admin approves it.' +
      (pass ? '' : '\n\nA temporary password will be assigned after approval. Please change it on first login.')
    );
    box.querySelectorAll('input').forEach(function (inp) { inp.value = ''; });
    document.querySelectorAll('.overlay').forEach(function (o) { o.classList.remove('open'); });
    // If an admin is logged in in another tab/section, the approvals panel refreshes on open.
  };

  /* ---------- grievances ---------- */
  window.submitGrievance = async function () {
    var subject = document.getElementById('grievSubject').value.trim();
    var category = document.getElementById('grievCategory').value;
    var desc = document.getElementById('grievDesc').value.trim();
    var expect = document.getElementById('grievExpect').value.trim();
    if (!subject || !category || !desc) { alert('Please fill in all required fields.'); return; }
    var res = await api.post('/api/grievances', { subject: subject, category: category, description: desc, expectation: expect });
    if (!res || !res.grievance) return;
    var g = res.grievance;
    grievances.push({
      id: Number(g.id), subject: g.subject, category: g.category, desc: g.description, expect: g.expectation,
      status: 'open', submittedOn: fmtDate(g.created_at), resolution: '',
    });
    ['grievSubject', 'grievCategory', 'grievDesc', 'grievExpect'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    safeCall(window.renderStuGrievances);
    safeCall(window.renderPriGrievances, 'all');
    safeCall(window.updatePriGrievanceCounts);
    alert('✅ Grievance submitted successfully! Only the Principal can view this. You will be notified via Email once resolved.');
  };

  window.resolveGrievance = function (btn) {
    var card = btn.closest('.griev-card');
    var remarksInput = card ? card.querySelector('.grievResRemarks') : null;
    var remarks = remarksInput ? remarksInput.value.trim() : '';
    var gid = btn.dataset.gid;
    origResolveGrievance(btn);
    if (gid && gid !== 'undefined' && remarks) {
      api.patch('/api/grievances', { id: Number(gid), status: 'Resolved', resolution: remarks });
    }
  };

  /* ---------- certificate requests (TC / Study / NOC / PDC) ---------- */
  function certStatusBadge(status) {
    if (status === 'ready') return '<span class="badge approved">✅ Ready for Collection</span>';
    if (status === 'rejected') return '<span class="badge" style="background:#991b1b;color:#fff">❌ Rejected</span>';
    if (status === 'collected') return '<span class="badge approved">✅ Collected</span>';
    return '<span class="badge pending">⏳ Under Review</span>';
  }

  // Student "My Requests" table
  async function renderStuCertRequests() {
    var tbody = document.getElementById('stuCertReqBody');
    if (!tbody) return;
    var data = await apiReqQuiet('/api/cert-requests');
    if (!data || !Array.isArray(data.requests)) return;
    tbody.innerHTML = data.requests.map(function (r) {
      var badgeColor = r.routed_to === 'Exam Cell' ? '#be185d' : '#1d4ed8';
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;">' + esc(r.req_code) +
        '</td><td><strong>' + esc(r.cert_type) + '</strong></td><td>' + esc(fmtDate(r.created_at)) +
        '</td><td><span class="badge info" style="background:' + badgeColor + ';color:white;">' + esc(r.routed_to) +
        '</span></td><td>' + certStatusBadge(r.status) + '</td><td>' + esc(r.remarks || '—') + '</td></tr>';
    }).join('') || '<tr><td colspan="6" style="opacity:.7">No requests yet.</td></tr>';
  }

  // Exam Cell "Student PDC Requests" table
  async function renderExamCertRequests() {
    var sec = document.getElementById('facExPDC');
    if (!sec) return;
    var tbody = sec.querySelector('tbody');
    if (!tbody) return;
    var data = await apiReqQuiet('/api/cert-requests');
    if (!data || !Array.isArray(data.requests)) return;
    var reqs = data.requests.filter(function (r) { return r.routed_to === 'Exam Cell'; });
    tbody.innerHTML = reqs.map(function (r) {
      var action = r.status === 'pending'
        ? '<button class="btn btn-sm" style="background:#065f46;color:#fff;margin-right:6px" onclick="bridgeUpdateCertReq(' + r.id + ',\'ready\')">Mark Ready</button>' +
          '<button class="btn btn-sm" style="background:#991b1b;color:#fff" onclick="bridgeUpdateCertReq(' + r.id + ',\'rejected\')">Reject</button>'
        : certStatusBadge(r.status);
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;">' + esc(r.req_code) +
        '</td><td>' + esc(r.student_name) + '</td><td>' + esc(r.reg_no) + '</td><td>' + esc(r.branch || '—') +
        '</td><td>—</td><td>' + esc(r.cert_type) + '</td><td>' + esc(fmtDate(r.created_at)) +
        '</td><td>' + certStatusBadge(r.status) + '</td><td>' + action + '</td></tr>';
    }).join('') || '<tr><td colspan="9" style="opacity:.7">No incoming requests.</td></tr>';
    // Update the "N Pending" badge in the section header
    var badge = sec.querySelector('.card-acts .badge');
    if (badge) badge.textContent = reqs.filter(function (r) { return r.status === 'pending'; }).length + ' Pending';
  }

  window.bridgeUpdateCertReq = async function (id, status) {
    var remarks = status === 'ready' ? 'Certificate ready. Collect from Exam Cell.' :
      status === 'rejected' ? 'Request rejected. Contact Exam Cell for details.' : null;
    var res = await api.patch('/api/cert-requests', { id: id, status: status, remarks: remarks });
    if (res && res.ok) renderExamCertRequests();
  };

  window.submitCertRequest = async function (certType, routedTo) {
    var res = await api.post('/api/cert-requests', { certType: certType, routedTo: routedTo });
    if (!res || !res.request) return;
    await renderStuCertRequests();
    alert('✅ ' + certType + ' request submitted!\n\nRequest ID: ' + res.request.req_code +
      '\nRouted to: ' + routedTo + '\n\nYou will be notified via WhatsApp & Email once ready.\n' +
      (routedTo === 'Exam Cell' ? 'Processing time: 5-7 working days (eligibility check by Exam Cell)' : 'Processing time: 1-3 working days'));
    safeCall(window.showStuCertTab, 'scMyReqs', document.querySelector('#stuCertTabs .tab:last-child'));
  };

  /* ---------- gallery ---------- */
  window.addGalleryItem = function () {
    var caption = document.getElementById('galleryCaption').value.trim();
    var category = document.getElementById('galleryCategory').value;
    var picker = document.getElementById('galleryFilePicker');
    if (!caption) { alert('Please enter a caption/event name for the photo.'); return; }
    if (!picker.files || picker.files.length === 0) { alert('Please select a photo file first.'); return; }
    var file = picker.files[0];
    var reader = new FileReader();
    reader.onload = async function (e) {
      var res = await api.post('/api/gallery', { src: e.target.result, caption: caption, category: category });
      if (!res || !res.item) return;
      galleryItems.push({
        id: Number(res.item.id), src: res.item.src, caption: res.item.caption, category: res.item.category,
        date: new Date(res.item.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      });
      safeCall(window.renderAllGalleries);
      document.getElementById('galleryCaption').value = '';
      picker.value = '';
      alert('✅ Photo added to gallery! All users can now view it.');
    };
    reader.readAsDataURL(file);
  };

  window.deleteGalleryItem = function (id) {
    if (!confirm('Delete this photo from the gallery?')) return;
    api.del('/api/gallery?id=' + encodeURIComponent(id));
    galleryItems = galleryItems.filter(function (i) { return i.id !== id; });
    safeCall(window.renderAllGalleries);
  };

  /* ---------- committees ---------- */
  window.addCommitteeMember = async function () {
    var name = document.getElementById('cmTitle').textContent;
    var mname = document.getElementById('cmMName').value.trim();
    var mdesig = document.getElementById('cmMDesig').value.trim();
    var mdept = document.getElementById('cmMDept').value.trim();
    var mrole = document.getElementById('cmMRole').value.trim();
    var mmob = document.getElementById('cmMMob').value.trim();
    if (!mname) { alert('⚠️ Please enter the member\'s full name.'); document.getElementById('cmMName').focus(); return; }
    if (!mdesig) { alert('⚠️ Please enter the member\'s designation.'); document.getElementById('cmMDesig').focus(); return; }
    if (!mdept) { alert('⚠️ Please enter the branch / department.'); document.getElementById('cmMDept').focus(); return; }
    if (!mrole) { alert('⚠️ Please enter the role in committee.'); document.getElementById('cmMRole').focus(); return; }
    var res = await api.post('/api/committees', { committee: name, name: mname, role: mrole, dept: mdept, designation: mdesig, mobile: mmob });
    if (!res || !res.member) return;
    if (!committeeMembers[name]) committeeMembers[name] = [];
    committeeMembers[name].push({ id: Number(res.member.id), name: mname, role: mrole, dept: mdept, designation: mdesig, mobile: mmob || '—', status: 'Pending' });
    ['cmMName', 'cmMDesig', 'cmMDept', 'cmMRole', 'cmMMob'].forEach(function (id) { document.getElementById(id).value = ''; });
    safeCall(window.renderCommitteeMembers, name);
    var btn = document.querySelector('#cmAddSection button[onclick="addCommitteeMember()"]');
    if (btn) {
      var orig = btn.innerHTML; btn.innerHTML = '✅ Member Added — Pending Principal Approval';
      btn.style.background = '#065f46'; btn.disabled = true;
      setTimeout(function () { btn.innerHTML = orig; btn.style.background = ''; btn.disabled = false; }, 2500);
    }
  };

  window.removeMember = function (cname, idx) {
    if (!confirm('Remove this member from the committee?')) return;
    var member = (committeeMembers[cname] || [])[idx];
    if (member && member.id) api.del('/api/committees?id=' + encodeURIComponent(member.id));
    committeeMembers[cname].splice(idx, 1);
    safeCall(window.renderCommitteeMembers, cname);
  };

  /* ---------- results ---------- */
  function persistResult(reg, sem, session) {
    var row = resultDB.find(function (r) { return r.reg === reg && r.sem === sem && r.session === session; });
    if (!row) return;
    api.post('/api/results', {
      reg: row.reg, name: row.name, branch: row.branch, sem: row.sem,
      session: row.session, sgpa: row.sgpa, result: row.result, subjects: row.subjects || [],
    });
  }

  window.saveResultEntry = function () {
    var reg = document.getElementById('arReg').value.trim().toUpperCase();
    var sem = parseInt(document.getElementById('arSem').value);
    var session = document.getElementById('arSession').value;
    origSaveResultEntry();
    if (reg && sem && session) persistResult(reg, sem, session);
  };

  if (typeof window.saveEditedResult === 'function') {
    var origSaveEditedResult = window.saveEditedResult;
    window.saveEditedResult = function () {
      var reg = document.getElementById('editResReg').value.trim().toUpperCase();
      var sem = parseInt(document.getElementById('editResSem').value);
      var session = document.getElementById('editResSession').value;
      origSaveEditedResult();
      if (reg && sem && session) persistResult(reg, sem, session);
    };
  }

  /* ---------- boot: session restore + hydration ---------- */
  function hideDemoBarIfDisabled() {
    var cfg = window.__GPT_CONFIG || {};
    if (cfg.demoLoginEnabled === false) {
      var bar = document.querySelector('.demo-bar, #demoBar, [class*="demo-quick"]');
      if (!bar) {
        // fallback: find the container holding demoLogin buttons
        var b = document.querySelector('button[onclick*="demoLogin"]');
        if (b) bar = b.closest('div');
      }
      if (bar) bar.style.display = 'none';
    }
  }

  setTimeout(async function () {
    hideDemoBarIfDisabled();
    /* registration is handled by the window.createAccount override above */
    hydratePublic();
    var me = await apiReqQuiet('/api/auth/me');
    if (me && me.user) {
      currentUser = me.user;
      openDashboardFor(me.user);
      hydratePrivate();
    }
  }, 50);
}

/* Boot: wait until legacy-app.js has defined its globals before wrapping them. */
(function bridgeBoot(attempt) {
  attempt = attempt || 0;
  if (typeof window.login === 'function' && typeof window.demoLogin === 'function') {
    try { __initGptBridge(); } catch (e) { console.error('[bridge] init failed', e); }
    return;
  }
  if (attempt > 100) { console.error('[bridge] legacy app never became ready'); return; }
  setTimeout(function () { bridgeBoot(attempt + 1); }, 100);
})(0);

/* ================================================================
   PROFILE EDIT REQUESTS — real backend wiring (student -> DB)
   ================================================================ */
async function submitStuProfileUpdate() {
  var container = document.getElementById('stuDynamicProfileSections');
  if (!container) { alert('Profile section not found.'); return; }
  var changes = {};
  container.querySelectorAll('.fg').forEach(function (fg) {
    var label = fg.querySelector('label');
    var field = fg.querySelector('input, textarea');
    if (!label || !field) return;
    if (field.hasAttribute('readonly') || field.disabled) return; // not editable
    var labelText = label.textContent.replace(/✏️.*$/, '').trim();
    changes[labelText] = field.value;
  });
  if (Object.keys(changes).length === 0) {
    alert('No editable fields found to update.');
    return;
  }
  var regNo = (window.currentUser && window.currentUser.reg_no) || null;
  if (!regNo) { alert('Could not identify your registration number. Please contact admin.'); return; }
  var res = await api.post('/api/profile-requests', { targetType: 'student', targetId: regNo, changes: changes });
  if (res && res.ok) {
    alert('✅ Update request submitted! Awaiting Admin/HOD approval. You will be notified once reviewed.');
  }
}
window.submitStuProfileUpdate = submitStuProfileUpdate;

function profileChangesSummary(changes) {
  return Object.keys(changes).map(function (k) { return '<strong>' + k + ':</strong> ' + (changes[k] || '—'); }).join('<br>');
}

async function renderProfileRequestApprovals() {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'hod')) return;
  var containerId = currentUser.role === 'admin' ? 'adApprovals' : 'facApprovals';
  var host = document.getElementById(containerId);
  if (!host) return;
  var data = await apiReqQuiet('/api/profile-requests');
  if (!data) return;
  var pending = data.pending || [];
  var panel = document.getElementById('bridgeProfileRequests');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'bridgeProfileRequests';
    panel.className = 'card';
    panel.style.marginBottom = '18px';
    panel.style.borderLeft = '4px solid #1a4fa0';
    host.insertBefore(panel, host.firstChild);
  }
  if (pending.length === 0) {
    panel.innerHTML = '';
    return;
  }
  var rows = pending.map(function (r) {
    return '<tr>' +
      '<td>' + r.requester_name + ' <span style="color:var(--text-muted);font-size:0.7rem;">(' + r.requester_role + ')</span></td>' +
      '<td>' + r.target_type + '</td>' +
      '<td>' + r.target_id + '</td>' +
      '<td style="font-size:0.75rem;">' + profileChangesSummary(r.changes) + '</td>' +
      '<td>' + new Date(r.created_at).toLocaleDateString('en-IN') + '</td>' +
      '<td><div style="display:flex;gap:5px;">' +
      '<button class="btn gr" onclick="reviewProfileRequest(' + r.id + ',\'approved\')">✓ Approve</button>' +
      '<button class="btn re" onclick="reviewProfileRequest(' + r.id + ',\'rejected\')">✕ Reject</button>' +
      '</div></td>' +
      '</tr>';
  }).join('');
  panel.innerHTML =
    '<div class="card-hd"><h3>👤 Profile Update Requests</h3><span class="badge pending">' + pending.length + ' Pending</span></div>' +
    '<table><thead><tr><th>Requester</th><th>Type</th><th>Target</th><th>Requested Changes</th><th>Submitted</th><th>Action</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
}
window.renderProfileRequestApprovals = renderProfileRequestApprovals;

async function reviewProfileRequest(id, action) {
  var res = await fetch('/api/profile-requests', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id: id, action: action }),
  }).then(function (r) { return r.json(); }).catch(function () { return null; });
  if (res && res.ok) {
    renderProfileRequestApprovals();
  } else {
    alert('Failed to update request. ' + (res && res.error ? res.error : ''));
  }
}
window.reviewProfileRequest = reviewProfileRequest;

// Poll while an admin/HOD session is active so new requests show up without a refresh.
setInterval(function () {
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'hod')) {
    renderProfileRequestApprovals();
  }
}, 4000);
