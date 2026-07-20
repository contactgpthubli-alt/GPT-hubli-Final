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
  function setCurrentUser(user) {
    currentUser = user;
    window.currentUser = user; // profile / approval modules read this global
  }
  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function academicYearLabel() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth(); // 0-based; academic year typically starts in June/July
    var start = m >= 5 ? y : y - 1;
    return start + '–' + String(start + 1).slice(-2);
  }
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text == null || text === '' ? '—' : String(text);
  }
  function setTrend(id, text, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'kpi-trend' + (kind ? ' ' + kind : '');
  }
  function parseAttPct(att) {
    if (att == null || att === '') return null;
    var n = parseFloat(String(att).replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  }

  /** Fill student dashboard / header / attendance from the real students row + live counts. */
  async function paintStudentDashboard(user) {
    if (!user || user.role !== 'student') return;
    var name = user.display_name || 'Student';
    var reg = user.reg_no || window.STU_REG_NO || '';
    var stu = (reg && typeof students !== 'undefined' && students[reg]) ? students[reg] : null;
    // Always re-fetch own student row so approved profile data is not stale
    try {
      var s = await apiReqQuiet('/api/students');
      if (s && Array.isArray(s.students) && s.students.length) {
        var row = s.students[0];
        stu = {
          name: row.name, dept: row.dept, year: row.year, cgpa: row.cgpa, att: row.att, father: row.father,
          extra: row.extra || {},
        };
        if (typeof students !== 'undefined') students[row.reg_no || reg] = stu;
        if (row.reg_no) reg = row.reg_no;
      }
    } catch (e) { /* keep cached stu */ }
    // Paint My Profile fields from DB (approved extra + core columns)
    if (stu && typeof window.applyLiveStudentProfile === 'function') {
      window.applyLiveStudentProfile(stu, reg || (stu && stu.reg_no) || '');
    }
    if (stu && stu.name) name = stu.name;

    setText('stuUname', name);
    var ava = document.getElementById('stuAva');
    // Prefer approved photo already applied by applyLiveStudentProfile; else initials
    if (ava && !ava.querySelector('img')) ava.textContent = initialsOf(name);
    setText('stuWelcomeName', 'Hello, ' + name + ' 👋');

    var metaParts = [];
    if (reg) metaParts.push(reg);
    if (stu && stu.dept) metaParts.push(stu.dept);
    if (stu && stu.year) metaParts.push(stu.year);
    metaParts.push(academicYearLabel());
    setText('stuWelcomeMeta', metaParts.length ? metaParts.join(' · ') : '—');

    // Profile page header (same real record — no hard-coded CSE / year)
    setText('stuProfileName', name);
    var profMeta = [];
    if (reg) profMeta.push(reg);
    if (stu && stu.dept) profMeta.push(stu.dept);
    if (stu && stu.year) profMeta.push(stu.year);
    setText('stuProfileMeta', profMeta.length ? profMeta.join(' · ') : '—');

    var cgpa = stu && stu.cgpa != null && String(stu.cgpa).trim() !== '' ? String(stu.cgpa) : null;
    setText('stuKpiCgpa', cgpa || '—');
    if (cgpa) {
      var cg = parseFloat(cgpa);
      setTrend('stuKpiCgpaTrend', cg >= 7 ? '↑ Good Standing' : cg >= 5 ? '→ Average' : '↓ Needs attention', cg >= 7 ? 'up' : cg >= 5 ? '' : 'dn');
    } else {
      setTrend('stuKpiCgpaTrend', 'No data yet', '');
    }

    var attRaw = stu && stu.att != null ? String(stu.att).trim() : '';
    var attPct = parseAttPct(attRaw);
    var attLabel = attRaw ? (attRaw.indexOf('%') >= 0 ? attRaw : attRaw + '%') : null;
    setText('stuKpiAtt', attLabel || '—');
    if (attPct != null) {
      setTrend('stuKpiAttTrend', attPct >= 75 ? '↑ Above minimum' : '↓ Below 75% minimum', attPct >= 75 ? 'up' : 'dn');
    } else {
      setTrend('stuKpiAttTrend', 'No data yet', '');
    }

    // Attendance page ring
    setText('stuAttRingInner', attLabel || '—');
    var note = document.getElementById('stuAttRingNote');
    if (note) {
      note.textContent = attPct != null
        ? (attPct >= 75 ? 'Above minimum 75% threshold' : 'Below minimum 75% threshold')
        : 'Attendance will appear once marked by faculty';
    }
    var ring = document.getElementById('stuAttRing');
    if (ring && attPct != null) {
      ring.style.background = 'conic-gradient(var(--green) 0% ' + attPct + '%, var(--bg) ' + attPct + '% 100%)';
    }

    // Force-password banner only when required
    var forcePw = document.getElementById('stuForcePw');
    if (forcePw) forcePw.style.display = user.force_password_change ? '' : 'none';

    // Live counts: open forms not yet submitted by this user; own pending profile requests
    var pendingForms = 0;
    var pendingApprovals = 0;
    try {
      var formsData = await apiReqQuiet('/api/forms');
      if (formsData && Array.isArray(formsData.forms)) {
        pendingForms = formsData.forms.filter(function (f) {
          return f.status === 'open' && !f.submitted_by_me;
        }).length;
      }
    } catch (e) { /* ignore */ }
    try {
      var pr = await apiReqQuiet('/api/profile-requests?mine=1');
      if (pr && typeof pr.mine_pending === 'number') pendingApprovals = pr.mine_pending;
      else if (pr && Array.isArray(pr.pending)) pendingApprovals = pr.pending.length;
    } catch (e) { /* ignore */ }

    // If student.cgpa is empty, derive a simple average from loaded results
    if ((!cgpa || cgpa === '—') && reg && typeof resultDB !== 'undefined' && Array.isArray(resultDB)) {
      var mineRes = resultDB.filter(function (r) { return r.reg === reg && r.sgpa != null; });
      if (mineRes.length) {
        var sum = 0;
        mineRes.forEach(function (r) { sum += Number(r.sgpa) || 0; });
        cgpa = (sum / mineRes.length).toFixed(2);
        setText('stuKpiCgpa', cgpa);
        var cg2 = parseFloat(cgpa);
        setTrend('stuKpiCgpaTrend', cg2 >= 7 ? '↑ Good Standing' : cg2 >= 5 ? '→ Average' : '↓ Needs attention', cg2 >= 7 ? 'up' : cg2 >= 5 ? '' : 'dn');
      }
    }

    setText('stuKpiForms', String(pendingForms));
    setTrend('stuKpiFormsTrend', pendingForms > 0 ? '⚠ Submit soon' : 'All clear', pendingForms > 0 ? 'dn' : 'up');
    setText('stuKpiApprovals', String(pendingApprovals));
    setTrend('stuKpiApprovalsTrend', pendingApprovals > 0 ? 'Under review' : 'None pending', pendingApprovals > 0 ? 'dn' : '');

    var notif = document.getElementById('stuNotifDot');
    if (notif) {
      var n = pendingForms + pendingApprovals + (user.force_password_change ? 1 : 0);
      notif.textContent = String(n);
      notif.style.display = n > 0 ? '' : 'none';
    }
  }

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

  async function loadStudentProfileSchema(forceReload) {
    try {
      var data = await apiReqQuiet('/api/profile-schema?key=student&_ts=' + Date.now());
      if (data && Array.isArray(data.schema) && data.schema.length) {
        if (typeof stuProfileSchema !== 'undefined') {
          // Replace in place so all references stay valid
          stuProfileSchema.length = 0;
          data.schema.forEach(function (sec) { stuProfileSchema.push(sec); });
        } else {
          window.stuProfileSchema = data.schema.slice();
        }
        console.log('[bridge] student profile schema loaded from', data.source || 'db',
          '· sections', data.schema.length);
        if (typeof window.renderStuBuilder === 'function') window.renderStuBuilder();
        if (typeof window.renderStuDynamicProfile === 'function') window.renderStuDynamicProfile();
        if (typeof window.renderStuPreview === 'function') window.renderStuPreview();
        var st = document.getElementById('stuSchemaSaveStatus');
        if (st && !forceReload) {
          st.textContent = 'Loaded from database';
          st.style.color = '#065f46';
        }
        if (forceReload && st) {
          st.textContent = 'Reloaded from database';
          st.style.color = '#065f46';
        }
        return data.schema;
      }
      console.log('[bridge] no saved student schema — using defaults');
      if (typeof window.renderStuBuilder === 'function') window.renderStuBuilder();
      return null;
    } catch (e) {
      console.error('[bridge] loadStudentProfileSchema', e);
      return null;
    }
  }
  window.loadStudentProfileSchema = loadStudentProfileSchema;

  async function hydratePrivate() {
    // Student My Profile form structure (Admin builder → DB)
    await loadStudentProfileSchema(false);
    // Students
    var s = await apiReqQuiet('/api/students');
    if (s && Array.isArray(s.students)) {
      try {
        Object.keys(students).forEach(function (k) { delete students[k]; });
        s.students.forEach(function (st) {
          var reg = st.reg_no;
          if (!reg) return; // account without reg number — skip legacy map key
          students[reg] = {
            name: st.name, dept: st.dept, year: st.year, cgpa: st.cgpa, att: st.att, father: st.father,
            extra: st.extra || {},
          };
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
    // Pending account registrations (admin / principal / HOD)
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'principal' || currentUser.role === 'hod')) {
      ensureAccountApprovalPanels();
      renderAccountApprovals();
    }
    // Certificate requests
    if (currentUser && currentUser.role === 'student') {
      renderStuCertRequests();
      if (typeof window.prefillStudentCertForms === 'function') window.prefillStudentCertForms();
      startStuCertPolling();
    }
    if (currentUser && ['exam', 'admin', 'acm', 'registrar'].indexOf(currentUser.role) !== -1) renderExamCertRequests();
    if (currentUser && (currentUser.role === 'acm' || currentUser.role === 'admin') &&
        typeof window.renderAcmModule === 'function') {
      window.renderAcmModule();
    }
  }

  /* ---------- admin: pending account registrations ---------- */
  function esc(t) {
    var d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML;
  }
  function readUrlFilter(key) {
    try { return new URL(window.location.href).searchParams.get(key) || ''; }
    catch (e) { return ''; }
  }
  function writeUrlFilters(map) {
    try {
      var url = new URL(window.location.href);
      Object.keys(map).forEach(function (k) {
        var v = map[k];
        if (v == null || v === '') url.searchParams.delete(k);
        else url.searchParams.set(k, String(v));
      });
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch (e) { /* ignore */ }
  }

  function accountStatusBadgeHtml(status) {
    if (status === 'approved') return '<span class="badge active">Approved</span>';
    if (status === 'pending') return '<span class="badge pending">Pending</span>';
    if (status === 'rejected') return '<span class="badge" style="background:#fee2e2;color:#991b1b;">Rejected</span>';
    return '<span class="badge">' + esc(status || '—') + '</span>';
  }

  /**
   * Ensure Principal + HOD have Account Approvals nav + host panels
   * (Admin already has adUserApprovals in markup).
   */
  function ensureAccountApprovalPanels() {
    // ---- Principal ----
    var priMenu = document.querySelector('#dbPrincipal .sb-menu');
    if (priMenu && !document.getElementById('priUserApprovalsNav')) {
      var insertAfter = null;
      priMenu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('priPending') !== -1 || oc.indexOf('priHome') !== -1) insertAfter = sl;
      });
      var nav = document.createElement('div');
      nav.className = 'sl';
      nav.id = 'priUserApprovalsNav';
      nav.setAttribute('onclick', "showSec('priUserApprovals',this)");
      nav.innerHTML = '<span class="sli">✅</span>Account Approvals';
      if (insertAfter && insertAfter.nextSibling) {
        insertAfter.parentNode.insertBefore(nav, insertAfter.nextSibling);
      } else if (insertAfter) {
        insertAfter.parentNode.appendChild(nav);
      } else {
        priMenu.appendChild(nav);
      }
    }
    var priContent = document.querySelector('#dbPrincipal .db-content');
    if (priContent && !document.getElementById('priUserApprovals')) {
      var pPanel = document.createElement('div');
      pPanel.id = 'priUserApprovals';
      pPanel.style.display = 'none';
      pPanel.innerHTML =
        '<div class="info-box">✅ <strong>Account Approvals</strong> — Same as Root Admin: approve or reject pending student and staff registrations for the whole institute.</div>' +
        '<div id="bridgeAccountApprovalsPri"><div class="card"><p style="opacity:.7;margin:16px;">Loading accounts…</p></div></div>';
      priContent.appendChild(pPanel);
    }

    // ---- HOD (faculty shell) ----
    var facMenu = document.querySelector('#dbFaculty .sb-menu');
    if (facMenu && !document.getElementById('facUserApprovalsNav')) {
      var facInsert = null;
      facMenu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        var df = sl.getAttribute('data-fac') || '';
        if (oc.indexOf('facApprovals') !== -1 || df === 'approvals') facInsert = sl;
      });
      var fnav = document.createElement('div');
      fnav.className = 'sl';
      fnav.id = 'facUserApprovalsNav';
      fnav.setAttribute('data-fac', 'accountapprovals');
      fnav.setAttribute('onclick', "showSec('facUserApprovals',this)");
      fnav.innerHTML = '<span class="sli">✅</span>Account Approvals';
      // Hide by default; shown when HOD logs in via roleAccess
      fnav.style.display = (currentUser && currentUser.role === 'hod') ? '' : 'none';
      if (facInsert && facInsert.nextSibling) {
        facInsert.parentNode.insertBefore(fnav, facInsert.nextSibling);
      } else if (facInsert) {
        facInsert.parentNode.appendChild(fnav);
      } else {
        facMenu.appendChild(fnav);
      }
    } else if (document.getElementById('facUserApprovalsNav') && currentUser) {
      document.getElementById('facUserApprovalsNav').style.display =
        currentUser.role === 'hod' ? '' : 'none';
    }
    var facContent = document.querySelector('#dbFaculty .db-content');
    if (facContent && !document.getElementById('facUserApprovals')) {
      var fPanel = document.createElement('div');
      fPanel.id = 'facUserApprovals';
      fPanel.style.display = 'none';
      fPanel.innerHTML =
        '<div class="info-box">✅ <strong>Branch Account Approvals</strong> — You only see <strong>student</strong> registrations for <strong>your branch</strong>. Approve / Reject so they can log in.</div>' +
        '<div id="bridgeAccountApprovalsHod"><div class="card"><p style="opacity:.7;margin:16px;">Loading branch accounts…</p></div></div>';
      facContent.appendChild(fPanel);
    }

    // Also inject Approvals / Students / Student Data desk for Principal + HOD
    ensurePrincipalHodDesk();
  }
  window.ensureAccountApprovalPanels = ensureAccountApprovalPanels;

  /**
   * Principal + HOD desk: Approvals (profile), Students, Student Data
   * matching ACM/Admin three-item shell. HOD data is branch-scoped by API.
   */
  function studentDbPanelHtml(pfx, titleNote) {
    return '' +
      '<div class="info-box">' + (titleNote || 'Student Database') + '</div>' +
      '<div class="card">' +
      '<div class="card-hd"><h3>Student Database</h3>' +
      '<div class="card-acts"><button class="btn ol" type="button" onclick="window.renderAdminStudentDatabase&&window.renderAdminStudentDatabase()">↻ Refresh</button></div></div>' +
      '<div style="padding:12px 18px;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
      '<div class="sbar" style="flex:1 1 220px;min-width:180px;"><span class="si">🔍</span>' +
      '<input type="text" id="' + pfx + 'Search" placeholder="Search by name, reg number, branch, email…" ' +
      'oninput="window.filterAdminStudentList&&window.filterAdminStudentList()" /></div>' +
      '<select id="' + pfx + 'BranchFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:160px;">' +
      '<option value="">All Branches</option></select>' +
      '<select id="' + pfx + 'YearFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:140px;">' +
      '<option value="">All Years</option>' +
      '<option value="1st Year">1st Year</option><option value="2nd Year">2nd Year</option>' +
      '<option value="3rd Year">3rd Year</option><option value="YEAR BACK">YEAR BACK</option>' +
      '<option value="Completed">Completed</option></select>' +
      '<select id="' + pfx + 'AdmYearFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:130px;">' +
      '<option value="">All Adm. Years</option></select>' +
      '<select id="' + pfx + 'ProfileFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:160px;">' +
      '<option value="">All Profiles</option><option value="updated">Profile Updated</option>' +
      '<option value="partial">Partial</option><option value="not_updated">Not Updated</option></select>' +
      '</div>' +
      '<div id="' + pfx + 'BulkBar" style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:rgba(26,79,160,0.04);">' +
      '<span class="stu-selected-count" style="font-size:0.8rem;font-weight:600;min-width:90px;">0 selected</span>' +
      '<button class="btn gr stu-bulk-unlock-btn" type="button">🔓 Unlock Selected</button>' +
      '<button class="btn stu-bulk-lock-btn" type="button" style="background:#b45309;color:#fff;">🔒 Lock Selected</button>' +
      '</div>' +
      '<div id="' + pfx + 'ListMeta" style="padding:8px 18px;font-size:0.78rem;color:var(--text-muted);"></div>' +
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">' +
      '<thead><tr>' +
      '<th style="width:36px;"></th><th>Reg No</th><th>Name / Email</th><th>Branch</th><th>Year</th><th>Account</th><th>Profile</th><th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="' + pfx + 'TableBody"><tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">Loading…</td></tr></tbody>' +
      '</table></div></div>' +
      '<div id="' + pfx + 'ViewModal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99990;align-items:center;justify-content:center;padding:16px;">' +
      '<div style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:#fff;z-index:1;">' +
      '<h3 style="margin:0;font-size:1rem;">Student Profile</h3>' +
      '<button type="button" class="btn ol" onclick="(function(){var m=document.getElementById(\'' + pfx + 'ViewModal\');if(m)m.style.display=\'none\';})()">Close</button>' +
      '</div><div id="' + pfx + 'ViewBody" style="padding:16px;"></div></div></div>';
  }

  function ensurePrincipalHodDesk() {
    // ---- Principal: Approvals, Students, Student Data ----
    var priMenu = document.querySelector('#dbPrincipal .sb-menu');
    var priContent = document.querySelector('#dbPrincipal .db-content');
    if (priMenu && priContent) {
      function addPriNav(id, sec, icon, label, afterSec) {
        if (document.getElementById(id)) return;
        var after = null;
        priMenu.querySelectorAll('.sl').forEach(function (sl) {
          var oc = sl.getAttribute('onclick') || '';
          if (afterSec && oc.indexOf(afterSec) !== -1) after = sl;
        });
        var nav = document.createElement('div');
        nav.className = 'sl';
        nav.id = id;
        nav.setAttribute('onclick', "showSec('" + sec + "',this)");
        nav.innerHTML = '<span class="sli">' + icon + '</span>' + label;
        if (after && after.nextSibling) after.parentNode.insertBefore(nav, after.nextSibling);
        else if (after) after.parentNode.appendChild(nav);
        else priMenu.insertBefore(nav, priMenu.firstChild);
      }
      // Insert at top of menu for visibility (after Dashboard if present)
      addPriNav('priProfileApprovalsNav', 'priProfileApprovals', '✅', 'Approvals', 'priHome');
      addPriNav('priStudentsDeskNav', 'priStudentsDesk', '🎓', 'Students', 'priProfileApprovals');
      addPriNav('priStudentDataNav', 'priStudentData', '📊', 'Student Data', 'priStudentsDesk');

      if (!document.getElementById('priProfileApprovals')) {
        var pa = document.createElement('div');
        pa.id = 'priProfileApprovals';
        pa.style.display = 'none';
        pa.innerHTML =
          '<div class="info-box">ℹ️ <strong>Profile Approvals</strong> — Pending My Profile update requests (all branches). Account registrations are under <strong>Account Approvals</strong>.</div>' +
          '<div class="info-box" id="priPendingCountBox" style="display:none;">⚠️ <strong><span id="priPendingCountText">0 pending</span></strong></div>' +
          '<div class="card" id="priPendingApprovalsCard">' +
          '<div class="card-hd"><h3>All Pending Approvals</h3><span class="badge pending" id="priPendingBadge">0</span></div>' +
          '<div id="bridgeProfileRequestsPri" style="padding:0 0 4px;"><p style="opacity:.7;margin:12px 18px;">Loading…</p></div></div>';
        priContent.appendChild(pa);
      }
      if (!document.getElementById('priStudentsDesk')) {
        var ps = document.createElement('div');
        ps.id = 'priStudentsDesk';
        ps.style.display = 'none';
        ps.innerHTML = studentDbPanelHtml('priStu', '🎓 <strong>Students</strong> — Full institute student database (all branches), same as Admin.');
        priContent.appendChild(ps);
      }
      if (!document.getElementById('priStudentData')) {
        var pd = document.createElement('div');
        pd.id = 'priStudentData';
        pd.style.display = 'none';
        pd.innerHTML = buildStudentDataPanelMarkup('priSd',
          '📊 <strong>Student Data</strong> — All branches. Filter by Branch / Year. Same as Admin Student Data.');
        priContent.appendChild(pd);
      }
    }

    // ---- HOD: Students + Student Data (Approvals already as facApprovals) ----
    var facMenu = document.querySelector('#dbFaculty .sb-menu');
    var facContent = document.querySelector('#dbFaculty .db-content');
    if (facMenu && facContent) {
      function addFacNav(id, sec, dataFac, icon, label, afterDataFac) {
        if (document.getElementById(id)) {
          var el = document.getElementById(id);
          if (el && currentUser) el.style.display = currentUser.role === 'hod' ? '' : 'none';
          return;
        }
        var after = null;
        facMenu.querySelectorAll('.sl').forEach(function (sl) {
          var df = sl.getAttribute('data-fac') || '';
          if (afterDataFac && df === afterDataFac) after = sl;
        });
        var nav = document.createElement('div');
        nav.className = 'sl';
        nav.id = id;
        nav.setAttribute('data-fac', dataFac);
        nav.setAttribute('onclick', "showSec('" + sec + "',this)");
        nav.innerHTML = '<span class="sli">' + icon + '</span>' + label;
        nav.style.display = (currentUser && currentUser.role === 'hod') ? '' : 'none';
        if (after && after.nextSibling) after.parentNode.insertBefore(nav, after.nextSibling);
        else if (after) after.parentNode.appendChild(nav);
        else facMenu.appendChild(nav);
      }
      addFacNav('facBranchStudentsNav', 'facBranchStudents', 'students', '🎓', 'Students', 'approvals');
      // Student Data nav may already exist as facStudentDataNav — ensure visible for HOD
      if (document.getElementById('facStudentDataNav') && currentUser && currentUser.role === 'hod') {
        document.getElementById('facStudentDataNav').style.display = '';
      } else {
        addFacNav('facStudentDataNavHod', 'facStudentData', 'studentdata', '📊', 'Student Data', 'students');
      }

      if (!document.getElementById('facBranchStudents')) {
        var fs = document.createElement('div');
        fs.id = 'facBranchStudents';
        fs.style.display = 'none';
        fs.innerHTML = studentDbPanelHtml('facStu',
          '🎓 <strong>Students (your branch only)</strong> — Civil HOD sees Civil students only, etc.');
        facContent.appendChild(fs);
      }
      // facStudentData panel already created by ensureStudentDataMenu — ensure exists
      if (typeof ensureStudentDataMenu === 'function') {
        try { ensureStudentDataMenu(); } catch (e) { /* may not be defined yet */ }
      }
    }
  }
  window.ensurePrincipalHodDesk = ensurePrincipalHodDesk;

  function buildStudentDataPanelMarkup(p, infoHtml) {
    var official = (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
        'Civil Engineering',
        'Computer Science and Engineering',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
      ];
    var branchOpts = official.map(function (b) {
      return '<option value="' + String(b).replace(/"/g, '&quot;') + '">' + b + '</option>';
    }).join('');
    return '' +
      '<div class="info-box">' + (infoHtml || 'Student Data') + '</div>' +
      '<div class="card">' +
      '<div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">Student Data — Branch / Year</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn ol" onclick="window.renderStudentDataBrowser&&window.renderStudentDataBrowser()">↻ Refresh</button>' +
      '<button type="button" class="btn pr" onclick="window.exportStudentDataCsv&&window.exportStudentDataCsv()">⬇ Export CSV</button>' +
      '</div></div>' +
      '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:2fr 1.4fr 1fr 1fr;gap:10px;align-items:end;">' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Search</label>' +
      '<div class="sbar" style="margin:0;"><span class="si">🔍</span>' +
      '<input type="text" id="' + p + '_search" placeholder="Name, reg no, father, phone…" ' +
      'oninput="window.filterStudentDataList&&window.filterStudentDataList()" /></div></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Branch</label>' +
      '<select id="' + p + '_branch" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
      '<option value="">All Branches</option>' + branchOpts + '</select></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Current Year</label>' +
      '<select id="' + p + '_year" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
      '<option value="">All Years</option><option value="1st">1st Year</option>' +
      '<option value="2nd">2nd Year</option><option value="3rd">3rd Year</option></select></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Admission Year</label>' +
      '<select id="' + p + '_adm" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()"><option value="">All</option></select></div>' +
      '</div>' +
      '<div id="' + p + '_meta" style="padding:8px 16px;font-size:0.78rem;opacity:.8;border-bottom:1px solid var(--border);">Loading…</div>' +
      '<div id="' + p + '_stats" style="padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);"></div>' +
      '<div style="overflow-x:auto;max-height:calc(100vh - 280px);">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
      '<thead style="position:sticky;top:0;background:var(--surface);z-index:1;"><tr>' +
      '<th style="padding:8px;text-align:left;">Reg No</th><th style="padding:8px;text-align:left;">Name</th>' +
      '<th style="padding:8px;text-align:left;">Father</th><th style="padding:8px;text-align:left;">Mother</th>' +
      '<th style="padding:8px;text-align:left;">Branch</th><th style="padding:8px;text-align:left;">Year</th>' +
      '<th style="padding:8px;text-align:left;">Adm. Year</th><th style="padding:8px;text-align:left;">Phone</th>' +
      '<th style="padding:8px;text-align:left;">Email</th><th style="padding:8px;text-align:left;">Action</th>' +
      '</tr></thead>' +
      '<tbody id="' + p + '_tbody"><tr><td colspan="10" style="padding:24px;text-align:center;opacity:.7;">Open this menu to load students.</td></tr></tbody>' +
      '</table></div></div>' +
      '<div id="' + p + '_modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99990;align-items:center;justify-content:center;padding:16px;">' +
      '<div style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:#fff;z-index:1;">' +
      '<h3 style="margin:0;font-size:1rem;">Student Profile</h3>' +
      '<button type="button" class="btn ol" onclick="window.closeStudentDataView&&window.closeStudentDataView()">Close</button>' +
      '</div><div id="' + p + '_modalBody" style="padding:16px;"></div></div></div>';
  }

  /**
   * Full Account Control Center — pending + all accounts + trash,
   * multi-select bulk delete, password reset, restore.
   * Principal / HOD see a simplified approve-only view.
   */
  async function renderAccountApprovals() {
    ensureAccountApprovalPanels();
    var panel = document.getElementById('bridgeAccountApprovals') ||
      document.getElementById('bridgeUserManagement') ||
      document.getElementById('bridgeAccountApprovalsPri') ||
      document.getElementById('bridgeAccountApprovalsHod');
    if (!panel &&
        !document.getElementById('adUserApprovals') &&
        !document.getElementById('adUsers') &&
        !document.getElementById('priUserApprovals') &&
        !document.getElementById('facUserApprovals')) return;

    var actorRole = (currentUser && currentUser.role) || '';
    var isFullAdmin = actorRole === 'admin';
    var isPrincipal = actorRole === 'principal';
    var isHod = actorRole === 'hod';
    var approveOnly = isPrincipal || isHod;

    var statusF = (document.getElementById('accStatusFilter') && document.getElementById('accStatusFilter').value) ||
      (approveOnly ? 'pending' : 'all');
    var roleF = (document.getElementById('accApRoleFilter') && document.getElementById('accApRoleFilter').value) ||
      (isHod ? 'student' : '');
    var qF = (document.getElementById('accApSearch') && document.getElementById('accApSearch').value) || '';
    var branchF = (document.getElementById('accApBranchFilter') && document.getElementById('accApBranchFilter').value) || '';
    if (isHod && currentUser && currentUser.branch) {
      branchF = currentUser.branch;
    }
    if (approveOnly && statusF !== 'pending' && statusF !== 'approved' && statusF !== 'rejected') {
      statusF = 'pending';
    }

    function buildQs(status) {
      var qs = [
        'status=' + encodeURIComponent(status || 'all'),
        '_ts=' + Date.now(), // bust browser/HTTP cache so list is always live
      ];
      if (roleF) qs.push('role=' + encodeURIComponent(roleF));
      if (qF) qs.push('q=' + encodeURIComponent(qF));
      if (branchF) qs.push('branch=' + encodeURIComponent(branchF));
      return qs.join('&');
    }

    async function fetchUsersLive(qs) {
      try {
        var r = await fetch('/api/users?' + qs, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        });
        if (!r.ok) {
          console.error('[accounts] list failed', r.status);
          return null;
        }
        return await r.json();
      } catch (e) {
        console.error('[accounts] list error', e);
        return null;
      }
    }

    var data = await fetchUsersLive(buildQs(statusF === 'deleted' ? 'deleted' : (statusF || 'all')));
    if (!data) data = { accounts: [], counts: {} };

    // Always load trash list for the Deleted Accounts section (unless already viewing deleted-only)
    var trashData = statusF === 'deleted'
      ? data
      : await fetchUsersLive('status=deleted&_ts=' + Date.now());
    if (!trashData) trashData = { accounts: [] };

    console.log('[accounts] live list active=', (data.accounts || []).length,
      'trash=', (trashData.accounts || []).length, 'counts=', data.counts || trashData.counts);

    var accounts = data.accounts || [];
    var trash = trashData.accounts || [];
    var counts = data.counts || trashData.counts || {};
    var pendingCount = counts.pending || 0;
    var profilePending = counts.profile_pending || 0;
    window._lastProfilePending = profilePending;
    window._lastAccountPending = pendingCount;
    updateSidebarBadges(profilePending, pendingCount);

    var officialBranches = (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
        'Civil Engineering',
        'Computer Science and Engineering',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
      ];

    var roleList = ['admin', 'student', 'principal', 'hod', 'faculty', 'registrar', 'acm', 'exam',
      'est', 'library', 'placement', 'nss', 'yrc', 'alumni', 'sports', 'welfare', 'cash', 'accounts', 'stores', 'studentassoc'];
    var roleOpts = '<option value="">All Roles</option>' + roleList.map(function (r) {
      return '<option value="' + r + '"' + (roleF === r ? ' selected' : '') + '>' + r + '</option>';
    }).join('');
    var branchOpts = '<option value="">All Branches</option>' + officialBranches.map(function (b) {
      return '<option value="' + esc(b) + '"' + (branchF === b ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('');
    var statusOpts = [
      ['all', 'All Active'],
      ['pending', 'Pending only'],
      ['approved', 'Approved only'],
      ['rejected', 'Rejected only'],
      ['deleted', 'Trash only'],
    ].map(function (p) {
      return '<option value="' + p[0] + '"' + (statusF === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
    }).join('');

    var pending = accounts.filter(function (a) { return a.status === 'pending'; });
    var others = accounts.filter(function (a) { return a.status !== 'pending' && a.status !== 'deleted'; });

    function actionButtons(a, mode) {
      // data-* attributes only — handled by global document click delegation (no inline JS)
      var id = Number(a.id);
      var label = String(a.display_name || a.email || String(id))
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      var html = '<div style="display:flex;gap:5px;flex-wrap:wrap;" class="acc-actions">';
      function btn(cls, action, text, extra) {
        return '<button type="button" class="btn ' + cls + ' btn-sm acc-act-btn" ' +
          'data-acc-action="' + action + '" data-acc-id="' + id + '" data-acc-label="' + label + '" ' +
          (extra || '') + '>' + text + '</button>';
      }
      if (mode === 'trash') {
        if (isFullAdmin) {
          html += btn('gr', 'restore', '↩ Restore');
          html += btn('re', 'purge', '☠ Purge');
        }
      } else if (mode === 'pending' || a.status === 'pending') {
        html += btn('gr', 'approve', '✓ Approve');
        html += btn('re', 'reject', '✕ Reject');
        if (isFullAdmin) html += btn('re', 'trash', '🗑 Trash');
      } else if (isFullAdmin) {
        if (a.status === 'approved') html += btn('ol', 'deactivate', 'Deactivate');
        else if (a.status === 'rejected') html += btn('gr', 'activate', 'Re-activate');
        html += btn('ol', 'password', '🔑 Password');
        html += btn('re', 'trash', '🗑 Trash');
      } else {
        html += '<span style="font-size:0.72rem;opacity:.7;">—</span>';
      }
      html += '</div>';
      return html;
    }

    function accountRow(a, mode) {
      var idNum = Number(a.id);
      // Skip checkbox for trash rows in bulk-delete of actives (still selectable for bulk purge later)
      return '<tr data-acc-id="' + idNum + '">' +
        (isFullAdmin
          ? '<td><input type="checkbox" class="acc-select-cb" data-acc-id="' + idNum + '" data-mode="' + mode + '" data-demo="' + (a.is_demo ? '1' : '0') + '" /></td>'
          : '') +
        '<td><strong>' + esc(a.display_name) + '</strong>' +
        (a.is_demo ? ' <span class="badge" style="font-size:0.65rem;">demo</span>' : '') +
        '<div style="font-size:0.68rem;opacity:.7;">' + esc(a.email) + '</div></td>' +
        '<td>' + esc(a.role) + '</td>' +
        '<td>' + esc(a.branch || '—') + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + esc(a.reg_no || '—') + '</td>' +
        '<td>' + (a.year ? esc(a.year) : '—') + '</td>' +
        '<td>' + accountStatusBadgeHtml(a.status) +
        (a.force_password_change ? ' <span class="badge pending" title="Must change password">PW</span>' : '') +
        '</td>' +
        '<td style="font-size:0.72rem;">' +
        (mode === 'trash' && a.deleted_at
          ? new Date(a.deleted_at).toLocaleDateString('en-IN')
          : (a.created_at ? new Date(a.created_at).toLocaleDateString('en-IN') : '—')) +
        '</td>' +
        '<td>' + actionButtons(a, mode) + '</td>' +
        '</tr>';
    }

    var scopeNote = '';
    if (isHod) {
      var hb = (data.scope && data.scope.branch) || (currentUser && currentUser.branch) || branchF || 'your branch';
      scopeNote = '<div class="info-box" style="margin-bottom:12px;">🎓 HOD scope: only <strong>student</strong> accounts in <strong>' +
        esc(hb) + '</strong>. Other branches are hidden.</div>';
    } else if (isPrincipal) {
      scopeNote = '<div class="info-box" style="margin-bottom:12px;">👔 Principal: approve / reject any pending registration (students &amp; staff), same as Admin Approvals.</div>';
    }

    var filterBar =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">' +
      '<input id="accApSearch" type="text" value="' + esc(qF) + '" placeholder="Search name, email, reg no…" ' +
      'style="flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;" ' +
      'onkeydown="if(event.key===\'Enter\'){window.renderAccountApprovals&&window.renderAccountApprovals();}" />' +
      '<select id="accStatusFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;" onchange="window.renderAccountApprovals&&window.renderAccountApprovals()">' +
      (approveOnly
        ? [
            ['pending', 'Pending only'],
            ['approved', 'Approved only'],
            ['rejected', 'Rejected only'],
          ].map(function (p) {
            return '<option value="' + p[0] + '"' + (statusF === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
          }).join('')
        : statusOpts) + '</select>' +
      (isHod
        ? ''
        : ('<select id="accApRoleFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;" onchange="window.renderAccountApprovals&&window.renderAccountApprovals()">' +
          roleOpts + '</select>')) +
      (isHod
        ? '<span style="font-size:0.8rem;font-weight:700;padding:8px 10px;background:#e8f0fe;border-radius:8px;color:#1a4fa0;">Branch: ' + esc(branchF || '—') + '</span>'
        : ('<select id="accApBranchFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:160px;" onchange="window.renderAccountApprovals&&window.renderAccountApprovals()">' +
          branchOpts + '</select>')) +
      '<button class="btn ol" type="button" onclick="window.renderAccountApprovals&&window.renderAccountApprovals()">Apply</button>' +
      (isHod ? '' : '<button class="btn ol" type="button" onclick="window.clearAccountFilters&&window.clearAccountFilters()">Clear</button>') +
      '</div>' +
      '<div style="font-size:0.75rem;opacity:.75;margin-bottom:10px;">' +
      (isFullAdmin ? ('Active users: <strong>' + (counts.total_users || 0) + '</strong> · ') : '') +
      'Pending: <strong>' + pendingCount + '</strong> · ' +
      'Approved: <strong>' + (counts.approved || 0) + '</strong> · ' +
      'Rejected: <strong>' + (counts.rejected || 0) + '</strong>' +
      (isFullAdmin ? (' · Trash: <strong>' + (counts.deleted || 0) + '</strong>') : '') +
      '</div>';

    // Bulk bar lives with ALL ACCOUNTS (where the checkboxes users select are)
    var bulkBar = isFullAdmin
      ? ('<div class="acc-bulk-bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px 12px;background:#fef2f2;border-radius:8px;border:1.5px solid #fecaca;">' +
        '<label style="font-size:0.82rem;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;">' +
        '<input type="checkbox" class="acc-select-all-cb" style="width:16px;height:16px;" /> Select all</label>' +
        '<button type="button" class="btn re acc-bulk-delete-btn" style="padding:8px 14px;font-weight:700;">🗑 Delete selected</button>' +
        '<button type="button" class="btn re acc-bulk-demo-btn" style="padding:8px 14px;font-weight:700;">🗑 Delete all DEMO</button>' +
        '<span class="acc-selected-count" style="font-size:0.8rem;font-weight:700;color:#991b1b;">0 selected</span>' +
        '<span style="font-size:0.72rem;opacity:.75;">Checked rows → Trash (can Restore later)</span>' +
        '</div>')
      : '';

    var thead = '<thead><tr>' +
      (isFullAdmin ? '<th style="width:40px;">☐</th>' : '') +
      '<th>Name / Email</th><th>Role</th><th>Branch</th><th>Reg No</th><th>Year</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>';

    function tableFor(list, mode, emptyMsg) {
      if (!list.length) return '<p style="opacity:.7;margin:0;">' + emptyMsg + '</p>';
      return '<div style="overflow-x:auto;"><table class="tbl" style="width:100%">' + thead + '<tbody>' +
        list.map(function (a) { return accountRow(a, mode); }).join('') +
        '</tbody></table></div>';
    }

    // All Accounts list: when filter is "all", show pending+active together under bulk bar
    // so Select all / Delete selected applies to everything visible in that table.
    var mainList = statusF === 'pending' ? pending
      : statusF === 'deleted' ? []
      : statusF === 'all' ? pending.concat(others) : others;

    var html = scopeNote;
    if (approveOnly) {
      html +=
        '<div class="card" style="margin-bottom:16px;">' +
        '<div class="card-hd"><h3>⏳ Account Approval Queue</h3>' +
        '<span class="badge pending">' + pendingCount + ' pending</span>' +
        '<button class="btn ol" type="button" style="margin-left:auto;" onclick="window.renderAccountApprovals()">↻ Refresh</button></div>' +
        '<div style="padding:12px 16px;">' +
        filterBar +
        tableFor(mainList.length ? mainList : pending, statusF === 'pending' ? 'pending' : 'active',
          statusF === 'pending' ? 'No pending registrations in your scope.' : 'No accounts match these filters.') +
        '</div></div>';
    } else {
      html +=
        '<div class="card" style="margin-bottom:16px;">' +
        '<div class="card-hd"><h3>⏳ Pending only (quick view)</h3>' +
        '<span class="badge pending">' + pendingCount + ' pending</span></div>' +
        '<div style="padding:12px 16px;">' +
        (statusF === 'deleted'
          ? '<p style="opacity:.7;">Viewing trash — use Deleted Accounts section below.</p>'
          : (pending.length
            ? '<p style="font-size:0.78rem;opacity:.8;margin:0 0 8px;">' + pending.length + ' registration(s) waiting. Full list with bulk delete is below.</p>' +
              tableFor(pending, 'pending', '')
            : '<p style="opacity:.7;margin:0;">No pending account registrations.</p>')) +
        '</div></div>' +
        '<div class="card" style="margin-bottom:16px;">' +
        '<div class="card-hd"><h3>👥 All Accounts — select &amp; delete <span style="font-size:0.7rem;opacity:.6;font-weight:500;">(actions v4)</span></h3>' +
        '<button class="btn ol" type="button" onclick="window.renderAccountApprovals()">↻ Refresh</button></div>' +
        '<div style="padding:12px 16px;">' +
        filterBar +
        bulkBar +
        (statusF === 'deleted'
          ? '<p style="opacity:.7;">Switch filter to “All Active” to manage accounts.</p>'
          : tableFor(mainList, 'active', 'No accounts match these filters.')) +
        '</div></div>' +
        '<div class="card" style="border-left:4px solid #b45309;">' +
        '<div class="card-hd"><h3>🗑 Deleted Accounts (Trash)</h3>' +
        '<span class="badge" style="background:#fef3c7;color:#92400e;">' + (counts.deleted || trash.length) + ' in trash</span></div>' +
        '<div style="padding:12px 16px;">' +
        '<p style="font-size:0.78rem;opacity:.8;margin:0 0 10px;">Accidentally deleted? Click <strong>Restore</strong>. ' +
        '<strong>Purge</strong> permanently removes the account.</p>' +
        tableFor(trash, 'trash', 'Trash is empty.') +
        '</div></div>';
    }

    // Paint all hosts that exist (admin, principal, HOD)
    ;['bridgeAccountApprovals', 'bridgeUserManagement', 'bridgeAccountApprovalsPri', 'bridgeAccountApprovalsHod'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });

    // Count starts at 0
    document.querySelectorAll('.acc-selected-count').forEach(function (el) {
      el.textContent = '0 selected';
    });
  }
  window.renderAccountApprovals = renderAccountApprovals;
  window.renderUserManagement = renderAccountApprovals;

  function updateSelectedCount() {
    var n = 0;
    var seen = {};
    document.querySelectorAll('#bridgeAccountApprovals .acc-select-cb:checked, #bridgeUserManagement .acc-select-cb:checked, .acc-select-cb:checked').forEach(function (cb) {
      // Prefer one root — count unique ids
      var id = cb.getAttribute('data-acc-id');
      if (id && !seen[id]) { seen[id] = true; n++; }
    });
    // If both panels have copies, query only visible section
    var host = document.getElementById('adUserApprovals');
    var root = document.getElementById('bridgeAccountApprovals');
    if (host && host.offsetParent === null) {
      root = document.getElementById('bridgeUserManagement') || root;
    }
    if (root) {
      n = 0; seen = {};
      root.querySelectorAll('.acc-select-cb:checked').forEach(function (cb) {
        var id = cb.getAttribute('data-acc-id');
        if (id && !seen[id]) { seen[id] = true; n++; }
      });
      root.querySelectorAll('.acc-selected-count').forEach(function (el) {
        el.textContent = n + ' selected';
      });
    } else {
      document.querySelectorAll('.acc-selected-count').forEach(function (el) {
        el.textContent = n + ' selected';
      });
    }
  }

  window.clearAccountFilters = function () {
    ;['accApSearch', 'accApRoleFilter', 'accApBranchFilter'].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.value = '';
    });
    var st = document.getElementById('accStatusFilter');
    if (st) st.value = 'all';
    renderAccountApprovals();
  };

  window.getSelectedAccountIds = function () {
    var root = document.getElementById('bridgeAccountApprovals');
    var host = document.getElementById('adUserApprovals');
    if (host && host.offsetParent === null) {
      root = document.getElementById('bridgeUserManagement') || root;
    }
    if (!root) root = document;
    var ids = [];
    var seen = {};
    root.querySelectorAll('.acc-select-cb:checked').forEach(function (cb) {
      if (cb.getAttribute('data-mode') === 'trash') return;
      var n = Number(cb.getAttribute('data-acc-id'));
      if (Number.isFinite(n) && n > 0 && !seen[n]) {
        seen[n] = true;
        ids.push(n);
      }
    });
    return ids;
  };

  // One-time document delegation — survives re-renders, always works
  // Bulk click/change handlers live only in installAccountActionBus (end of file).

  /** Real-time sidebar badges: Approvals = profile pending; Account Approvals = account pending */
  function updateSidebarBadges(profilePending, accountPending) {
    var p = Number(profilePending) || 0;
    var a = Number(accountPending) || 0;
    document.querySelectorAll('#dbAdmin .sl, #dbPrincipal .sl, #dbFaculty .sl').forEach(function (link) {
      var onclick = link.getAttribute('onclick') || '';
      var text = (link.textContent || '').replace(/\s+/g, ' ');
      var isAccountAppr =
        onclick.indexOf('adUserApprovals') !== -1 ||
        onclick.indexOf('priUserApprovals') !== -1 ||
        onclick.indexOf('facUserApprovals') !== -1 ||
        text.indexOf('Account Approvals') !== -1;
      var isProfileAppr =
        (onclick.indexOf('adApprovals') !== -1 || onclick.indexOf('facApprovals') !== -1) &&
        !isAccountAppr;

      // Hide any hardcoded demo .slb badges
      link.querySelectorAll('.slb').forEach(function (b) {
        if (!b.classList.contains('bridge-badge')) b.style.display = 'none';
      });

      if (!isAccountAppr && !isProfileAppr) return;

      var count = isAccountAppr ? a : p;
      var badge = link.querySelector('.bridge-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bridge-badge slb';
        badge.style.cssText = 'display:inline-block;min-width:18px;padding:1px 6px;margin-left:8px;border-radius:9px;background:#dc2626;color:#fff;font-size:0.68rem;font-weight:700;text-align:center;vertical-align:middle;';
        link.appendChild(badge);
      }
      badge.textContent = String(count);
      badge.style.display = count > 0 ? 'inline-block' : 'none';
      if (isAccountAppr) badge.classList.add('amber');
    });
  }
  window.updateSidebarBadges = updateSidebarBadges;
  // Keep old name as alias (account pending only)
  function updateApprovalsBadge(count) {
    updateSidebarBadges(window._lastProfilePending || 0, count);
  }

  /* Poll for new registrations while an approver session is active so the badge stays fresh.
     Skip full re-render if the admin has checkboxes selected (would wipe selection). */
  setInterval(function () {
    if (!currentUser) return;
    if (currentUser.role !== 'admin' && currentUser.role !== 'principal' && currentUser.role !== 'hod') return;
    if (document.querySelector('.acc-select-cb:checked')) return;
    var ae = document.activeElement;
    if (ae && ae.id && (ae.id.indexOf('acc') === 0 || ae.classList.contains('acc-select-cb'))) return;
    // Badge-only refresh when on account pages is enough every 30s if idle
    fetch('/api/users?status=pending', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.counts) return;
        window._lastAccountPending = d.counts.pending || 0;
        window._lastProfilePending = d.counts.profile_pending || window._lastProfilePending || 0;
        if (typeof updateSidebarBadges === 'function') {
          updateSidebarBadges(window._lastProfilePending, window._lastAccountPending);
        }
      })
      .catch(function () { /* ignore */ });
  }, 30000);
  // Account actions (delete/password/deactivate/bulk) are handled ONLY by the
  // global installAccountActionBus() at the bottom of this file — do not reassign
  // window.bridge* handlers here or they will break those actions.

  // Refresh live pending registrations every time an approver opens an approvals section
  (function hookShowSec() {
    var origShowSec = window.showSec;
    if (typeof origShowSec !== 'function') return;
    window.showSec = function (secId, linkEl) {
      origShowSec(secId, linkEl);
      if ((secId === 'adUserApprovals' || secId === 'adUsers' || secId === 'adApprovals' ||
           secId === 'priUserApprovals' || secId === 'facUserApprovals') &&
          currentUser &&
          (currentUser.role === 'admin' || currentUser.role === 'principal' || currentUser.role === 'hod')) {
        renderAccountApprovals();
      }
      // Profile edit requests (admin / ACM / Principal / HOD Approvals)
      if ((secId === 'adApprovals' || secId === 'facApprovals' || secId === 'priProfileApprovals') &&
          typeof window.renderProfileRequestApprovals === 'function') {
        window.renderProfileRequestApprovals();
      }
      // Students desk
      if ((secId === 'adStudents' || secId === 'priStudentsDesk' || secId === 'facBranchStudents') &&
          typeof window.renderAdminStudentDatabase === 'function') {
        window.renderAdminStudentDatabase();
      }
      // Student Data desk
      if ((secId === 'adStudentData' || secId === 'facStudentData' || secId === 'priStudentData') &&
          typeof window.renderStudentDataBrowser === 'function') {
        window.renderStudentDataBrowser(secId);
      }
      // Always re-fetch + re-paint student My Profile so approved data shows immediately
      if (secId === 'stuProfile' && currentUser && currentUser.role === 'student' &&
          typeof window.applyLiveStudentProfile === 'function') {
        var regOpen = currentUser.reg_no || window.STU_REG_NO || '';
        apiReqQuiet('/api/students').then(function (s) {
          if (!s || !Array.isArray(s.students) || !s.students.length) {
            console.warn('[bridge] no students row for profile paint; reg=', regOpen);
            return;
          }
          var row = s.students[0];
          var mapped = {
            name: row.name, dept: row.dept, year: row.year, cgpa: row.cgpa,
            att: row.att, father: row.father, extra: row.extra || {},
          };
          if (typeof students !== 'undefined') students[row.reg_no || regOpen] = mapped;
          window.applyLiveStudentProfile(mapped, row.reg_no || regOpen);
        });
      }

      // ACM certificate desk (admin + ACM staff)
      if ((secId === 'facACM' || secId === 'adACM') && typeof window.renderAcmModule === 'function') {
        window.renderAcmModule();
      }
      // Student Certificates — prefill reg + load live My Requests status
      if (secId === 'stuCerts' && currentUser && currentUser.role === 'student') {
        if (typeof window.prefillStudentCertForms === 'function') window.prefillStudentCertForms();
        renderStuCertRequests();
        startStuCertPolling();
      }
      // Student Profile Manager (Google Form builder)
      if (secId === 'adStudentProfile') {
        if (typeof window.loadStudentProfileSchema === 'function') {
          window.loadStudentProfileSchema(false).then(function () {
            if (typeof window.renderStuBuilder === 'function') window.renderStuBuilder();
          });
        } else if (typeof window.renderStuBuilder === 'function') {
          window.renderStuBuilder();
        }
      }
    };
  })();

  /* ---------- auth ---------- */
  // Maps demo-bar UI roles to seeded server roles.
  function serverRole(uiRole) { return uiRole === 'teaching' ? 'faculty' : uiRole; }

  /** Restore full Root Admin sidebar after ACM scoped session. */
  function clearAcmAdminScope() {
    if (!window._acmScopedAdmin) return;
    window._acmScopedAdmin = false;
    var root = document.getElementById('dbAdmin');
    if (!root) return;
    root.querySelectorAll('.sb .sl, .sb .sb-sec').forEach(function (el) {
      el.style.display = '';
    });
    var roleEl = root.querySelector('.sb-role');
    if (roleEl) roleEl.textContent = 'Root Admin';
    var uname = root.querySelector('.db-uname');
    if (uname && uname.getAttribute('data-prev-name')) {
      uname.textContent = uname.getAttribute('data-prev-name');
      uname.removeAttribute('data-prev-name');
    }
  }

  /**
   * ACM = scoped admin: same Approvals + Students tools as Root Admin,
   * plus ACM Module. No Cash/Fees, no other admin menus.
   */
  function applyAcmAdminScope(user) {
    var root = document.getElementById('dbAdmin');
    if (!root) return;
    window._acmScopedAdmin = true;
    var allowedSecs = { adApprovals: 1, adStudents: 1, adStudentData: 1, adACM: 1 };
    root.querySelectorAll('.sb .sl').forEach(function (sl) {
      var oc = sl.getAttribute('onclick') || '';
      var keep = false;
      if (oc.indexOf('logout') !== -1) keep = true;
      Object.keys(allowedSecs).forEach(function (sec) {
        if (oc.indexOf("'" + sec + "'") !== -1 || oc.indexOf('"' + sec + '"') !== -1) keep = true;
      });
      sl.style.display = keep ? '' : 'none';
    });
    // Hide section labels (Main / Office / System) — ACM only needs the three links
    root.querySelectorAll('.sb .sb-sec').forEach(function (sec) {
      sec.style.display = 'none';
    });
    var roleEl = root.querySelector('.sb-role');
    if (roleEl) roleEl.textContent = 'ACM Admin';
    var uname = root.querySelector('.db-uname');
    if (uname) {
      if (!uname.getAttribute('data-prev-name')) {
        uname.setAttribute('data-prev-name', uname.textContent || 'Root Admin');
      }
      uname.textContent = (user && user.display_name) ? user.display_name : 'ACM Admin';
    }
    var ava = root.querySelector('#adAva');
    if (ava && user && user.display_name && !ava.querySelector('img')) {
      ava.textContent = initialsOf(user.display_name);
    }
    // Open ACM Module by default
    var acmLink = null;
    root.querySelectorAll('.sb .sl').forEach(function (sl) {
      var oc = sl.getAttribute('onclick') || '';
      if (oc.indexOf('adACM') !== -1) acmLink = sl;
    });
    if (typeof window.showSec === 'function') {
      window.showSec('adACM', acmLink);
    }
    // TC / Study templates are Root Admin only — hide for ACM scoped shell
    if (typeof window.ensureTcPanels === 'function') {
      try { window.ensureTcPanels(); } catch (e) { /* ignore */ }
    }
    if (typeof window.ensureStudyPanels === 'function') {
      try { window.ensureStudyPanels(); } catch (e) { /* ignore */ }
    }
    document.querySelectorAll('[data-tc-tab="template"], [data-study-tab="template-study"], [data-study-tab="template-studying"]').forEach(function (btn) {
      btn.style.display = 'none';
    });
    ;['adAcmTcTpl', 'facAcmTcTpl', 'adAcmStudyTpl', 'facAcmStudyTpl', 'adAcmStudyingTpl', 'facAcmStudyingTpl'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    });
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    if (typeof window.renderProfileRequestApprovals === 'function') {
      window.renderProfileRequestApprovals();
    }
    if (typeof window.renderAdminStudentDatabase === 'function') {
      // warm cache for Students section
      window.renderAdminStudentDatabase();
    }
    console.log('[bridge] ACM scoped admin shell active (Approvals + Students + ACM)');
  }
  window.applyAcmAdminScope = applyAcmAdminScope;
  window.clearAcmAdminScope = clearAcmAdminScope;

  function openDashboardFor(user) {
    var role = user.role;
    if (user.reg_no) { window.STU_REG_NO = user.reg_no; } // keep student modules pointed at the real logged-in student
    clearAcmAdminScope();
    // Create Account Approvals panels before role shell opens them
    if (role === 'admin' || role === 'principal' || role === 'hod') {
      try { ensureAccountApprovalPanels(); } catch (e) { /* ignore */ }
    }
    bypass = true;
    try {
      if (role === 'acm') {
        // ACM uses Root Admin shell UI, then menus are limited to Approvals / Students / ACM
        origLogin('admin');
        setTimeout(function () { applyAcmAdminScope(user); }, 40);
      } else if (role === 'student' || role === 'admin' || role === 'principal') {
        origLogin(role);
        if (role === 'principal') {
          setTimeout(function () {
            ensureAccountApprovalPanels();
            ensurePrincipalHodDesk();
            ;['priUserApprovalsNav', 'priProfileApprovalsNav', 'priStudentsDeskNav', 'priStudentDataNav'].forEach(function (id) {
              var nav = document.getElementById(id);
              if (nav) nav.style.display = '';
            });
          }, 50);
        }
      } else {
        origDemoLogin(role); // faculty-family roles configure the faculty sidebar
        if (role === 'hod') {
          setTimeout(function () {
            ensureAccountApprovalPanels();
            ensurePrincipalHodDesk();
            document.querySelectorAll(
              '#dbFaculty [data-fac="accountapprovals"], #dbFaculty [data-fac="students"], #dbFaculty [data-fac="studentdata"], #dbFaculty [data-fac="approvals"]'
            ).forEach(function (el) {
              el.style.display = '';
            });
            var hodNav = document.getElementById('facUserApprovalsNav');
            if (hodNav) hodNav.style.display = '';
          }, 80);
        }
      }
    } finally { bypass = false; }
    if (user.force_password_change) {
      alert('🔐 For security, please change your default password now (Profile → Change Password).');
    }
  }

  async function afterAuth(user) {
    setCurrentUser(user);
    await hydratePrivate();
    await paintStudentDashboard(user);
    // Profile edit requests: Admin, Principal, HOD, ACM
    if (user && (user.role === 'admin' || user.role === 'hod' || user.role === 'acm' || user.role === 'principal') &&
        typeof window.renderProfileRequestApprovals === 'function') {
      try { window.renderProfileRequestApprovals(); } catch (e) { /* ignore */ }
    }
    // Account approvals + Students / Student Data desk: Admin, Principal, HOD
    if (user && (user.role === 'admin' || user.role === 'principal' || user.role === 'hod')) {
      ensureAccountApprovalPanels();
      ensurePrincipalHodDesk();
      // HOD: force desk menus visible
      var hodNav = document.getElementById('facUserApprovalsNav');
      if (hodNav) hodNav.style.display = user.role === 'hod' ? '' : 'none';
      if (user.role === 'hod') {
        document.querySelectorAll(
          '#dbFaculty [data-fac="accountapprovals"], #dbFaculty [data-fac="students"], #dbFaculty [data-fac="studentdata"], #dbFaculty [data-fac="approvals"]'
        ).forEach(function (el) {
          el.style.display = '';
        });
      }
      try { renderAccountApprovals(); } catch (e) { console.warn('[bridge] account approvals', e); }
    }
    if (user && user.role === 'acm') {
      applyAcmAdminScope(user);
      if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    }
    // Live notification panel + badge
    if (typeof window.renderLiveNotifications === 'function') {
      window.renderLiveNotifications();
    }
  }

  window.demoLogin = async function (role) {
    if ((window.__GPT_CONFIG || {}).demoLoginEnabled === false) { alert('Demo login is disabled.'); return; }
    var res = await api.post('/api/auth/demo-login', { role: serverRole(role) });
    if (!res || !res.user) return;
    openDashboardFor(res.user);
    await afterAuth(res.user);
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
      alert('Please enter your username (or email) and password.');
      if (idInput && !identifier) idInput.focus();
      else if (pwInput) pwInput.focus();
      return;
    }
    // Server accepts email, email local-part (username), reg no, or display name
    // Use quiet fetch so we can show the exact server error (pending / wrong password)
    var res = null;
    try {
      var r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: identifier, password: password }),
      });
      res = await r.json().catch(function () { return null; });
      if (!r.ok) {
        var errMsg = (res && res.error) ? res.error : ('Login failed (HTTP ' + r.status + ')');
        alert('⚠️ ' + errMsg);
        console.error('[bridge] login failed', r.status, res);
        return;
      }
    } catch (e) {
      alert('⚠️ Network error during login. Please try again.');
      console.error('[bridge] login network error', e);
      return;
    }
    if (!res || !res.user) {
      alert('⚠️ Login failed — no user returned. Please try again.');
      return;
    }
    if (pwInput) pwInput.value = '';
    openDashboardFor(res.user);
    await afterAuth(res.user);
  };

  window.logout = function () {
    clearAcmAdminScope();
    api.post('/api/auth/logout');
    setCurrentUser(null);
    origLogout();
    // Return to private CMS login (not the old public homepage)
    if (typeof window.showCmsLoginGate === 'function') window.showCmsLoginGate();
  };

  /** Student (and any role) self-service password change via /api/auth/change-password */
  window.studentChangePassword = async function () {
    var cur = document.getElementById('stuCurPw');
    var nw = document.getElementById('stuNewPw');
    var nw2 = document.getElementById('stuNewPw2');
    var msg = document.getElementById('stuPwMsg');
    var btn = document.getElementById('stuChangePwBtn');
    function setMsg(text, isErr) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.style.color = isErr ? '#991b1b' : '#065f46';
    }
    var currentPassword = cur ? cur.value : '';
    var newPassword = nw ? nw.value : '';
    var confirmPassword = nw2 ? nw2.value : '';
    if (!currentPassword || !newPassword) {
      setMsg('Enter current and new password.', true);
      return;
    }
    if (newPassword.length < 8) {
      setMsg('New password must be at least 8 characters.', true);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMsg('New passwords do not match.', true);
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    setMsg('');
    try {
      var r = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ currentPassword: currentPassword, newPassword: newPassword }),
      });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok) {
        setMsg((data && data.error) ? data.error : ('Failed (HTTP ' + r.status + ')'), true);
        return;
      }
      setMsg('✅ Password updated successfully.', false);
      if (cur) cur.value = '';
      if (nw) nw.value = '';
      if (nw2) nw2.value = '';
      // Clear force-password banner
      var forcePw = document.getElementById('stuForcePw');
      if (forcePw) forcePw.style.display = 'none';
      if (window.currentUser) window.currentUser.force_password_change = false;
      alert('✅ Password changed successfully.');
    } catch (e) {
      setMsg('Network error. Please try again.', true);
      console.error('[change-password]', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Update Password'; }
    }
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

    // Resolve the account role — Faculty must never fall through to empty/student
    var role = type === 'Student' ? 'student' : type === 'Principal' ? 'principal' : type === 'Admin' ? 'admin' : type === 'Faculty' ? 'faculty' : '';
    if (type === 'Faculty') {
      var roleSelect = document.getElementById('facRoleSelect');
      var roleVal = roleSelect ? String(roleSelect.value || '').trim() : '';
      if (!roleVal) { alert('⚠️ Please select a Role before creating the account.'); return; }
      role = FACULTY_ROLE_MAP[roleVal] || 'faculty';
    }
    if (!role) {
      alert('Unknown account type. Please use Student, Faculty, Principal, or Admin Create Account.');
      return;
    }

    // Collect form fields by their labels (+ known field ids)
    var name = '', email = '', pass = '', passConfirm = '', regNo = '', username = '', branch = '', mobile = '';
    var pwCount = 0;
    // Prefer stable ids when present (faculty username)
    var facUserEl = document.getElementById('facRegUsername');
    if (facUserEl && type === 'Faculty') username = String(facUserEl.value || '').trim();

    box.querySelectorAll('input').forEach(function (inp) {
      var fg = inp.closest('.fg');
      var label = (fg ? (fg.querySelector('label') || {}).textContent : '') || '';
      var l = label.toLowerCase();
      if (inp.type === 'password') {
        pwCount++;
        if (pwCount === 1) pass = inp.value;
        else if (pwCount === 2) passConfirm = inp.value;
      } else if (inp.type === 'email' || l.indexOf('email') !== -1) email = inp.value.trim();
      else if (
        l.indexOf('username') !== -1 ||
        l.indexOf('user name') !== -1 ||
        l.indexOf('principal id') !== -1 ||
        (l.indexOf(' id') !== -1 && l.indexOf('email') === -1)
      ) {
        if (!username) username = inp.value.trim();
      } else if (l.indexOf('mobile') !== -1 || l.indexOf('whatsapp') !== -1) mobile = inp.value.trim();
      else if (l.indexOf('full name') !== -1 || (l.indexOf('name') !== -1 && !name && l.indexOf('user') === -1)) name = inp.value.trim();
      else if (l.indexOf('register number') !== -1) regNo = inp.value.trim().toUpperCase();
    });
    // Branch / Department from labeled select (student + faculty) — never use Role select
    var branchSel = document.getElementById('stuRegBranch') || null;
    box.querySelectorAll('select').forEach(function (sel) {
      if (sel.id === 'facRoleSelect') return;
      var fg = sel.closest('.fg');
      var label = (fg ? (fg.querySelector('label') || {}).textContent : '') || '';
      var ll = label.toLowerCase();
      if (ll.indexOf('branch') !== -1 || ll.indexOf('department') !== -1) branchSel = sel;
    });
    if (branchSel) branch = (branchSel.value || branchSel.options[branchSel.selectedIndex] && branchSel.options[branchSel.selectedIndex].text || '').trim();
    if (branch === 'Select Branch / Department' || branch.indexOf('Select') === 0) branch = '';

    if (!name || !email) { alert('Please fill in your full name and email address.'); return; }
    if (pwCount >= 1 && !pass) { alert('Please set a password.'); return; }
    if (pwCount >= 2 && pass !== passConfirm) { alert('Passwords do not match.'); return; }
    if (pass && pass.length < 8) { alert('Password must be at least 8 characters.'); return; }
    if (type === 'Student' && !regNo) { alert('Please enter your Register Number.'); return; }
    if (type === 'Student' && !branch) {
      alert('Please select your Branch (Civil / Computer Science and Engineering / Electronics and Communication / Mechanical).');
      return;
    }
    if (type === 'Faculty') {
      if (!username) {
        alert('Please enter a Username for login (e.g. ACMGPTH or your staff id).');
        return;
      }
      if (!branch) {
        alert('Please select Branch / Department.');
        return;
      }
    }
    if (type === 'Principal' && !username) {
      alert('Please enter Principal ID (this will be your login username).');
      return;
    }
    if (type === 'Admin' && !username) {
      alert('Please enter a Username for the admin account.');
      return;
    }

    var payload = {
      name: name,
      email: email,
      role: role,
      regNo: regNo || undefined,
      username: username || undefined,
      branch: branch || undefined,
      mobile: mobile || undefined,
    };
    if (pass) payload.password = pass; // Faculty form has no password field -> server assigns a temporary password
    var res = await api.post('/api/auth/register', payload);
    if (!res) return;
    // Registration never auto-logs in — account stays pending until Root Admin approves.
    if (res.status && String(res.status).toLowerCase() !== 'pending') {
      console.warn('[bridge] register returned unexpected status', res.status);
    }
    alert(
      '📋 ' + type + ' account request submitted!\n\n' +
      'Role: ' + role +
      (username ? '\nUsername: ' + username : '') +
      '\nEmail: ' + email +
      '\n\n⏳ STATUS: PENDING ROOT ADMIN APPROVAL\n\n' +
      'Login will NOT work until Root Admin approves this account under:\n' +
      'Admin → Account Approvals (or User Management).\n\n' +
      'After approval, login with Username (or email) + your password.' +
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
    var s = String(status || 'pending').toLowerCase();
    if (s === 'ready') return '<span class="badge approved">✅ Ready for Collection</span>';
    if (s === 'rejected') return '<span class="badge" style="background:#991b1b;color:#fff">❌ Rejected</span>';
    if (s === 'collected') return '<span class="badge approved">✅ Collected</span>';
    if (s === 'processing') return '<span class="badge pending">⚙️ Processing</span>';
    return '<span class="badge pending">⏳ Under Review</span>';
  }

  window._stuCertPollTimer = null;
  window._stuCertCache = null;

  // Student "My Requests" table — live from DB + issued Study/Studying for print
  async function renderStuCertRequests() {
    var tbody = document.getElementById('stuCertReqBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="opacity:.7;text-align:center;padding:16px;">Refreshing status…</td></tr>';
    var data = await apiReqQuiet('/api/cert-requests?_ts=' + Date.now());
    if (!data || !Array.isArray(data.requests)) {
      tbody.innerHTML = '<tr><td colspan="6" style="opacity:.7;text-align:center;padding:16px;">Could not load requests. Try Refresh.</td></tr>';
    } else {
      window._stuCertCache = data.requests;
      tbody.innerHTML = data.requests.map(function (r) {
        var badgeColor = r.routed_to === 'Exam Cell' ? '#be185d' : '#1d4ed8';
        return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;">' + esc(r.req_code) +
          '</td><td><strong>' + esc(r.cert_type) + '</strong></td><td>' + esc(fmtDate(r.created_at)) +
          '</td><td><span class="badge info" style="background:' + badgeColor + ';color:white;">' + esc(r.routed_to) +
          '</span></td><td>' + certStatusBadge(r.status) + '</td><td style="max-width:280px;font-size:0.75rem;">' +
          esc(r.remarks || '—') + '</td></tr>';
      }).join('') || '<tr><td colspan="6" style="opacity:.7;text-align:center;padding:20px;">No certificate requests yet. Submit one from the tabs above.</td></tr>';
    }
    // Issued Study/Studying certificates released by ACM for student self-print
    await renderStuIssuedCerts();
  }
  window.renderStuCertRequests = renderStuCertRequests;

  async function renderStuIssuedCerts() {
    var panel = document.getElementById('scMyReqs');
    if (!panel) return;
    var host = document.getElementById('stuIssuedCertsHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'stuIssuedCertsHost';
      host.style.marginTop = '16px';
      panel.appendChild(host);
    }
    host.innerHTML = '<div class="card"><div class="card-hd"><h3>📄 Issued certificates (ready to print)</h3></div>' +
      '<div style="padding:16px;opacity:.7;font-size:0.85rem;">Loading…</div></div>';

    var data = await apiReqQuiet('/api/acm-certs?kind=mine&_ts=' + Date.now());
    var list = (data && Array.isArray(data.certificates)) ? data.certificates : [];
    window._stuIssuedCerts = list;

    if (!list.length) {
      host.innerHTML = '<div class="card"><div class="card-hd"><h3>📄 Issued certificates (ready to print)</h3></div>' +
        '<div style="padding:16px;font-size:0.85rem;opacity:.75;">No certificates released yet. After ACM completes and sends your Study / Studying certificate, it will appear here for print.</div></div>';
      return;
    }

    var rows = list.map(function (c, idx) {
      var typeLabel = c.cert_kind === 'studying' ? 'Studying Certificate' : 'Study Certificate';
      var when = c.sent_to_student_at || c.printed_at || c.updated_at;
      return '<tr>' +
        '<td style="font-family:JetBrains Mono,monospace;font-size:0.75rem;">' + esc(c.cert_no || '—') + '</td>' +
        '<td><strong>' + esc(typeLabel) + '</strong></td>' +
        '<td style="font-size:0.8rem;">' + esc(fmtDate(when)) + '</td>' +
        '<td><span class="badge approved">✅ Ready</span></td>' +
        '<td><button type="button" class="btn gr" style="padding:5px 12px;font-size:0.78rem;" ' +
        'onclick="window.stuPrintIssuedCert&&window.stuPrintIssuedCert(' + idx + ')">🖨️ Print</button></td>' +
        '</tr>';
    }).join('');

    host.innerHTML = '<div class="card"><div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">📄 Issued certificates (ready to print)</h3>' +
      '<button type="button" class="btn ol" style="padding:5px 10px;font-size:0.75rem;" onclick="window.renderStuCertRequests&&window.renderStuCertRequests()">↻ Refresh</button>' +
      '</div>' +
      '<div style="padding:10px 16px;font-size:0.78rem;background:#ecfdf5;border-bottom:1px solid var(--border);color:#065f46;">' +
      'These certificates were verified and released by ACM. Use <strong>Print</strong> for your own printout (includes your profile photo when available).' +
      '</div><div style="overflow-x:auto;"><table><thead><tr>' +
      '<th>Cert No</th><th>Type</th><th>Released</th><th>Status</th><th>Action</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  window.stuPrintIssuedCert = async function (idx) {
    var list = window._stuIssuedCerts || [];
    var c = list[idx];
    if (!c) { alert('Certificate not found. Refresh and try again.'); return; }
    var kind = c.cert_kind === 'studying' ? 'studying' : 'study';
    var form = c.form_data || {};
    if (typeof form === 'string') {
      try { form = JSON.parse(form); } catch (e) { form = {}; }
    }
    form.cert_no = form.cert_no || c.cert_no;
    form.reg_no = form.reg_no || c.reg_no;
    form.student_name = form.student_name || c.student_name;
    form.father_name = form.father_name || c.father_name;
    form.mother_name = form.mother_name || c.mother_name;
    form.branch = form.branch || c.branch;
    if (c.photo && (!form.photo || String(form.photo).indexOf('data:image/') !== 0)) {
      form.photo = c.photo;
    }
    if (!form.print_date) {
      form.print_date = new Date(c.printed_at || c.sent_to_student_at || Date.now())
        .toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    if (!form.print_time) {
      form.print_time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // Prefer study module builder (loads template labels if available)
    if (typeof window.buildStudyPrintHtml === 'function') {
      // Ensure template loaded for student
      try {
        var tplRes = await apiReqQuiet('/api/acm-certs?kind=template&cert_kind=' + encodeURIComponent(kind) + '&_ts=' + Date.now());
        // template GET is staff-only — student may get unauthorized; print still works with defaults
        if (tplRes && tplRes.template && window.STUDY_STATE && window.STUDY_STATE[kind]) {
          window.STUDY_STATE[kind].template = {
            labels: tplRes.template.labels || {},
            header: tplRes.template.header || {},
            footer: tplRes.template.footer || {},
          };
        }
      } catch (e) { /* defaults */ }
      var html = window.buildStudyPrintHtml(kind, form);
      if (typeof window.studyDoPrintHtml === 'function') {
        window.studyDoPrintHtml(html);
      } else if (typeof window.gpthPrintHtml === 'function') {
        window.gpthPrintHtml(html, { title: 'Certificate', filename: 'study-certificate.html' });
      } else {
        var w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
      }
      return;
    }
    alert('Print module not loaded. Hard-refresh the page and try again.');
  };

  function startStuCertPolling() {
    stopStuCertPolling();
    window._stuCertPollTimer = setInterval(function () {
      var panel = document.getElementById('scMyReqs');
      if (panel && panel.style.display !== 'none' && currentUser && currentUser.role === 'student') {
        renderStuCertRequests();
      }
    }, 12000);
  }
  function stopStuCertPolling() {
    if (window._stuCertPollTimer) {
      clearInterval(window._stuCertPollTimer);
      window._stuCertPollTimer = null;
    }
  }

  /** Resolve student profile for certificate autofill (own record only for students). */
  async function resolveCertStudent(regNo) {
    var reg = String(regNo || '').trim();
    if (!reg) return null;
    // Prefer cached students map
    if (typeof students !== 'undefined' && students) {
      var key = Object.keys(students).find(function (k) {
        return String(k).toUpperCase() === reg.toUpperCase();
      });
      if (key && students[key]) {
        var c = students[key];
        return {
          reg_no: key,
          name: c.name || c.display_name || '',
          dept: c.dept || c.branch || '',
          year: c.year || '',
          extra: c.extra || {},
        };
      }
    }
    // Logged-in student: fetch own row
    if (currentUser && currentUser.role === 'student') {
      var myReg = currentUser.reg_no || window.STU_REG_NO || '';
      if (myReg && myReg.toUpperCase() !== reg.toUpperCase()) {
        return { mismatch: true, expected: myReg };
      }
      try {
        var s = await apiReqQuiet('/api/students?_ts=' + Date.now());
        if (s && Array.isArray(s.students) && s.students.length) {
          var row = s.students[0];
          return {
            reg_no: row.reg_no || myReg || reg,
            name: row.name || currentUser.display_name || '',
            dept: row.dept || '',
            year: row.year || '',
            extra: row.extra || {},
          };
        }
      } catch (e) { /* fall through */ }
      return {
        reg_no: myReg || reg,
        name: currentUser.display_name || '',
        dept: currentUser.branch || '',
        year: '',
        extra: {},
      };
    }
    return null;
  }

  function certFormIds(formKey) {
    var map = {
      tc: { reg: 'tcReg', name: 'tcName', branch: 'tcBranch', year: 'tcYear' },
      study: { reg: 'studyReg', name: 'studyName', branch: 'studyBranch', year: 'studyYear' },
      studying: { reg: 'studyingReg', name: 'studyingName', branch: 'studyingBranch', year: 'studyingAcadYear' },
      noc: { reg: 'nocReg', name: 'nocName', branch: 'nocBranch', year: 'nocYear' },
      pdc: { reg: 'pdcReg', name: 'pdcName', branch: 'pdcBranch', year: null },
    };
    return map[formKey] || null;
  }

  function yearLabelFromStudent(stu) {
    if (!stu) return '';
    var y = stu.year != null ? String(stu.year).trim() : '';
    if (y) return y;
    var extra = stu.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    if (extra && extra['Current Year']) return String(extra['Current Year']);
    if (extra && extra['Current Semester']) return String(extra['Current Semester']);
    return '';
  }

  window.fillCertFromReg = async function (formKey) {
    var ids = certFormIds(formKey);
    if (!ids) return;
    var regEl = document.getElementById(ids.reg);
    if (!regEl) return;
    var reg = String(regEl.value || '').trim();
    if (!reg) {
      // clear autofill only
      ['name', 'branch', 'year'].forEach(function (k) {
        if (!ids[k]) return;
        var el = document.getElementById(ids[k]);
        if (el) el.value = '';
      });
      return;
    }
    var stu = await resolveCertStudent(reg);
    if (stu && stu.mismatch) {
      // Keep typed reg if expected missing; otherwise snap to account reg
      if (stu.expected) {
        alert('Register number must match your account (' + stu.expected + ').');
        regEl.value = stu.expected;
        stu = await resolveCertStudent(regEl.value);
      } else {
        // Do not wipe the field the student already filled
        return;
      }
    }
    if (!stu) {
      // Keep register number; only clear empty autofill targets if needed
      return;
    }
    regEl.value = stu.reg_no || reg;
    var nameEl = document.getElementById(ids.name);
    var branchEl = document.getElementById(ids.branch);
    if (nameEl) nameEl.value = stu.name || '';
    if (branchEl) branchEl.value = (stu.dept && stu.dept !== 'Not set') ? stu.dept : '';
    if (ids.year) {
      var yearEl = document.getElementById(ids.year);
      if (yearEl) yearEl.value = yearLabelFromStudent(stu);
    }
  };

  /** Prefill register no. on all cert forms from logged-in student and autofill. */
  window.prefillStudentCertForms = async function () {
    if (!currentUser || currentUser.role !== 'student') return;
    var reg = currentUser.reg_no || window.STU_REG_NO || '';
    if (!reg) return;
    ['tc', 'study', 'studying', 'noc', 'pdc'].forEach(function (key) {
      var ids = certFormIds(key);
      if (!ids) return;
      var regEl = document.getElementById(ids.reg);
      if (regEl && !String(regEl.value || '').trim()) regEl.value = reg;
    });
    // Autofill each form once
    for (var i = 0; i < 5; i++) {
      var keys = ['tc', 'study', 'studying', 'noc', 'pdc'];
      await window.fillCertFromReg(keys[i]);
    }
  };

  function collectCertFormDetails(formKey) {
    var details = {};
    if (formKey === 'tc') {
      details.Reason = certFieldVal('tcReason');
      details['Student remarks'] = certFieldVal('tcRemarks');
    } else if (formKey === 'study') {
      details.Purpose = certFieldVal('studyPurpose');
      details.Copies = certFieldVal('studyCopies');
      details['Address to'] = certFieldVal('studyAddress');
    } else if (formKey === 'studying') {
      details.Purpose = certFieldVal('studyingPurpose');
      details.Copies = certFieldVal('studyingCopies');
      details['Academic year'] = certFieldVal('studyingAcadYear');
    } else if (formKey === 'noc') {
      details.Purpose = certFieldVal('nocPurpose');
      details.Event = certFieldVal('nocEvent');
      details.From = certFieldVal('nocFrom');
      details.To = certFieldVal('nocTo');
      details['Address to'] = certFieldVal('nocAddress');
      details['Student remarks'] = certFieldVal('nocRemarks');
    } else if (formKey === 'pdc') {
      details['Year of passing'] = certFieldVal('pdcYop');
      details.Purpose = certFieldVal('pdcPurpose');
      details.Copies = certFieldVal('pdcCopies');
      details['Address to'] = certFieldVal('pdcAddress');
    }
    return details;
  }

  /** Read a form field value; falls back to query within certificate section. */
  function certFieldVal(id) {
    var el = document.getElementById(id);
    if (el && el.value != null && String(el.value).trim() !== '') return String(el.value).trim();
    // Fallback: first matching input in student certificates area
    var root = document.getElementById('stuCerts') || document;
    var alt = root.querySelector('#' + id + ', [data-tc-field="' + id + '"], input[id="' + id + '"]');
    if (alt && alt.value != null) return String(alt.value).trim();
    return el && el.value != null ? String(el.value).trim() : '';
  }

  function validateCertForm(formKey, certType) {
    var ids = certFormIds(formKey);
    if (!ids) return 'Unknown form';
    var reg = certFieldVal(ids.reg);
    if (!reg && currentUser && currentUser.reg_no) reg = String(currentUser.reg_no).trim();
    if (!reg && window.STU_REG_NO) reg = String(window.STU_REG_NO).trim();
    // Write back so submit uses a real field value
    if (reg && ids.reg) {
      var regEl = document.getElementById(ids.reg);
      if (regEl && !String(regEl.value || '').trim()) regEl.value = reg;
    }
    var name = certFieldVal(ids.name);
    if (!reg) return 'Please enter your Register Number.';
    if (!name) return 'Full Name is missing. Enter Register Number to auto-fill from records.';
    if (formKey === 'tc') {
      if (!certFieldVal('tcReason')) return 'Please select Reason for TC.';
    }
    if (formKey === 'study') {
      if (!certFieldVal('studyPurpose')) return 'Please select Purpose of Certificate.';
    }
    if (formKey === 'studying') {
      if (!certFieldVal('studyingPurpose')) return 'Please select Purpose.';
    }
    if (formKey === 'noc') {
      if (!certFieldVal('nocPurpose')) return 'Please select Purpose of NOC.';
      if (!certFieldVal('nocEvent')) return 'Please enter Event / Organization Name.';
      if (!certFieldVal('nocFrom')) return 'Please select From Date.';
      if (!certFieldVal('nocTo')) return 'Please select To Date.';
      if (!certFieldVal('nocAddress')) return 'Please enter Address NOC To.';
    }
    if (formKey === 'pdc') {
      if (!certFieldVal('pdcYop')) return 'Please select Year of Passing.';
      if (!certFieldVal('pdcPurpose')) return 'Please select Purpose of PDC.';
    }
    return null;
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
    if (res && res.ok) {
      renderExamCertRequests();
      if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    }
  };

  window.submitCertRequest = async function (certType, routedTo, formKey) {
    // Normalize type labels used by UI
    var type = certType;
    if (type === 'TC') type = 'Transfer Certificate';
    if (type === 'PDC') type = 'PDC';

    // Infer form key from type if not passed
    if (!formKey) {
      var t = String(type).toLowerCase();
      if (t.indexOf('transfer') >= 0 || t === 'tc') formKey = 'tc';
      else if (t.indexOf('studying') >= 0) formKey = 'studying';
      else if (t.indexOf('study') >= 0) formKey = 'study';
      else if (t.indexOf('noc') >= 0) formKey = 'noc';
      else if (t.indexOf('pdc') >= 0 || t.indexOf('provisional') >= 0) formKey = 'pdc';
    }

    // Force routing: ACM for TC/Study/Studying/NOC; Exam for PDC
    var route = routedTo;
    if (formKey === 'pdc' || /pdc|provisional/i.test(String(type))) route = 'Exam Cell';
    else route = 'ACM Section';

    var ids = formKey ? certFormIds(formKey) : null;
    // Capture reg BEFORE autofill (autofill must not wipe a typed value)
    var regBefore = ids ? certFieldVal(ids.reg) : '';
    if (!regBefore && currentUser && currentUser.reg_no) regBefore = String(currentUser.reg_no).trim();
    if (ids && regBefore) {
      var regElPre = document.getElementById(ids.reg);
      if (regElPre && !String(regElPre.value || '').trim()) regElPre.value = regBefore;
    }

    if (formKey) {
      try {
        await window.fillCertFromReg(formKey);
      } catch (e) {
        console.warn('[bridge] fillCertFromReg', e);
      }
      // Restore reg if autofill cleared it
      if (ids && regBefore) {
        var regElPost = document.getElementById(ids.reg);
        if (regElPost && !String(regElPost.value || '').trim()) regElPost.value = regBefore;
      }
      var err = validateCertForm(formKey, type);
      if (err) { alert('⚠️ ' + err); return; }
    }

    var regNo = ids ? certFieldVal(ids.reg) : ((currentUser && currentUser.reg_no) || '');
    if (!regNo) regNo = regBefore || (currentUser && currentUser.reg_no) || window.STU_REG_NO || '';
    var studentName = ids ? certFieldVal(ids.name) : '';
    var branch = ids ? certFieldVal(ids.branch) : '';
    var details = formKey ? collectCertFormDetails(formKey) : {};

    var res = await api.post('/api/cert-requests', {
      certType: type,
      routedTo: route,
      regNo: regNo,
      studentName: studentName,
      branch: branch,
      details: details,
      purpose: details.Purpose || '',
      reason: details.Reason || '',
      remarks: details['Student remarks'] || '',
    });
    if (!res || !res.request) {
      alert('❌ Failed to submit request. Please check your login and try again.');
      return;
    }
    await renderStuCertRequests();
    startStuCertPolling();
    alert('✅ ' + type + ' request submitted!\n\nRequest ID: ' + res.request.req_code +
      '\nRouted to: ' + route + '\n\nTrack status under My Requests.\n' +
      (route === 'Exam Cell' ? 'Processing time: 5-7 working days (Exam Cell)' : 'Processing time: 1-3 working days (ACM Section)'));
    // Jump to My Requests tab
    var tabs = document.querySelectorAll('#stuCertTabs .tab');
    var myReqBtn = tabs.length ? tabs[tabs.length - 1] : null;
    if (typeof window.showStuCertTab === 'function') {
      window.showStuCertTab('scMyReqs', myReqBtn);
    } else {
      safeCall(window.showStuCertTab, 'scMyReqs', myReqBtn);
    }
  };

  /* ---------- ACM MODULE (certificate desk) ---------- */
  window._acmRequests = [];
  window._acmStudentsCache = null;

  function acmEsc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function acmStatusBadge(status) {
    if (status === 'ready') return '<span class="badge approved">Ready</span>';
    if (status === 'collected') return '<span class="badge approved">Collected</span>';
    if (status === 'rejected') return '<span class="badge" style="background:#fee2e2;color:#991b1b;">Rejected</span>';
    if (status === 'processing') return '<span class="badge info">Processing</span>';
    return '<span class="badge pending">Pending</span>';
  }

  function acmTypeBadge(type) {
    var t = String(type || '');
    var bg = '#e0e7ff'; var color = '#3730a3';
    if (/noc/i.test(t)) { bg = '#f3e8ff'; color = '#6b21a8'; }
    else if (/transfer|\btc\b/i.test(t)) { bg = '#dbeafe'; color = '#1e40af'; }
    else if (/studying/i.test(t)) { bg = '#dcfce7'; color = '#166534'; }
    else if (/study/i.test(t)) { bg = '#ffedd5'; color = '#9a3412'; }
    return '<span class="badge" style="background:' + bg + ';color:' + color + ';">' + acmEsc(t) + '</span>';
  }

  function acmFmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function acmActiveRoots() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-acm-root="1"]'));
  }

  function acmReadFilters() {
    // Prefer filters from the visible ACM root
    var roots = acmActiveRoots();
    var root = roots.find(function (r) { return r.offsetParent !== null; }) || roots[0] || document;
    var searchEl = root.querySelector('[data-acm-search="1"]');
    var statusEl = root.querySelector('[data-acm-status="1"]');
    var typeEl = root.querySelector('[data-acm-type="1"]');
    return {
      q: searchEl ? searchEl.value.trim().toLowerCase() : '',
      status: statusEl ? statusEl.value : '',
      type: typeEl ? typeEl.value : '',
    };
  }

  function acmPaintTables(list) {
    var f = acmReadFilters();
    var filtered = (list || []).filter(function (r) {
      if (f.status && r.status !== f.status) return false;
      if (f.type && String(r.cert_type || '').toLowerCase().indexOf(f.type.toLowerCase()) === -1) return false;
      if (f.q) {
        var hay = [r.req_code, r.student_name, r.reg_no, r.branch, r.cert_type].join(' ').toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });

    var rowsHtml;
    if (!filtered.length) {
      rowsHtml = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">No ACM certificate requests match.</td></tr>';
    } else {
      rowsHtml = filtered.map(function (r) {
        var actions = '';
        if (r.status === 'pending' || r.status === 'processing') {
          var certTypeStr = String(r.cert_type || '');
          var isTcType = /transfer|\btc\b/i.test(certTypeStr);
          var isStudyingType = /studying/i.test(certTypeStr);
          var isStudyType = !isStudyingType && /study/i.test(certTypeStr);
          // Single-quoted HTML attr so JSON.stringify double-quotes don't break onclick
          var regJs = JSON.stringify(String(r.reg_no || ''));
          var proceedBtn = '';
          if (isTcType) {
            proceedBtn = '<button class="btn" type="button" style="padding:4px 8px;font-size:0.72rem;background:#1a4fa0;color:#fff;" onclick=\'window.acmProceedTc&&window.acmProceedTc(' + r.id + ',' + regJs + ')\'>▶ Proceed → Issue TC</button>';
          } else if (isStudyingType) {
            proceedBtn = '<button class="btn" type="button" style="padding:4px 8px;font-size:0.72rem;background:#b45309;color:#fff;" onclick=\'window.acmProceedStudy&&window.acmProceedStudy(' + r.id + ',' + regJs + ',"studying")\'>▶ Proceed → Studying</button>';
          } else if (isStudyType) {
            proceedBtn = '<button class="btn" type="button" style="padding:4px 8px;font-size:0.72rem;background:#065f46;color:#fff;" onclick=\'window.acmProceedStudy&&window.acmProceedStudy(' + r.id + ',' + regJs + ',"study")\'>▶ Proceed → Study</button>';
          } else if (r.status === 'pending') {
            proceedBtn = '<button class="btn ol" type="button" style="padding:4px 8px;font-size:0.72rem;" onclick="window.acmUpdateRequest(' + r.id + ',\'processing\')">Process</button>';
          }
          actions =
            '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
            proceedBtn +
            '<button class="btn gr" type="button" style="padding:4px 8px;font-size:0.72rem;" onclick="window.acmUpdateRequest(' + r.id + ',\'ready\')">Mark Ready</button>' +
            '<button class="btn re" type="button" style="padding:4px 8px;font-size:0.72rem;" onclick="window.acmUpdateRequest(' + r.id + ',\'rejected\')">Reject</button>' +
            '</div>';
        } else if (r.status === 'ready') {
          actions =
            '<button class="btn" type="button" style="padding:4px 8px;font-size:0.72rem;background:#1a4fa0;color:#fff;" onclick="window.acmUpdateRequest(' + r.id + ',\'collected\')">Collected</button>';
        } else {
          actions = acmStatusBadge(r.status);
        }
        return '<tr>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.7rem;">' + acmEsc(r.req_code || '—') + '</td>' +
          '<td><strong>' + acmEsc(r.student_name || '—') + '</strong></td>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + acmEsc(r.reg_no || '—') + '</td>' +
          '<td>' + acmEsc(r.branch || '—') + '</td>' +
          '<td>' + acmTypeBadge(r.cert_type) + '</td>' +
          '<td style="font-size:0.75rem;">' + acmEsc(acmFmtDate(r.created_at)) + '</td>' +
          '<td>' + acmStatusBadge(r.status) + '</td>' +
          '<td>' + actions + '</td>' +
          '</tr>';
      }).join('');
    }

    acmActiveRoots().forEach(function (root) {
      root.querySelectorAll('[data-acm-tbody="1"]').forEach(function (tb) {
        tb.innerHTML = rowsHtml;
      });
    });
  }

  function acmPaintStats(stats) {
    stats = stats || {};
    var map = {
      pending: stats.pending || 0,
      processing: stats.processing || 0,
      ready: stats.ready || 0,
      collected: stats.collected || 0,
    };
    acmActiveRoots().forEach(function (root) {
      Object.keys(map).forEach(function (k) {
        root.querySelectorAll('[data-acm-kpi="' + k + '"]').forEach(function (el) {
          el.textContent = String(map[k]);
        });
      });
      root.querySelectorAll('[data-acm-badge="1"]').forEach(function (el) {
        el.textContent = (map.pending || 0) + ' Pending';
      });
    });
  }

  async function renderAcmModule() {
    var roots = acmActiveRoots();
    if (!roots.length) return;

    roots.forEach(function (root) {
      root.querySelectorAll('[data-acm-tbody="1"]').forEach(function (tb) {
        if (!tb.querySelector('tr')) {
          tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">Loading…</td></tr>';
        }
      });
    });

    var data = await apiReqQuiet('/api/cert-requests?routed_to=' + encodeURIComponent('ACM Section') + '&_ts=' + Date.now());
    if (!data || !Array.isArray(data.requests)) {
      // fallback without filter
      data = await apiReqQuiet('/api/cert-requests?_ts=' + Date.now());
      if (data && Array.isArray(data.requests)) {
        data.requests = data.requests.filter(function (r) {
          return r.routed_to === 'ACM Section' || (!r.routed_to && !/pdc|provisional/i.test(String(r.cert_type || '')));
        });
      }
    }
    if (!data || !Array.isArray(data.requests)) {
      acmActiveRoots().forEach(function (root) {
        root.querySelectorAll('[data-acm-tbody="1"]').forEach(function (tb) {
          tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#991b1b;">Failed to load ACM requests. Are you logged in as ACM/Admin?</td></tr>';
        });
      });
      return;
    }

    window._acmRequests = data.requests.slice();
    acmPaintStats(data.stats || {
      pending: data.requests.filter(function (r) { return r.status === 'pending'; }).length,
      processing: data.requests.filter(function (r) { return r.status === 'processing'; }).length,
      ready: data.requests.filter(function (r) { return r.status === 'ready'; }).length,
      collected: data.requests.filter(function (r) { return r.status === 'collected'; }).length,
    });
    acmPaintTables(window._acmRequests);
    // Keep Print tab field list in sync with My Profile schema
    if (typeof window.acmPrintInitFields === 'function') {
      try { window.acmPrintInitFields(); } catch (e) { /* ignore */ }
    }
  }
  window.renderAcmModule = renderAcmModule;
  window.filterAcmRequests = function () {
    acmPaintTables(window._acmRequests || []);
  };

  window.acmUpdateRequest = async function (id, status) {
    var remarks = null;
    if (status === 'rejected') {
      remarks = window.prompt('Rejection reason (optional):', '') || 'Request rejected by ACM.';
    }
    var res = await api.patch('/api/cert-requests', { id: id, status: status, remarks: remarks });
    if (!res || !res.ok) {
      alert('Failed to update request.');
      return;
    }
    await renderAcmModule();
  };

  async function acmEnsureStudents() {
    if (window._acmStudentsCache) return window._acmStudentsCache;
    var data = await apiReqQuiet('/api/students?_ts=' + Date.now());
    window._acmStudentsCache = (data && data.students) ? data.students : [];
    return window._acmStudentsCache;
  }

  function acmFindStudent(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return null;
    var list = window._acmStudentsCache || [];
    return list.find(function (s) {
      return String(s.reg_no || '').toLowerCase() === q ||
        String(s.name || '').toLowerCase() === q ||
        String(s.display_name || '').toLowerCase() === q;
    }) || list.find(function (s) {
      var hay = [s.reg_no, s.name, s.display_name, s.email].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    }) || null;
  }

  function acmStudentCard(s) {
    if (!s) return '<div style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#991b1b;font-size:0.85rem;">Student not found in database.</div>';
    return '<div style="padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;">' +
      '<div style="font-weight:700;margin-bottom:8px;color:var(--navy);">' + acmEsc(s.name || s.display_name || '—') + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.82rem;">' +
      '<div><span style="opacity:.65;">Reg No</span><br><strong style="font-family:JetBrains Mono,monospace;">' + acmEsc(s.reg_no || '—') + '</strong></div>' +
      '<div><span style="opacity:.65;">Branch</span><br><strong>' + acmEsc(s.dept || '—') + '</strong></div>' +
      '<div><span style="opacity:.65;">Year</span><br><strong>' + acmEsc(s.year || '—') + '</strong></div>' +
      '<div><span style="opacity:.65;">Account</span><br><strong>' + acmEsc(s.account_status || '—') + '</strong></div>' +
      '</div></div>';
  }

  window.acmLookupIssueStudent = async function () {
    await acmEnsureStudents();
    var roots = acmActiveRoots();
    var root = roots.find(function (r) { return r.offsetParent !== null; }) || roots[0];
    if (!root) return;
    var regEl = root.querySelector('[data-acm-issue-reg="1"]');
    var box = root.querySelector('[data-acm-issue-student="1"]');
    if (!regEl || !box) return;
    var q = regEl.value.trim();
    if (!q) { box.innerHTML = ''; return; }
    box.innerHTML = acmStudentCard(acmFindStudent(q));
  };

  window.acmIssueCertificate = async function (markReady) {
    var roots = acmActiveRoots();
    var root = roots.find(function (r) { return r.offsetParent !== null; }) || roots[0];
    if (!root) return;
    var regEl = root.querySelector('[data-acm-issue-reg="1"]');
    var typeEl = root.querySelector('[data-acm-issue-type="1"]');
    var remEl = root.querySelector('[data-acm-issue-remarks="1"]');
    var out = root.querySelector('[data-acm-issue-out="1"]');
    var regNo = regEl ? regEl.value.trim() : '';
    var certType = typeEl ? typeEl.value : '';
    var remarks = remEl ? remEl.value.trim() : '';
    if (!regNo) { alert('Enter Register Number.'); return; }
    if (!certType) { alert('Select certificate type.'); return; }

    await acmEnsureStudents();
    var stu = acmFindStudent(regNo);
    var res = await api.post('/api/cert-requests', {
      certType: certType,
      regNo: regNo,
      studentName: stu ? (stu.name || stu.display_name) : undefined,
      branch: stu ? stu.dept : undefined,
      remarks: remarks || undefined,
      markReady: !!markReady,
      routedTo: 'ACM Section',
    });
    if (!res || !res.request) {
      alert('Failed to issue certificate. Check login / permissions.');
      return;
    }
    if (out) {
      out.style.display = 'block';
      out.innerHTML =
        '<div style="padding:14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;">' +
        '<div style="font-weight:700;color:#065f46;margin-bottom:6px;">✅ Certificate ' + (markReady ? 'issued (Ready)' : 'registered (Pending)') + '</div>' +
        '<div style="font-size:0.82rem;">Req ID: <strong style="font-family:JetBrains Mono,monospace;">' + acmEsc(res.request.req_code) + '</strong><br>' +
        'Student: <strong>' + acmEsc(res.request.student_name) + '</strong> · ' + acmEsc(res.request.reg_no) + '<br>' +
        'Type: <strong>' + acmEsc(res.request.cert_type) + '</strong></div></div>';
    }
    await renderAcmModule();
  };

  window.acmStudentLookup = async function () {
    await acmEnsureStudents();
    var roots = acmActiveRoots();
    var root = roots.find(function (r) { return r.offsetParent !== null; }) || roots[0];
    if (!root) return;
    var qEl = root.querySelector('[data-acm-lookup-q="1"]');
    var box = root.querySelector('[data-acm-lookup-result="1"]');
    if (!qEl || !box) return;
    var q = qEl.value.trim();
    if (q.length < 2) { box.innerHTML = ''; return; }
    var list = (window._acmStudentsCache || []).filter(function (s) {
      var hay = [s.reg_no, s.name, s.display_name, s.email, s.dept].join(' ').toLowerCase();
      return hay.indexOf(q.toLowerCase()) !== -1;
    }).slice(0, 12);
    if (!list.length) {
      box.innerHTML = '<div style="opacity:.7;padding:12px;">No students match “' + acmEsc(q) + '”.</div>';
      return;
    }
    box.innerHTML = list.map(function (s) { return '<div style="margin-bottom:8px;">' + acmStudentCard(s) + '</div>'; }).join('');
  };

  /* ---------- ACM PRINT / EXPORT (Branch + Year class list) ---------- */
  window._acmPrintClass = []; // students matching branch+year
  window._acmPrintMeta = { branch: '', year: '' };
  window._acmPrintFieldUnion = []; // available field labels (full My Profile schema)

  var ACM_PRINT_CORE_FIELDS = [
    'Name',
    'Register Number',
    'Father Name',
    'Date of Birth',
    'Branch',
    'Current Year',
    'Email',
    'Account Status',
    'CGPA',
    'Attendance',
  ];

  var ACM_PRINT_COMMON = [
    'Name', 'Father Name', 'Date of Birth', 'Register Number', 'Branch', 'Current Year',
  ];

  /** All My Profile field labels from student dashboard schema (+ core account fields). */
  function acmPrintAllProfileLabels() {
    var labels = [];
    var seen = {};
    function add(label) {
      label = String(label || '').trim();
      if (!label || seen[label]) return;
      // Skip photo field in print columns
      if (/profile\s*photo/i.test(label)) return;
      seen[label] = true;
      labels.push(label);
    }
    ACM_PRINT_CORE_FIELDS.forEach(add);
    // Live schema used on Student → My Profile (includes admin custom fields)
    try {
      var schema = (typeof stuProfileSchema !== 'undefined' && Array.isArray(stuProfileSchema))
        ? stuProfileSchema
        : (typeof defaultStuSections !== 'undefined' ? defaultStuSections : null);
      if (schema) {
        schema.forEach(function (sec) {
          if (sec && sec.visible === false) return;
          (sec.fields || []).forEach(function (f) {
            if (f && f.label) add(f.label);
          });
        });
      }
    } catch (e) { /* ignore */ }
    // Any extra keys already present on loaded class
    (window._acmPrintClass || []).forEach(function (s) {
      var extra = s && s.extra;
      if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch (e2) { extra = {}; }
      }
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(function (k) {
          if (k === 'profile_edit_locked') return;
          if (/photo/i.test(k)) return;
          add(k);
        });
      }
    });
    return labels;
  }

  function acmPrintActiveRoot() {
    // Prefer the print panel that is currently visible (tab open)
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-acm-print-fields="1"]'));
    var host = panels.find(function (el) {
      var tab = el.closest('#facAcmPrint, #adAcmPrint');
      if (!tab) return false;
      return tab.offsetParent !== null || (tab.style && tab.style.display !== 'none' && tab.offsetHeight > 0);
    }) || panels[0] || null;
    if (!host) return null;
    return host.closest('[data-acm-root="1"]') || host.closest('#facACM, #adACM') || host.parentElement;
  }

  function acmPrintBuildFieldMap(s) {
    var map = {};
    // Always include every My Profile column (empty if missing) so print columns stay complete
    acmPrintAllProfileLabels().forEach(function (k) { map[k] = ''; });
    if (!s) return map;

    var extra = s.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    if (!extra || typeof extra !== 'object') extra = {};

    function put(label, val) {
      if (val == null || String(val).trim() === '') return;
      map[label] = String(val);
    }

    put('Name', s.name || s.display_name);
    put('Register Number', s.reg_no);
    put('Email', s.email);
    put('Branch', s.dept);
    put('Current Year', s.year);
    put('Father Name', s.father);
    put('CGPA', s.cgpa);
    put('Attendance', s.att);
    put('Account Status', s.account_status);

    // Map extra keys onto schema labels (case/space tolerant)
    var labelByNorm = {};
    Object.keys(map).forEach(function (k) {
      labelByNorm[String(k).replace(/\s+/g, ' ').trim().toLowerCase()] = k;
    });

    Object.keys(extra).forEach(function (k) {
      if (k === 'profile_edit_locked') return;
      if (k === 'Profile Photo' || k === 'profile_photo' || k === 'photo') return;
      var v = extra[k];
      if (v == null || String(v).trim() === '') return;
      if (typeof v === 'string' && v.indexOf('data:image/') === 0) return;

      var nk = String(k).replace(/\s+/g, ' ').trim().toLowerCase();
      if (nk === 'student (as per sslc)' || nk === 'student (as per aadhar)') {
        if (!map['Name']) put('Name', v);
        put(labelByNorm[nk] || k, v);
        return;
      }
      if (nk === 'father name' || nk === 'father') {
        put('Father Name', v);
        return;
      }
      if (nk === 'date of birth' || nk === 'dob') {
        put('Date of Birth', v);
        return;
      }
      if (nk === 'branch') { put('Branch', v); return; }
      if (nk === 'current year') { put('Current Year', v); return; }
      if (nk === 'register number') { put('Register Number', v); return; }
      if (nk === 'valid e-mail id' || nk === 'email') {
        put(labelByNorm['valid e-mail id'] || 'Valid E-mail ID', v);
        if (!map['Email']) put('Email', v);
        return;
      }
      // Prefer exact schema label if we have a normalized match
      if (labelByNorm[nk]) put(labelByNorm[nk], v);
      else {
        map[k] = String(v); // keep unknown extra keys as columns too
      }
    });

    return map;
  }

  function acmPrintYearMatch(studentYear, filterYear) {
    if (!filterYear) return true;
    var y = String(studentYear || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var f = String(filterYear || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!y) return false;
    if (y === f || y.indexOf(f) !== -1 || f.indexOf(y) !== -1) return true;
    var yn = y.replace(/year/g, '').replace(/\s+/g, '');
    var fn = f.replace(/year/g, '').replace(/\s+/g, '');
    return !!(yn && fn && (yn.indexOf(fn) !== -1 || fn.indexOf(yn) !== -1));
  }

  function acmPrintBranchMatch(studentDept, filterBranch) {
    if (!filterBranch) return true;
    var d = String(studentDept || '').toLowerCase();
    var f = String(filterBranch || '').toLowerCase();
    return d && (d === f || d.indexOf(f) !== -1 || f.indexOf(d) !== -1);
  }

  function acmPrintGetSelectedLabels(root) {
    var labels = [];
    root.querySelectorAll('[data-acm-print-field]:checked').forEach(function (cb) {
      labels.push(cb.getAttribute('data-acm-print-field'));
    });
    return labels;
  }

  function acmPrintRenderFieldChecks(root, labels, preselect) {
    var host = root.querySelector('[data-acm-print-fields="1"]');
    if (!host) return;
    labels = (labels || []).slice().sort(function (a, b) {
      var ia = ACM_PRINT_CORE_FIELDS.indexOf(a);
      var ib = ACM_PRINT_CORE_FIELDS.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    var selSet = {};
    (preselect || ACM_PRINT_COMMON).forEach(function (k) { selSet[k] = true; });
    host.innerHTML = labels.map(function (label) {
      var checked = selSet[label] ? ' checked' : '';
      return '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.8rem;">' +
        '<input type="checkbox" data-acm-print-field="' + acmEsc(label) + '"' + checked +
        ' onchange="window.acmPrintRefreshPreview&&window.acmPrintRefreshPreview()" style="margin-top:2px;" />' +
        '<span><strong>' + acmEsc(label) + '</strong></span></label>';
    }).join('') || '<span style="opacity:.7;">No fields available.</span>';
  }

  function acmPrintClassTableHtml(students, labels, forPrint) {
    if (!students.length || !labels.length) {
      return '<span style="opacity:.65;">No data to show.</span>';
    }
    var th = labels.map(function (l) {
      return '<th style="text-align:left;padding:8px;border:1px solid ' +
        (forPrint ? '#cbd5e1' : 'var(--border)') + ';white-space:nowrap;font-size:0.78rem;">' +
        acmEsc(l) + '</th>';
    }).join('');
    var body = students.map(function (s) {
      var map = acmPrintBuildFieldMap(s);
      var tds = labels.map(function (l) {
        var v = map[l];
        v = (v == null || String(v).trim() === '') ? '—' : String(v);
        return '<td style="padding:8px;border:1px solid ' +
          (forPrint ? '#cbd5e1' : 'var(--border)') + ';font-size:0.8rem;">' +
          acmEsc(v) + '</td>';
      }).join('');
      return '<tr>' + tds + '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;min-width:480px;">' +
      '<thead><tr style="background:' + (forPrint ? '#f8fafc' : 'var(--bg)') + ';">' + th +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function acmPrintRefreshPreview() {
    var root = acmPrintActiveRoot();
    if (!root) return;
    var preview = root.querySelector('[data-acm-print-preview="1"]');
    if (!preview) return;
    var list = window._acmPrintClass || [];
    if (!list.length) {
      preview.innerHTML = '<span style="opacity:.65;">Load a Branch + Year class first.</span>';
      return;
    }
    var labels = acmPrintGetSelectedLabels(root);
    if (!labels.length) {
      preview.innerHTML = '<span style="opacity:.65;">Tick at least one field to preview.</span>';
      return;
    }
    var meta = window._acmPrintMeta || {};
    var head = '<div style="margin-bottom:10px;font-size:0.85rem;">' +
      '<strong>' + acmEsc(meta.branch || '—') + '</strong> · ' +
      acmEsc(meta.year || '—') +
      ' · <strong>' + list.length + '</strong> student(s) · showing selected fields only</div>';
    preview.innerHTML = head + acmPrintClassTableHtml(list, labels, false);
  }
  window.acmPrintRefreshPreview = acmPrintRefreshPreview;

  window.acmPrintSelectAll = function (on) {
    var root = acmPrintActiveRoot();
    if (!root) return;
    root.querySelectorAll('[data-acm-print-field]').forEach(function (cb) {
      cb.checked = !!on;
    });
    acmPrintRefreshPreview();
  };

  window.acmPrintSelectCommon = function () {
    var root = acmPrintActiveRoot();
    if (!root) return;
    var set = {};
    ACM_PRINT_COMMON.forEach(function (k) { set[k] = true; });
    root.querySelectorAll('[data-acm-print-field]').forEach(function (cb) {
      cb.checked = !!set[cb.getAttribute('data-acm-print-field')];
    });
    acmPrintRefreshPreview();
  };

  window.acmPrintLoadClass = async function () {
    // Always re-fetch students so year/branch data is fresh
    window._acmStudentsCache = null;
    await acmEnsureStudents();

    // Prefer root that has the print controls (visible or not)
    var root = acmPrintActiveRoot();
    if (!root) {
      // Fallback: any print branch select on the page
      var anyBranch = document.querySelector('[data-acm-print-branch="1"]');
      root = anyBranch ? (anyBranch.closest('[data-acm-root="1"]') || anyBranch.closest('#facACM, #adACM') || document) : null;
    }
    if (!root) {
      alert('Print panel not found. Open ACM Module → Print / Export.');
      return;
    }

    var branchEl = root.querySelector('[data-acm-print-branch="1"]') ||
      document.querySelector('#adAcmPrint [data-acm-print-branch="1"], #facAcmPrint [data-acm-print-branch="1"]');
    var yearEl = root.querySelector('[data-acm-print-year="1"]') ||
      document.querySelector('#adAcmPrint [data-acm-print-year="1"], #facAcmPrint [data-acm-print-year="1"]');
    var admEl = root.querySelector('[data-acm-print-adm-year="1"]') ||
      document.querySelector('#adAcmPrint [data-acm-print-adm-year="1"], #facAcmPrint [data-acm-print-adm-year="1"]');
    var branch = branchEl ? branchEl.value.trim() : '';
    var year = yearEl ? yearEl.value.trim() : '';
    var admYear = admEl ? admEl.value.trim() : '';
    if (!branch || !year) {
      alert('Please select both Branch and Year.');
      return;
    }

    function studentAdmYear(s) {
      var extra = s.extra || {};
      if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
      }
      var keys = ['Year of Admission', 'Year Of Admission', 'Admission Year'];
      for (var i = 0; i < keys.length; i++) {
        if (extra[keys[i]] != null && String(extra[keys[i]]).trim() !== '') {
          return String(extra[keys[i]]).trim();
        }
      }
      return '';
    }

    var all = window._acmStudentsCache || [];

    // Populate admission year dropdown options from loaded students (for this branch)
    var admYears = {};
    all.forEach(function (s) {
      if (!acmPrintBranchMatch(s.dept, branch)) return;
      var ay = studentAdmYear(s);
      if (ay) admYears[ay] = true;
    });
    document.querySelectorAll('[data-acm-print-adm-year="1"]').forEach(function (sel) {
      var prev = sel.value || admYear || '';
      var opts = '<option value="">All Adm. Years</option>';
      Object.keys(admYears).sort().reverse().forEach(function (y) {
        opts += '<option value="' + acmEsc(y) + '"' + (y === prev ? ' selected' : '') + '>' + acmEsc(y) + '</option>';
      });
      sel.innerHTML = opts;
      if (prev) sel.value = prev;
    });
    if (admEl) admYear = admEl.value.trim();

    var list = all.filter(function (s) {
      if (!acmPrintBranchMatch(s.dept, branch)) return false;
      if (!acmPrintYearMatch(s.year, year)) return false;
      if (admYear) {
        var ay = studentAdmYear(s);
        if (!ay || ay.indexOf(admYear) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      return String(a.name || a.display_name || '').localeCompare(String(b.name || b.display_name || ''));
    });

    window._acmPrintClass = list;
    window._acmPrintMeta = { branch: branch, year: year, admission_year: admYear };

    // Full My Profile column set (not only fields that happen to be filled)
    window._acmPrintFieldUnion = acmPrintAllProfileLabels();
    console.log('[acm-print] loaded', list.length, 'of', all.length, 'students for', branch, year,
      admYear ? ('adm ' + admYear) : '', '· columns', window._acmPrintFieldUnion.length);

    function paintRoot(r) {
      if (!r) return;
      var b = r.querySelector('[data-acm-print-branch="1"]');
      var y = r.querySelector('[data-acm-print-year="1"]');
      var a = r.querySelector('[data-acm-print-adm-year="1"]');
      var m = r.querySelector('[data-acm-print-class-meta="1"]');
      if (b) b.value = branch;
      if (y) y.value = year;
      if (a && admYear) a.value = admYear;
      var label = acmEsc(branch) + '</strong> · <strong>' + acmEsc(year) +
        (admYear ? '</strong> · Adm. <strong>' + acmEsc(admYear) : '');
      if (m) {
        m.innerHTML = list.length
          ? 'Loaded <strong>' + list.length + '</strong> student(s) for <strong>' +
            label + '</strong>. ' +
            'Select columns below (all My Profile fields are listed).'
          : 'No students found for <strong>' + label + '</strong>. You can still pick columns; list will be empty until data matches.';
      }
      if (r.querySelector('[data-acm-print-fields="1"]')) {
        acmPrintRenderFieldChecks(r, window._acmPrintFieldUnion, ACM_PRINT_COMMON);
      }
    }

    // Paint every ACM print surface (admin + faculty shells)
    document.querySelectorAll('#facACM, #adACM, [data-acm-root="1"]').forEach(paintRoot);
    // Also paint by panel id if nested oddly
    ;['facAcmPrint', 'adAcmPrint'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) paintRoot(el);
    });

    acmPrintRefreshPreview();
  };

  /** Show full field checklist as soon as Print tab is opened. */
  window.acmPrintInitFields = function () {
    window._acmPrintFieldUnion = acmPrintAllProfileLabels();
    ;['facAcmPrint', 'adAcmPrint'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.querySelector('[data-acm-print-fields="1"]')) {
        acmPrintRenderFieldChecks(el, window._acmPrintFieldUnion, ACM_PRINT_COMMON);
      }
    });
  };

  function acmPrintBuildDocumentHtml(students, labels, meta) {
    var today = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>ACM Class List — ' +
      acmEsc(meta.branch || '') + ' ' + acmEsc(meta.year || '') + '</title>' +
      '<style>body{font-family:\'Segoe UI\',system-ui,sans-serif;color:#0f172a;padding:24px;}' +
      'h1{font-size:1.15rem;margin:0 0 4px;color:#1e3a5f;}' +
      '.meta{font-size:0.85rem;color:#64748b;margin-bottom:14px;}' +
      'table{width:100%;border-collapse:collapse;font-size:0.82rem;}' +
      'th,td{padding:8px;border:1px solid #cbd5e1;text-align:left;}' +
      'th{background:#f8fafc;}' +
      '@media print{body{padding:10px;} .no-print{display:none!important;}}</style></head><body>' +
      '<h1>Government Polytechnic, Hubli</h1>' +
      '<div class="meta">ACM Section · Student Data Extract · ' + acmEsc(today) + '</div>' +
      '<div class="meta"><strong>' + acmEsc(meta.branch || '—') + '</strong> · ' +
      acmEsc(meta.year || '—') +
      (meta.admission_year ? ' · Adm. ' + acmEsc(meta.admission_year) : '') +
      ' · ' + students.length + ' student(s)</div>' +
      acmPrintClassTableHtml(students, labels, true) +
      '<p class="meta" style="margin-top:20px;">Live student database · Only selected fields included</p>' +
      '</body></html>';
  }

  function acmPrintResolveLabelsAndList() {
    var root = acmPrintActiveRoot();
    // Fallback: read checkboxes from any visible print panel
    if (!root || !root.querySelector('[data-acm-print-field]')) {
      var panel = document.getElementById('adAcmPrint') || document.getElementById('facAcmPrint');
      if (panel) root = panel;
    }
    var list = window._acmPrintClass || [];
    if (!list.length) {
      alert('Load students by Branch + Year first (click Load Students).');
      return null;
    }
    var labels = root ? acmPrintGetSelectedLabels(root) : [];
    // Fallback: checkboxes anywhere in print panels
    if (!labels.length) {
      document.querySelectorAll('#adAcmPrint [data-acm-print-field]:checked, #facAcmPrint [data-acm-print-field]:checked').forEach(function (cb) {
        labels.push(cb.getAttribute('data-acm-print-field'));
      });
    }
    if (!labels.length) {
      alert('Select at least one field (column) to print.');
      return null;
    }
    return { list: list, labels: labels, meta: window._acmPrintMeta || {} };
  }

  /**
   * Reliable print/PDF:
   * 1) Blob URL tab (shows real HTML — not about:blank)
   * 2) Hidden iframe.print() fallback
   * Note: window.open('',…) + noopener leaves a blank tab in modern Chrome.
   */
  function acmPrintOpenPrintWindow(forPdf) {
    var ctx = acmPrintResolveLabelsAndList();
    if (!ctx) return;
    var html = acmPrintBuildDocumentHtml(ctx.list, ctx.labels, ctx.meta);
    if (!html || html.length < 50) {
      alert('Could not build print document.');
      return;
    }

    function triggerPrint(win) {
      if (!win) return;
      try {
        win.focus();
        // Wait for layout/images
        setTimeout(function () {
          try { win.print(); } catch (e) {
            console.error('[acm-print] print()', e);
          }
        }, 400);
      } catch (e2) {
        console.error('[acm-print] focus/print', e2);
      }
    }

    // --- Primary: Blob URL (content always visible in the new tab) ---
    try {
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var w = window.open(url, '_blank');
      if (w) {
        // onload may or may not fire for blob URLs depending on browser
        var printed = false;
        function doPrintOnce() {
          if (printed) return;
          printed = true;
          triggerPrint(w);
          // Keep blob alive long enough for print dialog
          setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
          }, 120000);
        }
        try {
          w.addEventListener('load', doPrintOnce);
        } catch (e3) { /* ignore */ }
        setTimeout(doPrintOnce, 600);
        if (forPdf) {
          // Soft hint once
          console.log('[acm-print] In the print dialog pick “Save as PDF” / “Microsoft Print to PDF”.');
        }
        return;
      }
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[acm-print] blob open failed', e);
    }

    // --- Fallback: hidden iframe print (no popup needed) ---
    try {
      var iframe = document.getElementById('acmPrintFrame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'acmPrintFrame';
        iframe.setAttribute('title', 'ACM Print');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
        document.body.appendChild(iframe);
      }
      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!doc) {
        alert('Print failed. Allow pop-ups for this site and try again.');
        return;
      }
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(function () {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e4) {
          console.error('[acm-print] iframe print', e4);
          alert('Print failed. Please allow pop-ups, then try Direct Print again.');
        }
      }, 350);
    } catch (e5) {
      console.error('[acm-print] iframe fallback', e5);
      alert('Print failed: ' + ((e5 && e5.message) || 'unknown error'));
    }
  }

  window.acmPrintDirect = function () {
    acmPrintOpenPrintWindow(false);
  };

  window.acmPrintPdf = function () {
    // Same pipeline as Direct Print — user chooses “Save as PDF” in the system dialog
    acmPrintOpenPrintWindow(true);
  };

  window.acmExportExcel = function () {
    var root = acmPrintActiveRoot();
    if (!root) return;
    var list = window._acmPrintClass || [];
    if (!list.length) {
      alert('Load students by Branch + Year first.');
      return;
    }
    var labels = acmPrintGetSelectedLabels(root);
    if (!labels.length) {
      alert('Select at least one field to export.');
      return;
    }
    var meta = window._acmPrintMeta || {};
    function csvCell(v) {
      var s = String(v == null ? '' : v);
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [labels.map(csvCell).join(',')];
    list.forEach(function (stu) {
      var map = acmPrintBuildFieldMap(stu);
      lines.push(labels.map(function (l) {
        var v = map[l];
        return csvCell(v == null || String(v).trim() === '' ? '' : v);
      }).join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var slug = [meta.branch, meta.year].join('_').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
    a.href = url;
    a.download = 'ACM_Class_' + slug + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 500);
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

  /* ---------- CMS private login gate (no public homepage) ---------- */
  function installCmsLoginGate() {
    var landing = document.getElementById('landingPage');
    if (!landing) return;
    if (document.getElementById('cmsLoginGate')) {
      window.showCmsLoginGate();
      return;
    }

    var gate = document.createElement('div');
    gate.id = 'cmsLoginGate';
    gate.innerHTML =
      '<div class="cms-shell">' +
      '<div class="cms-bg" aria-hidden="true">' +
      '<img src="/images/campus-building.jpg" alt="" />' +
      '<div class="cms-bg-overlay"></div>' +
      '</div>' +
      '<div class="cms-card">' +
      '<div class="cms-card-hd">' +
      '<img class="cms-logo" src="/images/college-logo.jpg" alt="Government Polytechnic Hubballi" ' +
      'onerror="this.onerror=null;this.src=\'/images/college-logo.png\'" />' +
      '<h1>Government Polytechnic Hubballi</h1>' +
      '<p>Management Information System<br>Dept. of Technical Education, Karnataka · Estd. 2009</p>' +
      '<div class="cms-badge">Secure CMS Login</div>' +
      '</div>' +
      '<div class="cms-card-bd">' +
      '<div class="cms-roles" id="cmsRoleTabs">' +
      '<button type="button" class="cms-role act" data-cms-role="student">🎓 Student</button>' +
      '<button type="button" class="cms-role" data-cms-role="faculty">👨‍🏫 Faculty / Staff</button>' +
      '<button type="button" class="cms-role" data-cms-role="principal">👔 Principal</button>' +
      '<button type="button" class="cms-role" data-cms-role="admin">⚙️ Admin / ACM</button>' +
      '</div>' +
      '<div class="cms-fg"><label>Username / Register No. / Email</label>' +
      '<input type="text" id="cmsLoginId" autocomplete="username" placeholder="e.g. 171CS15003 or email" /></div>' +
      '<div class="cms-fg"><label>Password</label>' +
      '<input type="password" id="cmsLoginPw" autocomplete="current-password" placeholder="Enter password" /></div>' +
      '<div class="cms-msg" id="cmsLoginMsg"></div>' +
      '<button type="button" class="cms-submit" id="cmsLoginBtn">Sign in →</button>' +
      '<div class="cms-foot">' +
      'Private portal — authorised users only.<br>' +
      '<a href="/student" style="display:inline-block;margin:6px 0 2px;font-weight:700;">📱 Open Student Mobile App</a><br>' +
      '<a id="cmsRegisterLink" href="#">New student? Create account</a>' +
      '</div></div></div></div>';

    landing.insertBefore(gate, landing.firstChild);

    window._cmsLoginRole = 'student';

    function updateCmsRegisterLink() {
      var regLinkEl = document.getElementById('cmsRegisterLink');
      if (!regLinkEl) return;
      var r = window._cmsLoginRole || 'student';
      if (r === 'faculty') regLinkEl.textContent = 'Faculty / Staff? Create account';
      else if (r === 'principal') regLinkEl.textContent = 'Principal? Create account';
      else if (r === 'admin') regLinkEl.textContent = 'Admin / ACM? Create account';
      else regLinkEl.textContent = 'New student? Create account';
    }

    gate.querySelectorAll('[data-cms-role]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        gate.querySelectorAll('[data-cms-role]').forEach(function (b) { b.classList.remove('act'); });
        btn.classList.add('act');
        window._cmsLoginRole = btn.getAttribute('data-cms-role') || 'student';
        var id = document.getElementById('cmsLoginId');
        if (id) {
          id.placeholder = window._cmsLoginRole === 'student'
            ? 'Register number or email'
            : 'Username or email';
        }
        updateCmsRegisterLink();
      });
    });
    updateCmsRegisterLink();

    function setMsg(text, isError) {
      var msg = document.getElementById('cmsLoginMsg');
      if (!msg) return;
      msg.textContent = text || '';
      msg.style.color = isError ? '#991b1b' : '#065f46';
    }

    async function doCmsLogin() {
      var idEl = document.getElementById('cmsLoginId');
      var pwEl = document.getElementById('cmsLoginPw');
      var btn = document.getElementById('cmsLoginBtn');
      var identifier = idEl ? idEl.value.trim() : '';
      var password = pwEl ? pwEl.value : '';
      if (!identifier || !password) {
        setMsg('Enter username / register number and password.', true);
        if (idEl && !identifier) idEl.focus();
        else if (pwEl) pwEl.focus();
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
      setMsg('');
      try {
        var r = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: identifier, password: password }),
        });
        var res = await r.json().catch(function () { return null; });
        if (!r.ok) {
          setMsg((res && res.error) ? res.error : ('Login failed (HTTP ' + r.status + ')'), true);
          return;
        }
        if (!res || !res.user) {
          setMsg('Login failed — no user returned.', true);
          return;
        }
        if (pwEl) pwEl.value = '';
        window.hideCmsLoginGate();
        openDashboardFor(res.user);
        await afterAuth(res.user);
      } catch (e) {
        setMsg('Network error. Please try again.', true);
        console.error('[cms-login]', e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in →'; }
      }
    }

    var submitBtn = document.getElementById('cmsLoginBtn');
    if (submitBtn) submitBtn.addEventListener('click', doCmsLogin);
    ;['cmsLoginId', 'cmsLoginPw'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doCmsLogin();
        }
      });
    });

    var regLink = document.getElementById('cmsRegisterLink');
    if (regLink) {
      regLink.addEventListener('click', function (e) {
        e.preventDefault();
        // Open Create Account for the role selected on the CMS gate
        // (student / faculty / principal / admin — not student-only)
        var roleKey = window._cmsLoginRole || 'student';
        var modalMap = {
          student: { modal: 'mStudent', reg: 'stuRegister', login: 'stuLogin', tab2: 'stuTab2', tab1: 'stuTab1' },
          faculty: { modal: 'mFaculty', reg: 'facRegister', login: 'facLogin', tab2: 'facTab2', tab1: 'facTab1' },
          principal: { modal: 'mPrincipal', reg: 'priRegister', login: 'priLogin', tab2: 'priTab2', tab1: 'priTab1' },
          admin: { modal: 'mAdmin', reg: 'adRegister', login: 'adLogin', tab2: 'adTab2', tab1: 'adTab1' },
        };
        var cfg = modalMap[roleKey] || modalMap.student;
        if (typeof window.openM === 'function') {
          window.openM(cfg.modal);
        } else {
          var ov = document.getElementById(cfg.modal);
          if (ov) ov.classList.add('open');
        }
        // Prefer Create Account tab
        if (typeof window.switchTab === 'function') {
          try { window.switchTab(cfg.reg, cfg.login, cfg.tab2, cfg.tab1); } catch (err) { /* ignore */ }
        } else {
          var tab = document.getElementById(cfg.tab2);
          if (tab) try { tab.click(); } catch (err2) { /* ignore */ }
        }
        var regPanel = document.getElementById(cfg.reg);
        var loginPanel = document.getElementById(cfg.login);
        if (regPanel) regPanel.style.display = 'block';
        if (loginPanel) loginPanel.style.display = 'none';
        var t1 = document.getElementById(cfg.tab1);
        var t2 = document.getElementById(cfg.tab2);
        if (t1) t1.classList.remove('active');
        if (t2) t2.classList.add('active');
      });
    }

    window.showCmsLoginGate = function () {
      document.documentElement.classList.add('cms-login-mode');
      document.body.classList.add('cms-login-mode');
      var lp = document.getElementById('landingPage');
      if (lp) {
        lp.style.display = 'block';
      }
      // Hide all dashboards
      ;['dbAdmin', 'dbStudent', 'dbFaculty', 'dbPrincipal'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('show');
      });
      document.querySelectorAll('.overlay.open').forEach(function (o) {
        o.classList.remove('open');
      });
      var gateEl = document.getElementById('cmsLoginGate');
      if (gateEl) gateEl.style.display = 'flex';
      // Hide demo bars always in CMS mode
      document.querySelectorAll('.demo-bar, #demoBar').forEach(function (b) {
        b.style.display = 'none';
      });
      window.scrollTo(0, 0);
      setTimeout(function () {
        var idFocus = document.getElementById('cmsLoginId');
        if (idFocus) idFocus.focus();
      }, 80);
    };

    window.hideCmsLoginGate = function () {
      document.documentElement.classList.remove('cms-login-mode');
      document.body.classList.remove('cms-login-mode');
      var gateEl = document.getElementById('cmsLoginGate');
      if (gateEl) gateEl.style.display = 'none';
      var lp = document.getElementById('landingPage');
      if (lp) lp.style.display = 'none';
    };

    window.cmsDoLogin = doCmsLogin;
    window.showCmsLoginGate();
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
    installCmsLoginGate();
    /* registration is handled by the window.createAccount override above */
    // Public marketing content is no longer shown; skip public hydrations that need landing
    try { hydratePublic(); } catch (e) { /* ignore */ }
    var me = await apiReqQuiet('/api/auth/me');
    if (me && me.user) {
      window.hideCmsLoginGate && window.hideCmsLoginGate();
      openDashboardFor(me.user);
      await afterAuth(me.user);
    } else {
      window.showCmsLoginGate && window.showCmsLoginGate();
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
   Lives outside __initGptBridge so it must NOT call closed-over
   helpers like apiReqQuiet. Use window.api + local quiet GET.
   ================================================================ */
async function profileApiGet(path) {
  try {
    var url = path;
    if (url.indexOf('_ts=') === -1) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + '_ts=' + Date.now();
    }
    var res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) {
      // 401 before login is expected — stay quiet (CMS login gate)
      if (res.status !== 401 && res.status !== 403) {
        console.warn('[bridge] profile GET failed', path, res.status);
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[bridge] profile GET network error', path, e);
    return null;
  }
}

window._stuProfileEditEnabled = false;
window._stuProfileEditLocked = false;

/**
 * Apply approved student data (core columns + extra JSON) onto the live My Profile schema.
 * Keys in extra are field labels (e.g. "WhatsApp Number").
 */
function applyLiveStudentProfile(stu, reg) {
  if (!stu || typeof stuProfileSchema === 'undefined' || !Array.isArray(stuProfileSchema)) return;

  var extra = stu.extra || {};
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
  }
  if (!extra || typeof extra !== 'object') extra = {};

  // Locked only after Admin explicitly locks (Approve & Lock / Lock Edit).
  // First-time students (no lock flag) may request profile edits freely.
  window._stuProfileEditLocked = extra.profile_edit_locked === true || extra.profile_edit_locked === 'true';
  window._stuProfileFirstTime = !window._stuProfileEditLocked &&
    Object.keys(extra).filter(function (k) { return k !== 'profile_edit_locked'; }).length < 6;

  // Normalize labels for matching (trim + collapse spaces + case-insensitive map)
  var valuesByNorm = {};
  function normLabel(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function setValue(label, val) {
    if (val == null) return;
    valuesByNorm[normLabel(label)] = String(val);
  }

  Object.keys(extra).forEach(function (k) {
    if (k === 'profile_edit_locked') return;
    if (extra[k] != null) setValue(k, extra[k]);
  });

  // Migrate legacy single-line fee strings into structured Amount field when new keys empty
  function migrateLegacyFee(legacyKey, amountKey) {
    var leg = valuesByNorm[normLabel(legacyKey)];
    var amt = valuesByNorm[normLabel(amountKey)];
    if (leg && !amt) setValue(amountKey, leg);
  }
  migrateLegacyFee('1st Year Fee Paid', '1st Year Fee Amount');
  migrateLegacyFee('2nd Year Fee Paid', '2nd Year Fee Amount');
  migrateLegacyFee('3rd Year Fee Paid', '3rd Year Fee Amount');

  // Normalize year labels to dropdown options
  var yearRaw = valuesByNorm[normLabel('Current Year')] || (stu.year != null ? String(stu.year) : '');
  if (yearRaw) {
    var y = yearRaw.replace(/\s+/g, ' ').trim().toLowerCase();
    var mapped = yearRaw;
    if (y.indexOf('1') === 0 || y.indexOf('first') >= 0) mapped = '1st Year';
    else if (y.indexOf('2') === 0 || y.indexOf('second') >= 0) mapped = '2nd Year';
    else if (y.indexOf('3') === 0 || y.indexOf('third') >= 0) mapped = '3rd Year';
    else if (y.indexOf('back') >= 0) mapped = 'YEAR BACK';
    else if (y.indexOf('complete') >= 0) mapped = 'Completed';
    setValue('Current Year', mapped);
  }

  // Core students table columns always win for their mapped labels when set
  if (stu.year != null && String(stu.year).trim() !== '') {
    // Prefer already-normalized Current Year from extra when present
    if (!valuesByNorm[normLabel('Current Year')]) setValue('Current Year', stu.year);
  }
  if (stu.dept != null && String(stu.dept).trim() !== '' && String(stu.dept) !== 'Not set') {
    setValue('Branch', stu.dept);
  }
  if (reg) setValue('Register Number', reg);
  if (stu.father != null && String(stu.father).trim() !== '') setValue('Father Name', stu.father);
  if (stu.name != null && String(stu.name).trim() !== '') {
    if (!valuesByNorm[normLabel('Student (As per SSLC)')]) setValue('Student (As per SSLC)', stu.name);
    if (!valuesByNorm[normLabel('Student (As per Aadhar)')]) setValue('Student (As per Aadhar)', stu.name);
  }

  var applied = 0;
  stuProfileSchema.forEach(function (sec) {
    (sec.fields || []).forEach(function (field) {
      var key = normLabel(field.label);
      if (Object.prototype.hasOwnProperty.call(valuesByNorm, key)) {
        field.value = valuesByNorm[key];
        applied++;
      }
    });
  });

  console.log('[bridge] applyLiveStudentProfile reg=', reg, 'fields applied=', applied,
    'extra keys=', Object.keys(extra).length);

  // Approved profile photo (data URL stored in students.extra after Admin approval)
  applyStudentProfilePhotoFromExtra(extra);

  if (typeof renderStuDynamicProfile === 'function') renderStuDynamicProfile();
  updateStuProfileLockUI();
}
window.applyLiveStudentProfile = applyLiveStudentProfile;

/** Paint student avatars from a data-URL photo string. */
function paintStudentPhoto(dataURL, source) {
  if (!dataURL || typeof dataURL !== 'string' || dataURL.indexOf('data:image/') !== 0) return false;
  try {
    if (typeof userPhotos !== 'undefined') userPhotos.stu = dataURL;
  } catch (e) { /* ignore */ }
  if (typeof window.applyPhotoEverywhere === 'function') {
    window.applyPhotoEverywhere('stu', dataURL);
  } else if (typeof applyPhotoEverywhere === 'function') {
    applyPhotoEverywhere('stu', dataURL);
  }
  console.log('[bridge] applied student photo from ' + (source || 'unknown') +
    ' (' + Math.round(dataURL.length / 1024) + ' KB data URL)');
  return true;
}

/** Read Profile Photo from students.extra and paint avatars / photo circle. */
function applyStudentProfilePhotoFromExtra(extra) {
  // Draft / pending-submit photo wins over older approved photo while student is editing
  if (window._stuPendingPhoto && paintStudentPhoto(window._stuPendingPhoto, 'pending-draft')) {
    return;
  }
  if (!extra || typeof extra !== 'object') return;
  var photo =
    extra['Profile Photo'] ||
    extra['profile_photo'] ||
    extra['photo'] ||
    extra['ProfilePhoto'] ||
    null;
  if (!photo || typeof photo !== 'string') return;
  // Only accept image data URLs (never arbitrary remote HTML)
  if (photo.indexOf('data:image/') !== 0) {
    console.warn('[bridge] ignoring non-data-url profile photo');
    return;
  }
  window._stuPendingPhoto = null;
  paintStudentPhoto(photo, 'students.extra');
}
window.applyStudentProfilePhotoFromExtra = applyStudentProfilePhotoFromExtra;

/** Ensure Print full profile (A4) button exists next to Request Update. */
function ensureStuProfilePrintButton() {
  if (!window.currentUser || window.currentUser.role !== 'student') return;
  if (document.getElementById('stuProfilePrintBtn')) return;
  var updateBtn = document.getElementById('stuProfileUpdateBtn');
  var host = updateBtn && updateBtn.parentNode;
  if (!host) {
    host = document.getElementById('stuDynamicProfileSections');
    if (host) host = host.parentNode;
  }
  if (!host) return;

  var wrap = document.createElement('div');
  wrap.id = 'stuProfilePrintWrap';
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center;';

  var printBtn = document.createElement('button');
  printBtn.id = 'stuProfilePrintBtn';
  printBtn.type = 'button';
  printBtn.className = 'btn ol';
  printBtn.style.cssText = 'margin-top:0;';
  printBtn.textContent = '🖨️ Print full profile (A4)';
  printBtn.onclick = function () {
    if (typeof window.stuPrintFullProfile === 'function') window.stuPrintFullProfile();
  };

  if (updateBtn && updateBtn.parentNode === host) {
    // Group print + update side by side
    host.insertBefore(wrap, updateBtn);
    wrap.appendChild(printBtn);
    wrap.appendChild(updateBtn);
    updateBtn.style.marginTop = '0';
  } else {
    host.appendChild(wrap);
    wrap.appendChild(printBtn);
  }
}
window.ensureStuProfilePrintButton = ensureStuProfilePrintButton;

/**
 * Print complete student profile on a single A4 sheet (student web portal).
 * Uses live students cache / dynamic form fields / photo.
 */
window.stuPrintFullProfile = function () {
  try {
    var reg = (window.currentUser && window.currentUser.reg_no) || '';
    var stu = null;
    if (reg && typeof students !== 'undefined' && students) {
      stu = students[reg] || students[String(reg).toUpperCase()] || null;
      if (!stu) {
        Object.keys(students).forEach(function (k) {
          if (String(k).toUpperCase() === String(reg).toUpperCase()) stu = students[k];
        });
      }
    }
    var extra = (stu && stu.extra && typeof stu.extra === 'object') ? stu.extra : {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }

    // Merge visible form values (current on-screen profile)
    var fields = {};
    Object.keys(extra).forEach(function (k) { fields[k] = extra[k]; });
    var container = document.getElementById('stuDynamicProfileSections');
    if (container) {
      container.querySelectorAll('.fg').forEach(function (fg) {
        var label = fg.querySelector('label');
        var field = fg.querySelector('input, textarea, select');
        if (!label || !field) return;
        var labelText = (label.textContent || '').replace(/✏️.*$/, '').trim();
        if (!labelText) return;
        fields[labelText] = field.value;
      });
    }

    var photo = '';
    if (window._stuPendingPhoto && String(window._stuPendingPhoto).indexOf('data:image/') === 0) {
      photo = window._stuPendingPhoto;
    } else if (typeof userPhotos !== 'undefined' && userPhotos && userPhotos.stu &&
      String(userPhotos.stu).indexOf('data:image/') === 0) {
      photo = userPhotos.stu;
    } else {
      ;['Profile Photo', 'profile_photo', 'photo', 'Photo'].forEach(function (k) {
        if (!photo && typeof fields[k] === 'string' && fields[k].indexOf('data:image/') === 0) photo = fields[k];
      });
    }

    var name = (stu && stu.name) || (window.currentUser && window.currentUser.display_name) ||
      fields['Student (As per SSLC)'] || fields['Student (As per Aadhar)'] || '';
    var branch = (stu && stu.dept) || fields.Branch || (window.currentUser && window.currentUser.branch) || '';
    var year = (stu && stu.year) || fields['Current Year'] || '';
    var father = (stu && stu.father) || fields['Father Name'] || '';
    var mother = fields['Mother Name'] || fields["Mother's Name"] || '';
    var email = (window.currentUser && window.currentUser.email) || fields.Email || fields['Valid E-mail ID'] || '';

    var html = buildStudentFullProfilePrintHtml({
      name: name,
      reg_no: reg || fields['Register Number'] || '',
      branch: branch,
      year: year,
      father: father,
      mother: mother,
      email: email,
      cgpa: (stu && stu.cgpa) || '',
      attendance: (stu && stu.att) || '',
      photo: photo,
      fields: fields,
    });
    doStudentProfilePrintHtml(html);
  } catch (err) {
    console.error('[stuPrintFullProfile]', err);
    alert('Could not open profile print. Please refresh and try again.');
  }
};

function escProfilePrint(v) {
  var d = document.createElement('div');
  d.textContent = v == null ? '' : String(v);
  return d.innerHTML;
}

function profilePrintDisplay(v) {
  if (v == null) return '—';
  var s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  if (s.indexOf('data:image/') === 0) return '—';
  if (s.length > 220 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 60))) return '—';
  return s;
}

function buildStudentFullProfilePrintHtml(input) {
  input = input || {};
  var fields = (input.fields && typeof input.fields === 'object') ? input.fields : {};
  var skip = {
    profile_edit_locked: 1, imported_from_excel: 1, imported_at: 1, imported_missing_ece: 1,
    email_source: 1, 'Profile Photo': 1, profile_photo: 1, ProfilePhoto: 1, photo: 1, Photo: 1,
  };
  var coreOrder = [
    ['Register Number', input.reg_no || fields['Register Number']],
    ['Student Name', input.name || fields['Student (As per SSLC)'] || fields['Student (As per Aadhar)']],
    ['Student (As per SSLC)', fields['Student (As per SSLC)']],
    ['Student (As per Aadhar)', fields['Student (As per Aadhar)']],
    ['Father Name', input.father || fields['Father Name']],
    ['Mother Name', input.mother || fields['Mother Name']],
    ['Branch', input.branch || fields.Branch],
    ['Current Year', input.year || fields['Current Year']],
    ['Date of Birth', fields['Date of Birth']],
    ['Gender', fields.Gender],
    ['Category', fields.Category],
    ['Religion', fields.Religion],
    ['Caste', fields.Caste],
    ['Aadhar Number', fields['Aadhar Number']],
    ['APAAR ID', fields['APAAR ID']],
    ['SSP ID', fields['SSP ID']],
    ['NSP ID', fields['NSP ID']],
    ['Email', input.email || fields.Email || fields['Valid E-mail ID']],
    ['Valid E-mail ID', fields['Valid E-mail ID']],
    ['WhatsApp Number', fields['WhatsApp Number'] || fields['Student Mobile'] || fields['Aadhar Registered Mobile']],
    ['Parents Mobile Number', fields['Parents Mobile Number'] || fields['Parent Mobile']],
    ['Home Address', fields['Home Address']],
    ['Date of Admission', fields['Date of Admission'] || fields['Date and Year Of Admission']],
    ['Year of Admission', fields['Year of Admission'] || fields['Year Of Admission']],
    ['Staying in Hostel?', fields['Staying in Hostel?'] || fields['Are you staying in Hostel ?']],
    ['Hostel Name', fields['Hostel Name']],
    ['CGPA', input.cgpa],
    ['Attendance', input.attendance],
  ];
  var seen = {};
  var rows = [];
  coreOrder.forEach(function (pair) {
    var label = pair[0];
    var raw = pair[1];
    var key = label.toLowerCase();
    if (seen[key]) return;
    var val = profilePrintDisplay(raw);
    var always = label === 'Register Number' || label === 'Student Name' || label === 'Branch' ||
      label === 'Current Year' || label === 'Email';
    if (val === '—' && !always) return;
    if (label === 'Student (As per SSLC)' && val === profilePrintDisplay(input.name)) return;
    if (label === 'Valid E-mail ID' && val === profilePrintDisplay(input.email)) return;
    seen[key] = 1;
    rows.push({ label: label, value: val });
  });
  Object.keys(fields).sort().forEach(function (k) {
    if (skip[k]) return;
    if (seen[k.toLowerCase()]) return;
    if (typeof fields[k] === 'string' && fields[k].indexOf('data:image/') === 0) return;
    var val = profilePrintDisplay(fields[k]);
    if (val === '—') return;
    seen[k.toLowerCase()] = 1;
    rows.push({ label: k, value: val });
  });

  var mid = Math.ceil(rows.length / 2);
  var left = rows.slice(0, mid);
  var right = rows.slice(mid);
  function colHtml(list) {
    return list.map(function (r) {
      return '<tr><td class="k">' + escProfilePrint(r.label) + '</td><td class="v">' + escProfilePrint(r.value) + '</td></tr>';
    }).join('');
  }
  var photo = (input.photo && String(input.photo).indexOf('data:image/') === 0) ? String(input.photo) : '';
  var photoBlock = photo
    ? '<div class="photo"><img src="' + photo.replace(/"/g, '') + '" alt="Photo" /></div>'
    : '<div class="photo empty">No photo</div>';
  var now = new Date();
  var printDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  var printTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Student Profile — ' + escProfilePrint(input.reg_no) + '</title>' +
    '<style>' +
    '@page{size:A4;margin:10mm 11mm;}' +
    '*{box-sizing:border-box;}html,body{margin:0;padding:0;}' +
    'body{font-family:"Segoe UI",system-ui,-apple-system,"Times New Roman",serif;color:#0f172a;font-size:9.5pt;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
    '.hdr{display:flex;align-items:center;gap:10px;border-bottom:2px solid #0f2d5c;padding-bottom:6px;margin-bottom:8px;}' +
    '.hdr img.logo{width:42px;height:42px;object-fit:contain;}' +
    '.hdr .titles{flex:1;text-align:center;}' +
    '.hdr .titles .gov{font-size:8.5pt;font-weight:700;color:#1e3a5f;}' +
    '.hdr .titles .college{font-size:12pt;font-weight:800;color:#0f2d5c;margin-top:1px;}' +
    '.hdr .titles .sub{font-size:8pt;color:#475569;margin-top:1px;}' +
    '.hdr .titles .doc{font-size:10.5pt;font-weight:800;text-decoration:underline;margin-top:4px;color:#0f2d5c;}' +
    '.meta{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;}' +
    '.identity{flex:1;min-width:0;}' +
    '.identity h1{margin:0;font-size:13pt;color:#0f2d5c;}' +
    '.identity .line{margin-top:3px;font-size:9pt;color:#334155;font-family:ui-monospace,Consolas,monospace;}' +
    '.identity .chips{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px;}' +
    '.chip{display:inline-block;padding:2px 7px;border-radius:999px;background:#e8f0fe;color:#1a4fa0;font-size:7.5pt;font-weight:700;}' +
    '.photo{width:88px;height:105px;border:1.5px solid #0f2d5c;overflow:hidden;flex-shrink:0;background:#f8fafc;}' +
    '.photo img{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.photo.empty{display:flex;align-items:center;justify-content:center;font-size:8pt;color:#94a3b8;}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;width:100%;}' +
    'table.fields{width:100%;border-collapse:collapse;table-layout:fixed;}' +
    'table.fields td{padding:2.5px 4px;vertical-align:top;border-bottom:1px solid #e2e8f0;}' +
    'table.fields td.k{width:38%;font-size:7.5pt;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.02em;}' +
    'table.fields td.v{font-size:8.5pt;font-weight:600;color:#0f172a;word-wrap:break-word;}' +
    '.sec-title{font-size:8pt;font-weight:800;color:#0f2d5c;background:#e8f0fe;padding:3px 6px;margin:6px 0 2px;border-left:3px solid #1a4fa0;}' +
    '.foot{margin-top:10px;padding-top:6px;border-top:1.5px solid #cbd5e1;display:flex;justify-content:space-between;gap:12px;font-size:7.5pt;color:#475569;}' +
    '.sig{text-align:center;min-width:140px;}' +
    '.sig .line{border-top:1px solid #0f172a;margin-top:28px;padding-top:3px;font-weight:700;color:#0f172a;}' +
    '.note{font-style:italic;font-size:7pt;color:#64748b;margin-top:4px;}' +
    '@media print{body{margin:0;}.sheet{page-break-inside:avoid;}}' +
    '</style></head><body><div class="sheet">' +
    '<div class="hdr">' +
    '<img class="logo" src="/images/college-logo.png" alt="Logo" onerror="this.src=\'/karnataka-emblem.png\'" />' +
    '<div class="titles">' +
    '<div class="gov">GOVERNMENT OF KARNATAKA · Department of Technical Education</div>' +
    '<div class="college">GOVERNMENT POLYTECHNIC, HUBBALLI</div>' +
    '<div class="sub">Student Master Profile (Official Record Printout)</div>' +
    '<div class="doc">STUDENT PROFILE</div>' +
    '</div></div>' +
    '<div class="meta"><div class="identity">' +
    '<h1>' + escProfilePrint(input.name) + '</h1>' +
    '<div class="line">' + escProfilePrint(input.reg_no) + '</div>' +
    '<div class="chips"><span class="chip">' + escProfilePrint(input.branch) + '</span>' +
    '<span class="chip">' + escProfilePrint(input.year) + '</span></div>' +
    '</div>' + photoBlock + '</div>' +
    '<div class="sec-title">Profile details (' + rows.length + ' fields)</div>' +
    '<div class="grid"><table class="fields">' + colHtml(left) + '</table>' +
    '<table class="fields">' + colHtml(right) + '</table></div>' +
    '<div class="foot"><div>Printed from GPT Hubli Student Portal<br/>' +
    '<strong>Date:</strong> ' + escProfilePrint(printDate) + ' &nbsp; <strong>Time:</strong> ' + escProfilePrint(printTime) +
    '<div class="note">This is a system-generated profile printout for student records. Verify against college office if required.</div>' +
    '</div><div class="sig"><div class="line">Student / Office use</div></div></div>' +
    '</div></body></html>';
}

function doStudentProfilePrintHtml(html) {
  // Mobile WebView cannot print zero-size iframes — use shared full-screen preview
  if (typeof window.gpthPrintHtml === 'function') {
    window.gpthPrintHtml(html, { title: 'Student Profile', filename: 'student-profile.html' });
    return;
  }
  var iframe = document.getElementById('stuFullProfilePrintFrame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'stuFullProfilePrintFrame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);
  }
  var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
  if (!doc) {
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300); }
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(function () {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      var w2 = window.open('', '_blank');
      if (w2) { w2.document.write(html); w2.document.close(); w2.focus(); w2.print(); }
    }
  }, 350);
}

/** Show/hide lock / pending state on Student → My Profile controls. */
async function updateStuProfileLockUI() {
  // Only for logged-in students — avoid 401 spam on CMS login / admin pages
  if (!window.currentUser || window.currentUser.role !== 'student') return;

  ensureStuProfilePrintButton();

  var locked = !!window._stuProfileEditLocked;
  var btn = document.getElementById('stuProfileUpdateBtn');
  var banner = document.getElementById('stuProfileEditBanner');
  var lockBanner = document.getElementById('stuProfileLockedBanner');
  var pendingBanner = document.getElementById('stuProfilePendingBanner');

  if (!lockBanner) {
    var container = document.getElementById('stuDynamicProfileSections');
    if (container && container.parentNode) {
      lockBanner = document.createElement('div');
      lockBanner.id = 'stuProfileLockedBanner';
      lockBanner.className = 'info-box';
      lockBanner.style.cssText = 'margin-top:14px;margin-bottom:0;border-left:4px solid #b45309;';
      lockBanner.innerHTML = '🔒 <strong>Profile is view-only</strong> — Admin has locked edit requests. Contact the office if you need a change.';
      container.parentNode.insertBefore(lockBanner, container.nextSibling);
    }
  }
  if (!pendingBanner) {
    var host = document.getElementById('stuDynamicProfileSections');
    if (host && host.parentNode) {
      pendingBanner = document.createElement('div');
      pendingBanner.id = 'stuProfilePendingBanner';
      pendingBanner.className = 'info-box';
      pendingBanner.style.cssText = 'display:none;margin-top:14px;margin-bottom:0;border-left:4px solid #1a4fa0;';
      pendingBanner.innerHTML = '⏳ <strong>Update request pending</strong> — your profile stays view-only until Admin/HOD approves or rejects it.';
      host.parentNode.insertBefore(pendingBanner, host.nextSibling);
    }
  }

  var pending = false;
  if (!locked) {
    try {
      var pr = await profileApiGet('/api/profile-requests?mine=1');
      pending = !!(pr && ((pr.mine_pending > 0) || (pr.pending && pr.pending.length > 0)));
    } catch (e) { pending = false; }
  }
  window._stuProfileRequestPending = pending;

  if (lockBanner) lockBanner.style.display = locked ? '' : 'none';
  if (pendingBanner) pendingBanner.style.display = (!locked && pending) ? '' : 'none';
  if (banner && (locked || pending)) banner.style.display = 'none';

  if (btn) {
    if (locked) {
      btn.disabled = true;
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '🔒 Editing Locked by Admin';
      btn.classList.remove('gr');
      window._stuProfileEditEnabled = false;
    } else if (pending) {
      btn.disabled = true;
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '⏳ Request Pending Approval';
      btn.classList.remove('gr');
      window._stuProfileEditEnabled = false;
    } else if (!window._stuProfileEditEnabled) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      btn.textContent = window._stuProfileFirstTime
        ? '📝 Fill My Profile (First Time)'
        : '📝 Request Profile Update';
      btn.classList.remove('gr');
    }
  }

  // First-time banner
  var firstBanner = document.getElementById('stuProfileFirstTimeBanner');
  if (!firstBanner) {
    var hostFt = document.getElementById('stuDynamicProfileSections');
    if (hostFt && hostFt.parentNode) {
      firstBanner = document.createElement('div');
      firstBanner.id = 'stuProfileFirstTimeBanner';
      firstBanner.className = 'info-box';
      firstBanner.style.cssText = 'display:none;margin-top:14px;margin-bottom:0;border-left:4px solid var(--green);';
      firstBanner.innerHTML = '👋 <strong>Welcome!</strong> Please fill your complete My Profile for the first time, then submit for Admin approval. After approval, editing will be locked until Admin unlocks it.';
      hostFt.parentNode.insertBefore(firstBanner, hostFt.nextSibling);
    }
  }
  if (firstBanner) {
    firstBanner.style.display = (!locked && window._stuProfileFirstTime) ? '' : 'none';
  }
}
window.updateStuProfileLockUI = updateStuProfileLockUI;

/** Unlock fields on Student → My Profile for a request draft (fee years follow Current Year rules). */
function enableStuProfileEdit() {
  if (window._stuProfileEditLocked) {
    alert('🔒 Profile editing is locked by Admin. Contact the office to request changes.');
    updateStuProfileLockUI();
    return false;
  }
  var container = document.getElementById('stuDynamicProfileSections');
  if (!container) { alert('Profile section not found.'); return false; }

  container.querySelectorAll('.fg').forEach(function (fg) {
    // Fee-year fields are controlled by applyStuFeeYearLocks — skip bulk unlock
    if (fg.getAttribute('data-fee-year')) return;

    var field = fg.querySelector('input, textarea, select');
    if (!field) return;
    if (field.tagName === 'SELECT') {
      field.disabled = false;
    } else {
      field.removeAttribute('readonly');
      field.disabled = false;
    }
    field.style.background = '';
    field.style.cursor = '';
    field.classList.add('stu-profile-editing');

    if (!fg.querySelector('.stu-edit-hint')) {
      var hint = document.createElement('div');
      hint.className = 'stu-edit-hint';
      hint.style.cssText = 'font-size:0.65rem;color:var(--green);margin-top:3px;';
      hint.textContent = '✏️ You can edit this field';
      fg.appendChild(hint);
    }
  });

  window._stuProfileEditEnabled = true;

  // Enable only fee years allowed for the selected Current Year
  // (1st→only 1st; 2nd→1st+2nd; 3rd/YEAR BACK→all; Completed→view only)
  if (typeof window.applyStuFeeYearLocks === 'function') {
    window.applyStuFeeYearLocks(true);
  }

  var btn = document.getElementById('stuProfileUpdateBtn');
  if (btn) {
    btn.textContent = '📝 Submit Update Request';
    btn.classList.add('gr');
  }
  var banner = document.getElementById('stuProfileEditBanner');
  if (banner) banner.style.display = '';

  return true;
}
window.enableStuProfileEdit = enableStuProfileEdit;

/**
 * Student My Profile:
 *  - Default: view-only (no field is editable without starting a request)
 *  - 1st click → if Admin has not locked editing, enable fields for a request draft
 *  - 2nd click → submit request (data does NOT save until Admin approves)
 *  - After submit → back to view-only until Admin unlocks / student requests again
 */
async function submitStuProfileUpdate() {
  var container = document.getElementById('stuDynamicProfileSections');
  if (!container) { alert('Profile section not found.'); return; }

  if (window._stuProfileEditLocked) {
    alert('🔒 Profile editing is locked by Admin. Contact the office to request changes.');
    updateStuProfileLockUI();
    return;
  }

  // First action: unlock fields only for drafting a request (not a permanent edit)
  if (!window._stuProfileEditEnabled) {
    // Block starting a new draft if a request is already pending approval
    try {
      var pending = await profileApiGet('/api/profile-requests?mine=1');
      if (pending && ((pending.mine_pending > 0) || (pending.pending && pending.pending.length > 0))) {
        alert('⏳ You already have a profile update request pending Admin/HOD approval.\n\nEditing stays locked until it is reviewed.');
        return;
      }
    } catch (e) { /* allow attempt if check fails */ }

    enableStuProfileEdit();
    alert(
      '✏️ Request draft opened.\n\n' +
      '• Current Year is a dropdown: 1st Year / 2nd Year / 3rd Year / YEAR BACK / Completed\n' +
      '• Fee sections unlock based on year:\n' +
      '    1st Year → only 1st year fees\n' +
      '    2nd Year → 1st + 2nd year fees\n' +
      '    3rd Year / YEAR BACK → all 3 years\n' +
      '    Completed → all 3 years view-only\n\n' +
      'Each fee year has: Amount, Receipt No, Fees Paid Date.\n' +
      'Changes save only after Admin/HOD approval.\n\n' +
      'Edit, then click "Submit Update Request".'
    );
    return;
  }

  var changes = {};
  container.querySelectorAll('.fg').forEach(function (fg) {
    var label = fg.querySelector('label');
    var field = fg.querySelector('input, textarea, select');
    if (!label || !field) return;
    // Skip fully locked fee years (disabled) so older years are not wiped on merge.
    // View-only (readonly) fee fields for Completed are still submitted so admin sees them.
    if (field.disabled) return;
    var labelText = label.textContent.replace(/✏️.*$/, '').trim();
    if (!labelText) return;
    changes[labelText] = field.value;
  });
  // Always include Current Year even if select was left as-is
  var yearEl = container.querySelector('[data-stu-current-year="1"] select, [data-stu-current-year="1"] input');
  if (yearEl && yearEl.value) changes['Current Year'] = yearEl.value;

  // Include profile photo selected via Choose Photo (not a form .fg field)
  var pendingPhoto = window._stuPendingPhoto ||
    (typeof userPhotos !== 'undefined' && userPhotos.stu) ||
    null;
  if (pendingPhoto && typeof pendingPhoto === 'string' && pendingPhoto.indexOf('data:image/') === 0) {
    changes['Profile Photo'] = pendingPhoto;
  }

  if (Object.keys(changes).length === 0) {
    alert('No fields found to update.\n\nTip: Choose a photo and/or edit profile fields, then submit.');
    return;
  }
  var regNo = (window.currentUser && window.currentUser.reg_no) || null;
  if (!regNo) { alert('Could not identify your registration number. Please contact admin.'); return; }
  var apiClient = window.api;
  if (!apiClient || typeof apiClient.post !== 'function') {
    alert('System not ready. Please refresh the page and try again.');
    return;
  }
  var res = await apiClient.post('/api/profile-requests', { targetType: 'student', targetId: regNo, changes: changes });
  if (res && res.ok) {
    var hasPhoto = !!changes['Profile Photo'];
    alert(
      '✅ Update request submitted! Awaiting Admin/HOD approval.\n\n' +
      (hasPhoto ? '📷 Profile photo is included in this request.\n\n' : '') +
      'Your profile stays view-only until an Admin reviews it. Approved data (including photo) will appear after approval.'
    );
    // Return to view-only immediately — nothing is saved without admin approval
    window._stuProfileEditEnabled = false;
    // Keep pending photo preview until approval; clear only after approved load
    if (typeof renderStuDynamicProfile === 'function') renderStuDynamicProfile();
    // Re-apply DB values (still old until approved) but keep pending photo preview
    var keepPhoto = window._stuPendingPhoto;
    var stu = (typeof students !== 'undefined' && regNo) ? students[regNo] : null;
    if (stu && typeof window.applyLiveStudentProfile === 'function') {
      window.applyLiveStudentProfile(stu, regNo);
    } else {
      updateStuProfileLockUI();
    }
    if (keepPhoto && typeof window.applyPhotoEverywhere === 'function') {
      window._stuPendingPhoto = keepPhoto;
      window.applyPhotoEverywhere('stu', keepPhoto);
    }
    var btn = document.getElementById('stuProfileUpdateBtn');
    if (btn) {
      btn.textContent = '⏳ Request Pending Approval';
      btn.disabled = true;
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
    }
  }
}
window.submitStuProfileUpdate = submitStuProfileUpdate;

/** True if a change value is an image data URL (never render as plain text). */
function isProfilePhotoValue(k, v) {
  if (k === 'Profile Photo' || k === 'profile_photo' || k === 'ProfilePhoto' || k === 'photo') return true;
  return typeof v === 'string' && v.indexOf('data:image/') === 0;
}

function shortProfileText(text, maxLen) {
  maxLen = maxLen || 48;
  text = text == null || text === '' ? '—' : String(text);
  if (text.length > maxLen) return text.slice(0, maxLen - 1) + '…';
  return text;
}

/**
 * Normalize request changes into glance-friendly items with before → after.
 * @param {object} changes  new values
 * @param {object} [previous] old values snapshot (from API)
 */
function normalizeProfileChanges(changes, previous) {
  if (!changes || typeof changes !== 'object') return [];
  previous = previous && typeof previous === 'object' ? previous : {};
  return Object.keys(changes)
    .filter(function (k) { return k !== 'profile_edit_locked'; })
    .map(function (k) {
      var v = changes[k];
      var prev = previous[k];
      if (prev == null && isProfilePhotoValue(k, v)) {
        prev = previous['Profile Photo'] || previous.profile_photo || previous.photo || '';
      }
      if (isProfilePhotoValue(k, v) || isProfilePhotoValue(k, prev)) {
        var newSrc = (typeof v === 'string' && v.indexOf('data:image/') === 0) ? v : '';
        var oldSrc = (typeof prev === 'string' && prev.indexOf('data:image/') === 0) ? prev : '';
        return {
          key: k === 'profile_photo' || k === 'photo' ? 'Profile Photo' : k,
          kind: 'photo',
          value: newSrc,
          previous: oldSrc,
          short: 'Photo updated',
          shortPrev: oldSrc ? 'Previous photo' : 'No photo',
        };
      }
      var text = v == null || v === '' ? '—' : String(v);
      var prevText = prev == null || prev === '' ? '—' : String(prev);
      // Guard: if something still looks like base64 image junk, hide it
      if (text.indexOf('data:image/') === 0 || (text.length > 200 && /^[A-Za-z0-9+/=]+$/.test(text.slice(0, 80)))) {
        return {
          key: k,
          kind: 'photo',
          value: text.indexOf('data:image/') === 0 ? text : '',
          previous: (typeof prev === 'string' && prev.indexOf('data:image/') === 0) ? prev : '',
          short: 'Photo updated',
          shortPrev: 'Previous',
        };
      }
      return {
        key: k,
        kind: 'text',
        value: text,
        previous: prevText,
        short: shortProfileText(text),
        shortPrev: shortProfileText(prevText, 36),
      };
    });
}

/** Compact at-a-glance chips — highlighted before → after. */
function profileChangesGlance(changes, opts) {
  opts = opts || {};
  var max = opts.max != null ? opts.max : 6;
  var previous = opts.previous || {};
  var items = normalizeProfileChanges(changes, previous);
  if (!items.length) return '<span style="opacity:.6;font-size:0.8rem;">No field changes</span>';

  var shown = items.slice(0, max);
  var more = items.length - shown.length;
  var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  shown.forEach(function (it) {
    if (it.kind === 'photo') {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;' +
        'background:linear-gradient(90deg,#fffbeb 0%,#ecfdf5 100%);border:1.5px solid #fbbf24;border-radius:10px;">' +
        '<span style="font-size:0.7rem;font-weight:800;color:#92400e;min-width:88px;">📷 Photo</span>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        (it.previous
          ? '<span style="text-align:center;"><img src="' + it.previous + '" alt="Before" style="width:36px;height:36px;border-radius:8px;object-fit:cover;border:2px solid #fca5a5;opacity:.85;" /><div style="font-size:0.58rem;color:#991b1b;font-weight:700;">Before</div></span>'
          : '<span style="font-size:0.72rem;color:#991b1b;font-weight:600;">(none)</span>') +
        '<span style="font-weight:800;color:#b45309;">→</span>' +
        (it.value
          ? '<span style="text-align:center;"><img src="' + it.value + '" alt="After" style="width:40px;height:40px;border-radius:8px;object-fit:cover;border:2px solid #34d399;box-shadow:0 0 0 2px #ecfdf5;" /><div style="font-size:0.58rem;color:#065f46;font-weight:700;">After</div></span>'
          : '<span style="font-size:0.72rem;color:#065f46;font-weight:700;">New photo</span>') +
        '</div></div>';
      return;
    }
    html += '<div title="' + escAp(it.key + ': ' + it.previous + ' → ' + it.value) + '" style="' +
      'display:grid;grid-template-columns:minmax(100px,28%) 1fr;gap:8px;align-items:start;' +
      'padding:8px 10px;background:#fffbeb;border:1.5px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:10px;">' +
      '<div style="font-size:0.68rem;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.03em;padding-top:2px;">' +
      escAp(it.key) + '</div>' +
      '<div style="font-size:0.8rem;line-height:1.35;min-width:0;">' +
      '<span style="color:#991b1b;text-decoration:line-through;opacity:.85;word-break:break-word;">' + escAp(it.shortPrev) + '</span>' +
      ' <span style="font-weight:800;color:#b45309;margin:0 4px;">→</span> ' +
      '<span style="color:#065f46;font-weight:800;background:#d1fae5;padding:1px 6px;border-radius:4px;word-break:break-word;">' +
      escAp(it.short) + '</span>' +
      '</div></div>';
  });
  if (more > 0) {
    html += '<div style="padding:6px 10px;font-size:0.72rem;font-weight:700;color:#1a4fa0;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;text-align:center;">+' +
      more + ' more field' + (more === 1 ? '' : 's') + ' — open Review</div>';
  }
  html += '</div>';
  return html;
}

/** Full review modal list — highlighted before → after, no base64 dump. */
function profileChangesReviewList(changes, previous) {
  var items = normalizeProfileChanges(changes, previous || {});
  if (!items.length) {
    return '<p style="opacity:.7;font-size:0.85rem;">No field changes in this request.</p>';
  }
  var html =
    '<div style="margin-bottom:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;font-size:0.78rem;color:#92400e;font-weight:600;">' +
    '⚡ Highlighted fields below are what the student changed. Red/strike = previous · Green = new value.</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px;">';
  items.forEach(function (it) {
    if (it.kind === 'photo') {
      html += '<div style="padding:12px;background:linear-gradient(90deg,#fff7ed,#ecfdf5);border:1.5px solid #fbbf24;border-left:5px solid #f59e0b;border-radius:12px;">' +
        '<div style="font-size:0.78rem;font-weight:800;color:#92400e;margin-bottom:10px;">📷 Profile Photo</div>' +
        '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">' +
        '<div style="text-align:center;">' +
        '<div style="font-size:0.68rem;font-weight:700;color:#991b1b;margin-bottom:4px;">BEFORE</div>' +
        (it.previous
          ? '<img src="' + it.previous + '" alt="Before" style="width:88px;height:88px;border-radius:10px;object-fit:cover;border:3px solid #fca5a5;" />'
          : '<div style="width:88px;height:88px;border-radius:10px;border:2px dashed #fca5a5;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:#991b1b;background:#fef2f2;">None</div>') +
        '</div>' +
        '<div style="font-size:1.4rem;font-weight:900;color:#b45309;">→</div>' +
        '<div style="text-align:center;">' +
        '<div style="font-size:0.68rem;font-weight:700;color:#065f46;margin-bottom:4px;">AFTER (new)</div>' +
        (it.value
          ? '<img src="' + it.value + '" alt="After" style="width:96px;height:96px;border-radius:10px;object-fit:cover;border:3px solid #34d399;box-shadow:0 0 0 3px #d1fae5;" />'
          : '<div style="width:96px;height:96px;border-radius:10px;border:2px dashed #6ee7b7;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:#065f46;">New</div>') +
        '</div></div></div>';
      return;
    }
    html += '<div style="padding:12px 14px;background:#fffbeb;border:1.5px solid #fcd34d;border-left:5px solid #f59e0b;border-radius:12px;">' +
      '<div style="font-size:0.72rem;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">' +
      escAp(it.key) + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch;">' +
      '<div style="padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">' +
      '<div style="font-size:0.65rem;font-weight:800;color:#991b1b;margin-bottom:4px;">BEFORE</div>' +
      '<div style="font-size:0.88rem;color:#7f1d1d;text-decoration:line-through;word-break:break-word;">' +
      escAp(it.previous === '' ? '—' : it.previous) + '</div></div>' +
      '<div style="display:flex;align-items:center;font-weight:900;color:#b45309;font-size:1.1rem;">→</div>' +
      '<div style="padding:10px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;">' +
      '<div style="font-size:0.65rem;font-weight:800;color:#065f46;margin-bottom:4px;">AFTER</div>' +
      '<div style="font-size:0.9rem;font-weight:800;color:#064e3b;word-break:break-word;">' +
      escAp(it.value) + '</div></div>' +
      '</div></div>';
  });
  html += '</div>';
  return html;
}

// Back-compat alias (never dumps base64)
function profileChangesSummary(changes, previous) {
  return profileChangesGlance(changes, { max: 8, previous: previous || {} });
}

function readApprovalUrlFilter(key) {
  try { return new URL(window.location.href).searchParams.get(key) || ''; }
  catch (e) { return ''; }
}
function writeApprovalUrlFilters(map) {
  try {
    var url = new URL(window.location.href);
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (v == null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    });
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch (e) { /* ignore */ }
}
function escAp(t) {
  var d = document.createElement('div');
  d.textContent = t == null ? '' : String(t);
  return d.innerHTML;
}

function getProfileApprovalFiltersFromUiOrUrl() {
  function val(id, urlKey) {
    var el = document.getElementById(id);
    if (el && typeof el.value === 'string') return el.value;
    return readApprovalUrlFilter(urlKey);
  }
  return {
    branch: val('apBranchFilter', 'ap_branch'),
    year: val('apYearFilter', 'ap_year'),
    admission_year: val('apAdmYearFilter', 'ap_adm_year'),
    q: val('apSearchFilter', 'ap_q'),
    target_type: val('apTypeFilter', 'ap_type'),
  };
}

/**
 * Build shareable verification URL for current filters, e.g.
 * /?section=adApprovals&ap_branch=CSE&ap_year=2nd%20Year&ap_q=171CS
 */
function buildProfileApprovalsApiUrl() {
  var f = getProfileApprovalFiltersFromUiOrUrl();
  var qs = [];
  if (f.branch) qs.push('branch=' + encodeURIComponent(f.branch));
  if (f.year) qs.push('year=' + encodeURIComponent(f.year));
  if (f.admission_year) qs.push('admission_year=' + encodeURIComponent(f.admission_year));
  if (f.q) qs.push('q=' + encodeURIComponent(f.q));
  if (f.target_type) qs.push('target_type=' + encodeURIComponent(f.target_type));
  return '/api/profile-requests' + (qs.length ? '?' + qs.join('&') : '');
}

async function renderProfileRequestApprovals() {
  if (!window.currentUser) return;
  var role = window.currentUser.role;
  if (role !== 'admin' && role !== 'hod' && role !== 'acm' && role !== 'principal') return;
  if (typeof ensurePrincipalHodDesk === 'function') {
    try { ensurePrincipalHodDesk(); } catch (e) { /* ignore */ }
  }
  // ACM uses admin Approvals UI; Principal has own panel; HOD uses faculty Approvals
  var containerId =
    (role === 'admin' || role === 'acm') ? 'adApprovals' :
    (role === 'principal') ? 'priProfileApprovals' : 'facApprovals';
  var host = document.getElementById(containerId);
  if (!host) return;

  var f = getProfileApprovalFiltersFromUiOrUrl();
  // HOD: force branch filter to own branch
  if (role === 'hod' && window.currentUser.branch) {
    f.branch = window.currentUser.branch;
  }
  writeApprovalUrlFilters({
    section: containerId,
    ap_branch: f.branch,
    ap_year: f.year,
    ap_adm_year: f.admission_year,
    ap_q: f.q,
    ap_type: f.target_type,
  });

  var data = await profileApiGet(buildProfileApprovalsApiUrl());
  if (!data) return;
  var pending = data.pending || [];
  var total = data.total_pending != null ? data.total_pending : pending.length;
  var facets = data.facets || { branches: [], years: [], admission_years: [] };

  // Prefer host-specific panel id
  var panelId =
    role === 'principal' ? 'bridgeProfileRequestsPri' :
    role === 'hod' ? 'bridgeProfileRequestsFac' :
    'bridgeProfileRequests';
  var panel = document.getElementById(panelId);
  if (!panel && role === 'hod') {
    // Fall back: inject into facApprovals
    panel = document.createElement('div');
    panel.id = 'bridgeProfileRequestsFac';
    panel.style.padding = '0 0 4px';
    host.insertBefore(panel, host.firstChild);
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = panelId;
    panel.style.padding = '0 0 4px';
    var card = document.getElementById(
      role === 'principal' ? 'priPendingApprovalsCard' : 'adPendingApprovalsCard'
    );
    if (card) card.appendChild(panel);
    else {
      panel.className = 'card';
      panel.style.marginBottom = '18px';
      panel.style.borderLeft = '4px solid #1a4fa0';
      host.insertBefore(panel, host.firstChild);
    }
  }

  // Live counts on the static info boxes / badge (admin + principal)
  ;[
    ['adPendingCountBox', 'adPendingCountText', 'adPendingBadge'],
    ['priPendingCountBox', 'priPendingCountText', 'priPendingBadge'],
  ].forEach(function (ids) {
    var countBox = document.getElementById(ids[0]);
    var countText = document.getElementById(ids[1]);
    var badge = document.getElementById(ids[2]);
    if (countText) countText.textContent = total + ' pending approval' + (total === 1 ? '' : 's');
    if (countBox) countBox.style.display = total > 0 ? '' : 'none';
    if (badge) badge.textContent = String(total);
  });
  // Keep Approvals sidebar badge live (profile requests)
  window._lastProfilePending = total;
  if (typeof window.updateSidebarBadges === 'function') {
    window.updateSidebarBadges(total, window._lastAccountPending || 0);
  }

  var officialBranches = (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
    ? window.OFFICIAL_BRANCHES
    : [
      'Civil Engineering',
      'Computer Science and Engineering',
      'Electronics and Communication Engineering',
      'Mechanical Engineering',
    ];
  var branchOpts = '<option value="">All Branches</option>';
  officialBranches.forEach(function (b) {
    branchOpts += '<option value="' + escAp(b) + '"' + (f.branch === b ? ' selected' : '') + '>' + escAp(b) + '</option>';
  });

  var yearOpts = '<option value="">All Years</option>';
  ;['1st Year', '2nd Year', '3rd Year', 'YEAR BACK', 'Completed'].forEach(function (y) {
    yearOpts += '<option value="' + escAp(y) + '"' + (f.year === y ? ' selected' : '') + '>' + escAp(y) + '</option>';
  });

  var admYearOpts = '<option value="">All Adm. Years</option>';
  var admYears = (facets.admission_years && facets.admission_years.length)
    ? facets.admission_years.slice()
    : [];
  // Always offer common recent years even if facet empty
  ;['2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017'].forEach(function (y) {
    if (admYears.indexOf(y) === -1) admYears.push(y);
  });
  admYears.sort().reverse().forEach(function (y) {
    admYearOpts += '<option value="' + escAp(y) + '"' +
      (String(f.admission_year) === String(y) ? ' selected' : '') + '>' + escAp(y) + '</option>';
  });

  var typeOpts = ['', 'student', 'staff'].map(function (t) {
    var label = t ? t : 'All Types';
    return '<option value="' + t + '"' + (f.target_type === t ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  // HOD: branch locked — show badge instead of free branch select
  var branchControl = (role === 'hod')
    ? ('<span style="font-size:0.8rem;font-weight:700;padding:8px 10px;background:#e8f0fe;border-radius:8px;color:#1a4fa0;">Branch: ' +
      escAp(f.branch || (window.currentUser && window.currentUser.branch) || '—') + '</span>' +
      '<input type="hidden" id="apBranchFilter" value="' + escAp(f.branch || (window.currentUser && window.currentUser.branch) || '') + '" />')
    : ('<select id="apBranchFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:180px;" onchange="window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters()">' +
      branchOpts + '</select>');

  var typeControl = (role === 'hod')
    ? '<input type="hidden" id="apTypeFilter" value="student" />'
    : ('<select id="apTypeFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;" onchange="window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters()">' +
      typeOpts + '</select>');

  var filterBar =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px;background:var(--bg);border-radius:10px;border:1px solid var(--border);">' +
    '<input id="apSearchFilter" type="text" value="' + escAp(f.q) + '" placeholder="Search name, reg no, email…" ' +
    'style="flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;" ' +
    'onkeydown="if(event.key===\'Enter\'){window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters();}" />' +
    branchControl +
    '<select id="apYearFilter" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:120px;" onchange="window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters()">' +
    yearOpts + '</select>' +
    '<select id="apAdmYearFilter" title="Year of Admission" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:130px;" onchange="window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters()">' +
    admYearOpts + '</select>' +
    typeControl +
    '<button class="btn ol" type="button" onclick="window.applyProfileApprovalFilters&&window.applyProfileApprovalFilters()">Apply</button>' +
    '<button class="btn ol" type="button" onclick="window.clearProfileApprovalFilters&&window.clearProfileApprovalFilters()">Clear</button>' +
    '</div>';

  // Index for review modal
  window._profileApprovalById = {};
  pending.forEach(function (r) {
    window._profileApprovalById[String(r.id)] = r;
  });

  if (pending.length === 0) {
    panel.innerHTML =
      '<div style="padding:12px 18px 4px;">' + filterBar + '</div>' +
      '<p style="opacity:.7;margin:8px 18px 16px;font-size:0.85rem;">No pending profile update requests' +
      (total > 0 ? ' match these filters (total pending: ' + total + ').' : '.') +
      '</p>';
    return;
  }

  // Card list — at-a-glance verification (only updated fields, no base64 dump)
  var lastGroup = '';
  var cards = '';
  pending.forEach(function (r) {
    var br = r.branch || '—';
    var yr = r.year || '—';
    var group = br + ' · ' + yr;
    if (group !== lastGroup) {
      lastGroup = group;
      cards +=
        '<div style="margin:14px 0 8px;padding:6px 2px;font-weight:700;font-size:0.78rem;color:var(--navy);">' +
        '📁 ' + escAp(br) + ' &nbsp;·&nbsp; 📅 ' + escAp(yr) +
        '</div>';
    }

    var items = normalizeProfileChanges(r.changes, r.previous);
    var fieldCount = items.length;
    var hasPhoto = items.some(function (it) { return it.kind === 'photo'; });
    var when = r.created_at
      ? new Date(r.created_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      })
      : '—';

    // Small avatar from photo change if present
    var photoItem = items.find(function (it) { return it.kind === 'photo' && it.value; });
    var avatarHtml = photoItem
      ? '<img src="' + photoItem.value + '" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid #a7f3d0;flex-shrink:0;" />'
      : '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#1a4fa0,#2a5abf);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0;">' +
        escAp(String(r.requester_name || r.target_id || '?').slice(0, 2).toUpperCase()) +
        '</div>';

    cards +=
      '<div class="ap-verify-card" data-ap-id="' + escAp(String(r.id)) + '" style="' +
      'border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin:0 0 10px;' +
      'background:var(--surface);box-shadow:0 1px 3px rgba(15,23,42,.04);' +
      'border-left:4px solid #f59e0b;">' +
      // Header row
      '<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">' +
      avatarHtml +
      '<div style="flex:1;min-width:180px;">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
      '<strong style="font-size:0.95rem;">' + escAp(r.requester_name || '—') + '</strong>' +
      '<span class="badge pending">Pending</span>' +
      '<span style="padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:999px;font-size:0.68rem;font-weight:800;">⚡ ' +
      fieldCount + ' change' + (fieldCount === 1 ? '' : 's') + '</span>' +
      (hasPhoto ? '<span class="badge active" style="font-size:0.68rem;">📷 Photo</span>' : '') +
      '</div>' +
      '<div style="font-size:0.75rem;opacity:.75;margin-top:3px;font-family:JetBrains Mono,monospace;">' +
      escAp(r.target_id || '—') +
      ' · ' + escAp(br) +
      ' · ' + escAp(yr) +
      '</div>' +
      '<div style="font-size:0.72rem;opacity:.65;margin-top:2px;">Submitted ' + escAp(when) +
      ' · review highlighted fields below</div>' +
      '</div>' +
      // Actions
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-left:auto;">' +
      '<button class="btn ol" type="button" onclick="window.openProfileApprovalReview&&window.openProfileApprovalReview(' + r.id + ')">👁 Review</button>' +
      '<button class="btn gr" type="button" onclick="reviewProfileRequest(' + r.id + ',\'approved\',true)">✓ Approve &amp; Lock</button>' +
      '<button class="btn" type="button" style="background:#1a4fa0;color:#fff;" onclick="reviewProfileRequest(' + r.id + ',\'approved\',false)">✓ Approve</button>' +
      '<button class="btn re" type="button" onclick="reviewProfileRequest(' + r.id + ',\'rejected\')">✕ Reject</button>' +
      '</div>' +
      '</div>' +
      // Highlighted before → after
      '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">' +
      '<div style="font-size:0.68rem;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">' +
      '⚡ What student updated (before → after)</div>' +
      profileChangesGlance(r.changes, { max: 8, previous: r.previous || {} }) +
      '</div>' +
      '</div>';
  });

  panel.innerHTML =
    '<div style="padding:12px 18px 0;">' +
    '<div style="font-size:0.78rem;opacity:.8;margin:0 0 8px;">Showing <strong>' + pending.length + '</strong> of <strong>' + total +
    '</strong> pending · <strong style="color:#92400e;">Highlighted = fields the student changed</strong> (old → new)</div>' +
    filterBar +
    '</div>' +
    '<div style="padding:4px 18px 16px;">' + cards + '</div>';
}
window.renderProfileRequestApprovals = renderProfileRequestApprovals;

/** Review modal: clean list of only updated fields (photo as thumbnail). */
function openProfileApprovalReview(id) {
  var r = window._profileApprovalById && window._profileApprovalById[String(id)];
  if (!r) {
    alert('Request not found. Refresh Approvals and try again.');
    return;
  }
  var items = normalizeProfileChanges(r.changes, r.previous);
  var modal = document.getElementById('apReviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'apReviewModal';
    modal.style.cssText =
      'display:none;position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.5);' +
      'align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML =
      '<div style="background:var(--surface);border-radius:14px;max-width:640px;width:100%;max-height:90vh;' +
      'overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.28);border:1px solid var(--border);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;' +
      'border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:1;">' +
      '<h3 id="apReviewTitle" style="margin:0;font-size:1rem;">Review update</h3>' +
      '<button class="btn ol" type="button" onclick="window.closeProfileApprovalReview&&window.closeProfileApprovalReview()">Close</button>' +
      '</div>' +
      '<div id="apReviewBody" style="padding:16px;"></div>' +
      '<div id="apReviewActions" style="padding:12px 16px 16px;display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid var(--border);"></div>' +
      '</div>';
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeProfileApprovalReview();
    });
    document.body.appendChild(modal);
  }

  var title = document.getElementById('apReviewTitle');
  var body = document.getElementById('apReviewBody');
  var actions = document.getElementById('apReviewActions');
  if (title) {
    title.textContent = 'Review · ' + (r.requester_name || r.target_id || 'Student');
  }
  if (body) {
    body.innerHTML =
      '<div style="margin-bottom:14px;padding:10px 12px;background:var(--bg);border-radius:10px;border:1px solid var(--border);font-size:0.8rem;">' +
      '<div><strong>' + escAp(r.requester_name || '—') + '</strong> · ' +
      '<span style="font-family:JetBrains Mono,monospace;">' + escAp(r.target_id || '—') + '</span></div>' +
      '<div style="opacity:.75;margin-top:4px;">' + escAp(r.branch || '—') + ' · ' + escAp(r.year || '—') +
      ' · <strong style="color:#92400e;">' + items.length + '</strong> highlighted change' + (items.length === 1 ? '' : 's') + '</div>' +
      '<div style="opacity:.75;margin-top:4px;font-size:0.72rem;">Compare <span style="color:#991b1b;font-weight:700;">BEFORE</span> vs <span style="color:#065f46;font-weight:700;">AFTER</span> for each field the student updated.</div>' +
      '</div>' +
      profileChangesReviewList(r.changes, r.previous || {});
  }
  if (actions) {
    actions.innerHTML =
      '<button class="btn gr" type="button" onclick="window.closeProfileApprovalReview();reviewProfileRequest(' + r.id + ',\'approved\',true)">✓ Approve &amp; Lock</button>' +
      '<button class="btn" type="button" style="background:#1a4fa0;color:#fff;" onclick="window.closeProfileApprovalReview();reviewProfileRequest(' + r.id + ',\'approved\',false)">✓ Approve (keep edit open)</button>' +
      '<button class="btn re" type="button" onclick="window.closeProfileApprovalReview();reviewProfileRequest(' + r.id + ',\'rejected\')">✕ Reject</button>';
  }
  modal.style.display = 'flex';
}
window.openProfileApprovalReview = openProfileApprovalReview;

function closeProfileApprovalReview() {
  var modal = document.getElementById('apReviewModal');
  if (modal) modal.style.display = 'none';
}
window.closeProfileApprovalReview = closeProfileApprovalReview;

function applyProfileApprovalFilters() {
  renderProfileRequestApprovals();
}
window.applyProfileApprovalFilters = applyProfileApprovalFilters;

function clearProfileApprovalFilters() {
  ;['apSearchFilter', 'apBranchFilter', 'apYearFilter', 'apAdmYearFilter', 'apTypeFilter'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  writeApprovalUrlFilters({ ap_branch: '', ap_year: '', ap_adm_year: '', ap_q: '', ap_type: '' });
  renderProfileRequestApprovals();
}
window.clearProfileApprovalFilters = clearProfileApprovalFilters;

async function reviewProfileRequest(id, action, lockEdit) {
  var res = null;
  // Default lock on approve when lockEdit is omitted
  if (action === 'approved' && typeof lockEdit === 'undefined') lockEdit = true;
  try {
    var r = await fetch('/api/profile-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        id: id,
        action: action,
        lockEdit: action === 'approved' ? lockEdit !== false : false,
      }),
    });
    res = await r.json().catch(function () { return null; });
  } catch (e) {
    res = null;
  }
  closeProfileApprovalReview();
  if (res && res.ok) {
    if (action === 'approved') {
      alert(lockEdit !== false
        ? '✅ Approved and saved. Student profile is view-only (edit locked).'
        : '✅ Approved and saved. Student may submit another edit request.');
    } else if (action === 'rejected') {
      alert('Request rejected.');
    }
    renderProfileRequestApprovals();
  } else {
    alert('Failed to update request. ' + (res && res.error ? res.error : ''));
  }
}
window.reviewProfileRequest = reviewProfileRequest;

// Poll while an admin/HOD/ACM session is active so new requests show up without a refresh.
// Skip while admin is typing in filter fields to avoid losing focus.
setInterval(function () {
  if (!window.currentUser) return;
  var r = window.currentUser.role;
  if (r !== 'admin' && r !== 'hod' && r !== 'acm') return;
  var ae = document.activeElement;
  if (ae && ae.id && (ae.id.indexOf('ap') === 0 || ae.id.indexOf('accAp') === 0)) return;
  renderProfileRequestApprovals();
}, 8000);

/* ================================================================
   ADMIN — Student Database (all student accounts: complete + incomplete)
   ================================================================ */
// Define globals immediately so inline HTML oninput/onclick never throw
window._adminStudentList = window._adminStudentList || [];
window._adminStudentByKey = window._adminStudentByKey || {};
window.filterAdminStudentList = window.filterAdminStudentList || function () {};
window.renderAdminStudentDatabase = window.renderAdminStudentDatabase || function () {};
window.viewAdminStudent = window.viewAdminStudent || function () {};
window.closeAdminStudentView = window.closeAdminStudentView || function () {};
window.setStudentProfileEditLock = window.setStudentProfileEditLock || function () {};

function escHtml(t) {
  var d = document.createElement('div');
  d.textContent = t == null ? '' : String(t);
  return d.innerHTML;
}

/** Safe onclick attr: uses single-quoted HTML so JSON.stringify double-quotes don't break. */
function onclickCall(fnName, arg0, arg1) {
  var args = [arg0];
  if (typeof arg1 !== 'undefined') args.push(arg1);
  var jsArgs = args.map(function (a) { return JSON.stringify(a); }).join(',');
  // e.g. onclick='setStudentProfileEditLock("171CS15003",false)'
  return "onclick='" + fnName + "(" + jsArgs + ")'";
}

function profileStatusBadge(status) {
  if (status === 'updated') return '<span class="badge active">Updated</span>';
  if (status === 'partial') return '<span class="badge pending">Partial</span>';
  return '<span class="badge" style="background:#fef3c7;color:#92400e;">Not Updated</span>';
}

function accountStatusBadge(status) {
  if (status === 'approved') return '<span class="badge active">Approved</span>';
  if (status === 'pending') return '<span class="badge pending">Pending</span>';
  if (status === 'rejected') return '<span class="badge" style="background:#fee2e2;color:#991b1b;">Rejected</span>';
  return '<span class="badge">' + escHtml(status || '—') + '</span>';
}

function studentListKey(s) {
  return String(s.user_id || s.reg_no || s.email || Math.random());
}

function activeStudentDbPrefix() {
  function vis(id) {
    var el = document.getElementById(id);
    return !!(el && el.style.display !== 'none' && el.offsetParent !== null);
  }
  if (vis('priStudentsDesk')) return 'priStu';
  if (vis('facBranchStudents')) return 'facStu';
  if (vis('adStudents')) return 'adStu';
  // Prefer by role if nothing visible yet
  var r = window.currentUser && window.currentUser.role;
  if (r === 'principal' && document.getElementById('priStuTableBody')) return 'priStu';
  if (r === 'hod' && document.getElementById('facStuTableBody')) return 'facStu';
  return 'adStu';
}

function updateStuBulkBarCount() {
  var pfx = activeStudentDbPrefix();
  var root =
    document.getElementById(pfx === 'adStu' ? 'adStudents' : pfx === 'priStu' ? 'priStudentsDesk' : 'facBranchStudents') ||
    document;
  var n = root.querySelectorAll('.stu-select-cb:checked').length;
  root.querySelectorAll('.stu-selected-count').forEach(function (el) {
    el.textContent = n + ' selected';
  });
  var bar = document.getElementById(pfx + 'BulkBar') || document.getElementById('adStuBulkBar');
  if (bar) bar.style.opacity = n > 0 ? '1' : '0.85';
}
window.updateStuBulkBarCount = updateStuBulkBarCount;

async function renderAdminStudentDatabase() {
  if (typeof ensurePrincipalHodDesk === 'function') {
    try { ensurePrincipalHodDesk(); } catch (e) { /* ignore */ }
  }
  // Paint all existing student-db table bodies for this session
  var prefixes = ['adStu', 'priStu', 'facStu'].filter(function (pfx) {
    return !!document.getElementById(pfx + 'TableBody');
  });
  if (!prefixes.length) return;

  var cu = window.currentUser;
  if (!cu || (cu.role !== 'admin' && cu.role !== 'acm' && cu.role !== 'hod' && cu.role !== 'registrar' && cu.role !== 'principal')) {
    prefixes.forEach(function (pfx) {
      var tb = document.getElementById(pfx + 'TableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.75;">Sign in as Admin / Principal / HOD to view students.</td></tr>';
    });
    return;
  }
  prefixes.forEach(function (pfx) {
    var tb = document.getElementById(pfx + 'TableBody');
    if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">Loading students…</td></tr>';
  });

  var data = await profileApiGet('/api/students');
  if (!data || !Array.isArray(data.students)) {
    prefixes.forEach(function (pfx) {
      var tb = document.getElementById(pfx + 'TableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#991b1b;">Failed to load students. Session may have expired — please log in again.</td></tr>';
    });
    return;
  }

  window._adminStudentList = data.students.slice();
  window._adminStudentByKey = {};
  window._adminStudentList.forEach(function (s) {
    window._adminStudentByKey[studentListKey(s)] = s;
  });
  window._studentListScope = data.scope || null;

  var official = (data.branches && data.branches.length)
    ? data.branches
    : ((window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
        'Civil Engineering',
        'Computer Science and Engineering',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
      ]);

  prefixes.forEach(function (pfx) {
    var branchSel = document.getElementById(pfx + 'BranchFilter');
    if (branchSel) {
      var prev = branchSel.value || '';
      // HOD: lock to single branch
      if (cu.role === 'hod' && official.length === 1) {
        branchSel.innerHTML = '<option value="' + escHtml(official[0]) + '" selected>' + escHtml(official[0]) + '</option>';
        branchSel.disabled = true;
      } else {
        branchSel.disabled = false;
        var opts = '<option value="">All Branches</option>';
        official.forEach(function (b) {
          opts += '<option value="' + escHtml(b) + '"' + (b === prev ? ' selected' : '') + '>' + escHtml(b) + '</option>';
        });
        branchSel.innerHTML = opts;
      }
    }
    var admSel = document.getElementById(pfx + 'AdmYearFilter');
    if (admSel) {
      var prevAdm = admSel.value || '';
      var admYears = {};
      (window._adminStudentList || []).forEach(function (s) {
        var extra = s.extra || {};
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
        }
        var ay =
          (extra['Year of Admission'] || extra['Year Of Admission'] || extra['Admission Year'] || '') + '';
        ay = ay.trim();
        if (ay) admYears[ay] = true;
      });
      var aopts = '<option value="">All Adm. Years</option>';
      Object.keys(admYears).sort().reverse().forEach(function (y) {
        aopts += '<option value="' + escHtml(y) + '"' + (y === prevAdm ? ' selected' : '') + '>' + escHtml(y) + '</option>';
      });
      admSel.innerHTML = aopts;
    }
  });

  filterAdminStudentList();
}
window.renderAdminStudentDatabase = renderAdminStudentDatabase;

function filterAdminStudentList() {
  var pfx = activeStudentDbPrefix();
  // If current prefix has no tbody, try any
  if (!document.getElementById(pfx + 'TableBody')) {
    if (document.getElementById('priStuTableBody')) pfx = 'priStu';
    else if (document.getElementById('facStuTableBody')) pfx = 'facStu';
    else pfx = 'adStu';
  }
  var tbody = document.getElementById(pfx + 'TableBody');
  var meta = document.getElementById(pfx + 'ListMeta');
  if (!tbody) return;

  var q = ((document.getElementById(pfx + 'Search') || {}).value || '').trim().toLowerCase();
  var branch = ((document.getElementById(pfx + 'BranchFilter') || {}).value || '').trim().toLowerCase();
  var year = ((document.getElementById(pfx + 'YearFilter') || {}).value || '').trim().toLowerCase();
  var admYear = ((document.getElementById(pfx + 'AdmYearFilter') || {}).value || '').trim();
  var prof = ((document.getElementById(pfx + 'ProfileFilter') || {}).value || '').trim();

  function studentAdmissionYear(s) {
    var extra = s.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    var keys = ['Year of Admission', 'Year Of Admission', 'Admission Year', 'year_of_admission'];
    for (var i = 0; i < keys.length; i++) {
      if (extra[keys[i]] != null && String(extra[keys[i]]).trim() !== '') {
        return String(extra[keys[i]]).trim();
      }
    }
    // case-insensitive scan
    var found = Object.keys(extra || {}).find(function (k) {
      return /year\s*of\s*admission|admission\s*year/i.test(k);
    });
    return found ? String(extra[found]).trim() : '';
  }

  var list = window._adminStudentList || [];
  var filtered = list.filter(function (s) {
    if (prof && s.profile_status !== prof) return false;
    if (branch) {
      var d = String(s.dept || '').toLowerCase();
      if (d.indexOf(branch) === -1) return false;
    }
    if (year) {
      var y = String(s.year || '').toLowerCase();
      // Match "2nd Year", "2nd", "second year", etc.
      if (y.indexOf(year) === -1 && year.indexOf(y) === -1) {
        // normalize: strip "year" and spaces for loose match
        var yn = y.replace(/year/g, '').replace(/\s+/g, '');
        var fn = year.replace(/year/g, '').replace(/\s+/g, '');
        if (!yn || yn.indexOf(fn) === -1 && fn.indexOf(yn) === -1) return false;
      }
    }
    if (admYear) {
      var ay = studentAdmissionYear(s);
      if (!ay || ay.indexOf(admYear) === -1) return false;
    }
    if (q) {
      var hay = [s.name, s.display_name, s.reg_no, s.dept, s.year, s.email, studentAdmissionYear(s)].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  // Group display order: by branch then name (already sorted from API; keep stable)
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">No students match your filters.</td></tr>';
    if (meta) meta.textContent = 'Showing 0 of ' + list.length + ' student account(s)';
    updateStuBulkBarCount();
    return;
  }

  var rows = filtered.map(function (s) {
    var key = studentListKey(s);
    var reg = s.reg_no || '—';
    var regAttr = s.reg_no ? escHtml(String(s.reg_no)) : '';
    var nameAttr = escHtml(String(s.name || s.display_name || reg));
    var pending = s.pending_profile_requests > 0
      ? ' <span class="badge pending" title="Pending profile request">' + s.pending_profile_requests + ' req</span>'
      : '';
    var lock = s.profile_edit_locked ? ' 🔒' : ' 🔓';
    var canToggle = !!(s.reg_no);
    var lockBtn = !canToggle
      ? '<span style="font-size:0.72rem;opacity:.6;">No reg no</span>'
      : (s.profile_edit_locked
        ? '<button class="btn gr stu-act-btn" type="button" data-stu-action="unlock" data-stu-reg="' + regAttr + '" data-stu-label="' + nameAttr + '">🔓 Unlock Edit</button>'
        : '<button class="btn stu-act-btn" type="button" style="background:#b45309;color:#fff;" data-stu-action="lock" data-stu-reg="' + regAttr + '" data-stu-label="' + nameAttr + '">🔒 Lock Edit</button>');
    var cb = canToggle
      ? '<input type="checkbox" class="stu-select-cb" data-stu-reg="' + regAttr + '" title="Select for bulk lock/unlock" />'
      : '<input type="checkbox" disabled title="No reg number" />';
    return '<tr data-stu-key="' + escHtml(key) + '" data-stu-reg="' + regAttr + '">' +
      '<td style="width:36px;text-align:center;">' + cb + '</td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">' + escHtml(reg) + '</td>' +
      '<td><strong>' + escHtml(s.name || '—') + '</strong>' +
      (s.email ? '<div style="font-size:0.68rem;opacity:.7;">' + escHtml(s.email) + '</div>' : '') +
      '</td>' +
      '<td>' + escHtml(s.dept || '—') + '</td>' +
      '<td>' + escHtml(s.year || '—') + '</td>' +
      '<td>' + accountStatusBadge(s.account_status) + '</td>' +
      '<td>' + profileStatusBadge(s.profile_status) + pending + lock + '</td>' +
      '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">' +
      '<button class="btn ol stu-act-btn" type="button" data-stu-action="view" data-stu-key="' + escHtml(key) + '">View</button>' +
      lockBtn +
      '</div></td>' +
      '</tr>';
  }).join('');

  tbody.innerHTML = rows;
  if (meta) {
    meta.textContent = 'Showing ' + filtered.length + ' of ' + list.length +
      ' student account(s) · Filter by branch, year, admission year, profile status, or search';
  }
  // Reset select-all after re-render
  var sa = document.getElementById(pfx + 'SelectAll') || document.getElementById('adStuSelectAll');
  if (sa) sa.checked = false;
  updateStuBulkBarCount();
}
window.filterAdminStudentList = filterAdminStudentList;

function viewAdminStudent(key) {
  var s = window._adminStudentByKey && window._adminStudentByKey[key];
  if (!s) {
    // fallback scan
    s = (window._adminStudentList || []).find(function (x) { return studentListKey(x) === key; });
  }
  if (!s) { alert('Student not found.'); return; }

  var extra = s.extra || {};
  var pfx = activeStudentDbPrefix();
  var body = document.getElementById(pfx + 'ViewBody') || document.getElementById('adStuViewBody');
  var modal = document.getElementById(pfx + 'ViewModal') || document.getElementById('adStuViewModal');
  if (!body || !modal) return;

  function row(label, val) {
    return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">' +
      '<div style="min-width:180px;font-weight:600;color:var(--navy);">' + escHtml(label) + '</div>' +
      '<div style="flex:1;word-break:break-word;">' + escHtml(val == null || val === '' ? '—' : val) + '</div></div>';
  }

  var html = '';
  html += '<div style="margin-bottom:14px;">' +
    '<div style="font-size:1.05rem;font-weight:700;">' + escHtml(s.name || '—') + '</div>' +
    '<div style="font-size:0.78rem;opacity:.75;margin-top:4px;">' +
    escHtml(s.reg_no || 'No reg no') + ' · ' + escHtml(s.dept || '—') + ' · ' + escHtml(s.year || '—') +
    '</div>' +
    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
    accountStatusBadge(s.account_status) + profileStatusBadge(s.profile_status) +
    (s.profile_edit_locked
      ? '<span class="badge" style="background:#fef3c7;color:#92400e;">Edit Locked</span>'
      : '<span class="badge active">Edit Open</span>') +
    (s.pending_profile_requests > 0 ? '<span class="badge pending">Pending request</span>' : '') +
    '</div>';

  if (s.reg_no) {
    var regAttrM = escHtml(String(s.reg_no));
    var nameAttrM = escHtml(String(s.name || s.display_name || s.reg_no));
    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    if (s.profile_edit_locked) {
      html += '<button class="btn gr stu-act-btn" type="button" data-stu-action="unlock" data-stu-reg="' +
        regAttrM + '" data-stu-label="' + nameAttrM + '">🔓 Unlock Profile Edit</button>';
      html += '<span style="font-size:0.75rem;opacity:.75;">Student can request My Profile changes after unlock.</span>';
    } else {
      html += '<button class="btn stu-act-btn" type="button" style="background:#b45309;color:#fff;" data-stu-action="lock" data-stu-reg="' +
        regAttrM + '" data-stu-label="' + nameAttrM + '">🔒 Lock Profile Edit</button>';
      html += '<span style="font-size:0.75rem;opacity:.75;">Student can currently submit profile edit requests.</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:12px 0 6px;">Account</div>';
  html += row('Email', s.email);
  html += row('Display name', s.display_name);
  html += row('Reg. Number', s.reg_no);
  html += row('Account status', s.account_status);

  html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 6px;">Core academic</div>';
  html += row('Name', s.name);
  html += row('Branch / Department', s.dept);
  html += row('Current Year', s.year);
  html += row('Father', s.father);
  html += row('CGPA', s.cgpa);
  html += row('Attendance', s.att);

  // Profile photo (if approved)
  var photoVal = extra['Profile Photo'] || extra['profile_photo'] || extra['photo'] || null;
  if (photoVal && typeof photoVal === 'string' && photoVal.indexOf('data:image/') === 0) {
    html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 6px;">Profile Photo</div>';
    html += '<div style="margin-bottom:12px;"><img src="' + photoVal +
      '" alt="Profile" style="width:88px;height:88px;object-fit:cover;border-radius:50%;border:3px solid var(--border);" /></div>';
  }

  // Full extra profile fields (My Profile data) — skip photo key (shown above)
  var keys = Object.keys(extra).filter(function (k) {
    return k !== 'profile_edit_locked' &&
      k !== 'Profile Photo' && k !== 'profile_photo' && k !== 'photo' && k !== 'ProfilePhoto';
  }).sort();
  html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 6px;">My Profile fields (' + keys.length + ')</div>';
  if (keys.length === 0) {
    html += '<p style="opacity:.7;font-size:0.82rem;">No My Profile data submitted/approved yet.</p>';
  } else {
    keys.forEach(function (k) { html += row(k, extra[k]); });
  }

  body.innerHTML = html;
  modal.style.display = 'flex';
}
window.viewAdminStudent = viewAdminStudent;

function closeAdminStudentView() {
  var modal = document.getElementById('adStuViewModal');
  if (modal) modal.style.display = 'none';
}
window.closeAdminStudentView = closeAdminStudentView;

function showStuToast(msg, isError) {
  try {
    var old = document.getElementById('stuActionToast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'stuActionToast';
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:99999;max-width:420px;padding:14px 18px;' +
      'border-radius:10px;font:600 0.85rem \'Plus Jakarta Sans\',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);' +
      (isError ? 'background:#991b1b;color:#fff;' : 'background:#065f46;color:#fff;');
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 4000);
  } catch (e) { /* ignore */ }
  try { console.log('[stu-action]', isError ? 'ERR' : 'OK', msg); } catch (e2) { /* ignore */ }
}

async function stuPatchLock(body) {
  try {
    var r = await fetch('/api/students', {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(body),
    });
    var text = await r.text();
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {
      return { ok: false, error: 'Bad JSON (HTTP ' + r.status + '): ' + text.slice(0, 180) };
    }
    if (!r.ok) {
      return { ok: false, error: data.error || data.message || ('HTTP ' + r.status), status: r.status, data: data };
    }
    data.ok = true;
    return data;
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Network error' };
  }
}

/**
 * Admin/HOD: lock or unlock a student's ability to request My Profile edits.
 * No confirm dialog — click is intentional (same as account Trash).
 * @param {string} regNo
 * @param {boolean} locked  true = lock, false = unlock
 */
async function setStudentProfileEditLock(regNo, locked) {
  if (!regNo) {
    showStuToast('This student has no registration number — cannot change edit lock.', true);
    return { ok: false };
  }
  var action = locked ? 'lock' : 'unlock';
  console.log('[stu-action]', action, regNo);

  var res = await stuPatchLock({ reg_no: String(regNo), profile_edit_locked: !!locked });
  console.log('[stu-action]', action, 'result', res);

  if (!res.ok) {
    showStuToast('Failed to ' + action + ' edit for ' + regNo + ': ' + (res.error || 'unknown'), true);
    return res;
  }

  showStuToast(
    locked
      ? '🔒 Profile edit locked for ' + regNo
      : '🔓 Profile edit unlocked for ' + regNo + ' — student can request updates again.'
  );

  // Optimistic local update so button flips even before re-fetch finishes
  (window._adminStudentList || []).forEach(function (s) {
    if (String(s.reg_no || '') === String(regNo)) {
      s.profile_edit_locked = !!locked;
      if (s.extra && typeof s.extra === 'object') s.extra.profile_edit_locked = !!locked;
    }
  });
  filterAdminStudentList();

  // Hard refresh from server (cache-busted)
  await renderAdminStudentDatabase();
  var modal = document.getElementById('adStuViewModal');
  if (modal && modal.style.display === 'flex') {
    var match = (window._adminStudentList || []).find(function (s) {
      return String(s.reg_no || '') === String(regNo);
    });
    if (match) viewAdminStudent(studentListKey(match));
  }
  return res;
}
window.setStudentProfileEditLock = setStudentProfileEditLock;

/** Selected reg numbers from Student Database checkboxes. */
function getSelectedStudentRegNos() {
  var root = document.getElementById('adStudents') || document;
  var regs = [];
  var seen = {};
  root.querySelectorAll('.stu-select-cb:checked').forEach(function (cb) {
    var reg = (cb.getAttribute('data-stu-reg') || '').trim();
    if (reg && !seen[reg]) {
      seen[reg] = true;
      regs.push(reg);
    }
  });
  return regs;
}
window.getSelectedStudentRegNos = getSelectedStudentRegNos;

/**
 * Bulk lock / unlock selected students.
 * @param {boolean} locked
 */
async function bulkSetStudentProfileEditLock(locked) {
  var regs = getSelectedStudentRegNos();
  if (!regs.length) {
    showStuToast('Select one or more students first (left checkboxes).', true);
    return;
  }
  var action = locked ? 'lock' : 'unlock';
  console.log('[stu-action] bulk_' + action, regs);

  var res = await stuPatchLock({
    action: 'bulk_set_lock',
    reg_nos: regs,
    profile_edit_locked: !!locked,
  });
  console.log('[stu-action] bulk_' + action, 'result', res);

  if (!res.ok) {
    // Fallback: loop single PATCHes if bulk body rejected
    var ok = 0;
    var fail = 0;
    for (var i = 0; i < regs.length; i++) {
      var one = await stuPatchLock({ reg_no: regs[i], profile_edit_locked: !!locked });
      if (one.ok) ok++; else fail++;
    }
    if (ok === 0) {
      showStuToast('Bulk ' + action + ' failed: ' + (res.error || 'unknown'), true);
      return;
    }
    showStuToast(
      (locked ? '🔒 Locked ' : '🔓 Unlocked ') + ok + ' student(s)' +
      (fail ? ' (' + fail + ' failed)' : '')
    );
  } else {
    showStuToast(
      (locked ? '🔒 Locked ' : '🔓 Unlocked ') +
      (res.updated != null ? res.updated : regs.length) +
      ' student(s).'
    );
  }

  await renderAdminStudentDatabase();
}
window.bulkSetStudentProfileEditLock = bulkSetStudentProfileEditLock;
window.bulkUnlockStudentProfiles = function () { return bulkSetStudentProfileEditLock(false); };
window.bulkLockStudentProfiles = function () { return bulkSetStudentProfileEditLock(true); };

// Safe globals so inline HTML handlers never throw before bridge is ready
if (typeof window.filterAdminStudentList !== 'function') {
  window.filterAdminStudentList = function () { /* bridge still loading */ };
}
if (typeof window.renderAdminStudentDatabase !== 'function') {
  window.renderAdminStudentDatabase = function () { /* bridge still loading */ };
}

/* ================================================================
   LIVE NOTIFICATIONS PANEL (replaces demo np-list items)
   ================================================================ */
function escNotif(t) {
  var d = document.createElement('div');
  d.textContent = t == null ? '' : String(t);
  return d.innerHTML;
}

async function renderLiveNotifications() {
  var list = document.getElementById('notifList');
  if (!list) return;

  var data = null;
  try {
    var res = await fetch('/api/notifications', { credentials: 'same-origin' });
    if (res.ok) data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!data || !Array.isArray(data.notifications)) {
    list.innerHTML =
      '<div class="ni" style="opacity:.75;"><div class="ni-title">Unable to load</div>' +
      '<div class="ni-desc">Sign in to see live notifications.</div></div>';
    updateNotifBadges(0);
    return;
  }

  var items = data.notifications;
  if (!items.length) {
    list.innerHTML =
      '<div class="ni" style="opacity:.75;"><div class="ni-title">No notifications</div>' +
      '<div class="ni-desc">You are all caught up. New account/profile/form activity will appear here.</div></div>';
    updateNotifBadges(0);
    return;
  }

  list.innerHTML = items.map(function (n) {
    var cls = n.unread ? 'ni unr' : 'ni';
    return '<div class="' + cls + '" data-kind="' + escNotif(n.kind || '') + '">' +
      '<div class="ni-title">' + escNotif(n.title || 'Notification') + '</div>' +
      '<div class="ni-desc">' + escNotif(n.desc || '') + '</div>' +
      (n.time ? '<div class="ni-time">' + escNotif(n.time) + '</div>' : '') +
      '</div>';
  }).join('');

  updateNotifBadges(typeof data.unread === 'number' ? data.unread : items.filter(function (i) { return i.unread; }).length);
}
window.renderLiveNotifications = renderLiveNotifications;

function updateNotifBadges(count) {
  var n = Number(count) || 0;
  document.querySelectorAll('.nb-dot, #stuNotifDot').forEach(function (el) {
    el.textContent = String(n);
    el.style.display = n > 0 ? '' : 'none';
  });
}
window.updateNotifBadges = updateNotifBadges;

// Refresh notifications after login / periodically while a session is active
setInterval(function () {
  if (window.currentUser && typeof window.renderLiveNotifications === 'function') {
    // Only refresh badge quietly when panel closed; full list when open
    window.renderLiveNotifications();
  }
}, 20000);
/* ================================================================
   GLOBAL ACCOUNT ACTIONS — always available (outside __initGptBridge)
   Uses data-acc-action buttons + document delegation so delete /
   password / deactivate / bulk delete always work.
   ================================================================ */
(function installAccountActionBus() {
  // Always re-bind handlers (init used to overwrite them — reinstall is safe)
  window._accActionBusInstalled = true;

  async function accFetch(method, url, body) {
    try {
      var opts = {
        method: method,
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      };
      if (body != null && method !== "GET" && method !== "HEAD") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      // Cache-bust GET
      if (method === "GET" && url.indexOf("_ts=") === -1) {
        url += (url.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now();
      }
      var r = await fetch(url, opts);
      var text = await r.text();
      var data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) {
        return { ok: false, error: "Bad JSON from server (HTTP " + r.status + "): " + text.slice(0, 200) };
      }
      if (!r.ok) {
        return { ok: false, error: data.error || data.message || ("HTTP " + r.status), status: r.status, data: data };
      }
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, error: (e && e.message) || "Network error" };
    }
  }

  function showAccToast(msg, isError) {
    try {
      var old = document.getElementById("accActionToast");
      if (old) old.remove();
      var t = document.createElement("div");
      t.id = "accActionToast";
      t.textContent = msg;
      t.style.cssText =
        "position:fixed;bottom:24px;right:24px;z-index:99999;max-width:420px;padding:14px 18px;" +
        "border-radius:10px;font:600 0.85rem 'Plus Jakarta Sans',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.25);" +
        (isError
          ? "background:#991b1b;color:#fff;"
          : "background:#065f46;color:#fff;");
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.remove(); }, 4500);
    } catch (e) { /* ignore */ }
    try { alert(msg); } catch (e2) { console.log("[acc-toast]", msg); }
  }

  function refreshAccounts() {
    console.log("[acc-action] refreshing list…");
    if (typeof window.renderAccountApprovals === "function") {
      Promise.resolve(window.renderAccountApprovals())
        .then(function () { console.log("[acc-action] list refreshed"); })
        .catch(function (e) { console.error("[acc-action] refresh failed", e); });
    } else {
      console.error("[acc-action] renderAccountApprovals missing — reloading page");
      window.location.reload();
    }
  }

  function selectedIds() {
    var root = document.getElementById("bridgeAccountApprovals") ||
      document.getElementById("bridgeUserManagement") ||
      document;
    // Prefer the visible host
    var apHost = document.getElementById("adUserApprovals");
    if (apHost && apHost.offsetParent !== null && document.getElementById("bridgeAccountApprovals")) {
      root = document.getElementById("bridgeAccountApprovals");
    }
    var umHost = document.getElementById("adUsers");
    if (umHost && umHost.offsetParent !== null && document.getElementById("bridgeUserManagement")) {
      root = document.getElementById("bridgeUserManagement");
    }
    var ids = [];
    var seen = {};
    root.querySelectorAll(".acc-select-cb:checked").forEach(function (cb) {
      if (cb.getAttribute("data-mode") === "trash") return;
      var n = Number(cb.getAttribute("data-acc-id"));
      if (Number.isFinite(n) && n > 0 && !seen[n]) {
        seen[n] = true;
        ids.push(n);
      }
    });
    return ids;
  }

  window.getSelectedAccountIds = selectedIds;

  async function runAction(action, id, label) {
    id = Number(id);
    label = label || String(id);
    console.log("[acc-action]", action, id, label);

    // Prefer POST (most reliable); fall back to PATCH
    async function usersMutate(body) {
      var r = await accFetch("POST", "/api/users", body);
      if (r.ok) return r;
      var r2 = await accFetch("PATCH", "/api/users", body);
      if (r2.ok) return r2;
      return { ok: false, error: (r.error || r2.error || "Request failed") };
    }

    if (action === "approve") {
      var r1 = await usersMutate({ id: id, action: "approve" });
      if (!r1.ok) r1 = await accFetch("POST", "/api/approvals", { id: id, action: "approved" });
      console.log("[acc-action] approve result", r1);
      showAccToast(r1.ok ? "✅ Account approved." : "Approve failed: " + (r1.error || ""), !r1.ok);
      if (r1.ok) refreshAccounts();
      return;
    }
    if (action === "reject") {
      var r2 = await usersMutate({ id: id, action: "reject" });
      if (!r2.ok) r2 = await accFetch("POST", "/api/approvals", { id: id, action: "rejected" });
      console.log("[acc-action] reject result", r2);
      showAccToast(r2.ok ? "✕ Account rejected." : "Reject failed: " + (r2.error || ""), !r2.ok);
      if (r2.ok) refreshAccounts();
      return;
    }
    if (action === "deactivate") {
      // No confirm — user already clicked the button intentionally
      var r3 = await usersMutate({ id: id, action: "set_status", status: "rejected" });
      console.log("[acc-action] deactivate result", r3);
      showAccToast(
        r3.ok
          ? "Account deactivated (status = Rejected). Row stays visible with Rejected badge — use Trash to hide it."
          : "Deactivate failed: " + (r3.error || ""),
        !r3.ok
      );
      if (r3.ok) refreshAccounts();
      return;
    }
    if (action === "activate") {
      var r4 = await usersMutate({ id: id, action: "set_status", status: "approved" });
      console.log("[acc-action] activate result", r4);
      showAccToast(r4.ok ? "Account re-activated (Approved)." : "Activate failed: " + (r4.error || ""), !r4.ok);
      if (r4.ok) refreshAccounts();
      return;
    }
    if (action === "password") {
      var custom = window.prompt(
        "Reset password for " + label + "?\n\nLeave blank for temporary password TemporaryPassword123!\nOr type a new password (min 8 chars):",
        ""
      );
      if (custom === null) {
        showAccToast("Password reset cancelled.", true);
        return;
      }
      var body = { id: id, action: "reset_password" };
      if (String(custom).trim()) body.newPassword = String(custom).trim();
      var r5 = await usersMutate(body);
      console.log("[acc-action] password result", r5);
      if (r5.ok) {
        showAccToast(
          "🔑 Password reset for " + label + ". " +
          (r5.temporary_password
            ? "Temp: " + r5.temporary_password + " (must change on login)"
            : "Custom password set (must change on login)")
        );
        refreshAccounts();
      } else {
        showAccToast("Password reset failed: " + (r5.error || ""), true);
      }
      return;
    }
    if (action === "trash") {
      // No second confirm dialog — click is enough (dialogs were easy to miss/cancel)
      var r6 = await usersMutate({ id: id, action: "soft_delete" });
      if (!r6.ok) {
        r6 = await accFetch("DELETE", "/api/users?id=" + encodeURIComponent(id), null);
      }
      console.log("[acc-action] trash result", r6);
      showAccToast(r6.ok ? "🗑 " + label + " moved to Trash (see bottom section)." : "Trash failed: " + (r6.error || ""), !r6.ok);
      if (r6.ok) refreshAccounts();
      return;
    }
    if (action === "restore") {
      var r7 = await usersMutate({ id: id, action: "restore" });
      console.log("[acc-action] restore result", r7);
      showAccToast(r7.ok ? "↩ " + label + " restored." : "Restore failed: " + (r7.error || ""), !r7.ok);
      if (r7.ok) refreshAccounts();
      return;
    }
    if (action === "purge") {
      if (!window.confirm("PERMANENTLY delete " + label + "?\nThis cannot be undone.")) return;
      var r8 = await accFetch("DELETE", "/api/users?id=" + encodeURIComponent(id) + "&hard=1", null);
      console.log("[acc-action] purge result", r8);
      showAccToast(r8.ok ? "☠ Permanently deleted." : "Purge failed: " + (r8.error || ""), !r8.ok);
      if (r8.ok) refreshAccounts();
      return;
    }
    if (action === "bulk_trash") {
      var ids = selectedIds();
      if (!ids.length) {
        showAccToast("Select one or more accounts first (left checkboxes).", true);
        return;
      }
      var r9 = await usersMutate({ action: "bulk_soft_delete", ids: ids });
      console.log("[acc-action] bulk_trash result", r9);
      if (r9.ok) {
        showAccToast("🗑 Moved " + (r9.deleted != null ? r9.deleted : ids.length) + " account(s) to Trash.");
        refreshAccounts();
      } else {
        showAccToast("Bulk delete failed: " + (r9.error || JSON.stringify(r9)), true);
      }
      return;
    }
    if (action === "bulk_demo") {
      var list = await accFetch("GET", "/api/users?status=all&_ts=" + Date.now(), null);
      if (!list.ok || !Array.isArray(list.accounts)) {
        showAccToast("Could not load accounts: " + (list.error || ""), true);
        return;
      }
      var demoIds = list.accounts.filter(function (a) { return a.is_demo; }).map(function (a) { return Number(a.id); });
      if (!demoIds.length) {
        showAccToast("No active demo accounts (already in trash or none).", true);
        return;
      }
      var r10 = await usersMutate({ action: "bulk_soft_delete", ids: demoIds });
      console.log("[acc-action] bulk_demo result", r10);
      if (r10.ok) {
        showAccToast("🗑 Moved " + (r10.deleted != null ? r10.deleted : demoIds.length) + " demo account(s) to Trash.");
        refreshAccounts();
      } else {
        showAccToast("Failed: " + (r10.error || ""), true);
      }
      return;
    }
  }

  // Global handlers used by bulk bar / legacy names
  window.bridgeBulkDeleteAccounts = function () { return runAction("bulk_trash"); };
  window.bridgeBulkDeleteDemoAccounts = function () { return runAction("bulk_demo"); };
  window.bridgeDeleteAccount = function (id, label) { return runAction("trash", id, label); };
  window.bridgeDecideAccount = function (id, action) {
    return runAction(action === "approved" || action === "approve" ? "approve" : "reject", id);
  };
  window.bridgeSetAccountStatus = function (id, status) {
    return runAction(status === "rejected" ? "deactivate" : "activate", id);
  };
  window.bridgeResetAccountPassword = function (id, label) { return runAction("password", id, label); };
  window.bridgeRestoreAccount = function (id, label) { return runAction("restore", id, label); };
  window.bridgeHardDeleteAccount = function (id, label) { return runAction("purge", id, label); };

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // Row action buttons
      var actBtn = t.closest(".acc-act-btn");
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        var action = actBtn.getAttribute("data-acc-action");
        var id = actBtn.getAttribute("data-acc-id");
        var label = actBtn.getAttribute("data-acc-label") || id;
        runAction(action, id, label);
        return;
      }

      // Bulk buttons
      if (t.closest(".acc-bulk-delete-btn")) {
        e.preventDefault();
        e.stopPropagation();
        runAction("bulk_trash");
        return;
      }
      if (t.closest(".acc-bulk-demo-btn")) {
        e.preventDefault();
        e.stopPropagation();
        runAction("bulk_demo");
        return;
      }
    },
    true
  );

  document.addEventListener(
    "change",
    function (e) {
      var t = e.target;
      if (!t) return;
      if (t.classList && t.classList.contains("acc-select-all-cb")) {
        var on = !!t.checked;
        var root = t.closest("#bridgeAccountApprovals, #bridgeUserManagement") || document;
        root.querySelectorAll(".acc-select-cb").forEach(function (cb) {
          if (cb.getAttribute("data-mode") === "trash") return;
          cb.checked = on;
        });
        var n = root.querySelectorAll(".acc-select-cb:checked").length;
        root.querySelectorAll(".acc-selected-count").forEach(function (el) {
          el.textContent = n + " selected";
        });
      } else if (t.classList && t.classList.contains("acc-select-cb")) {
        var root2 = t.closest("#bridgeAccountApprovals, #bridgeUserManagement") || document;
        var n2 = root2.querySelectorAll(".acc-select-cb:checked").length;
        root2.querySelectorAll(".acc-selected-count").forEach(function (el) {
          el.textContent = n2 + " selected";
        });
      }
    },
    true
  );

  console.log("[bridge] account action bus installed");
})();

/* ================================================================
   STUDENT DATABASE — lock / unlock / bulk via data-stu-action
   (inline onclick was unreliable; same pattern as account bus)
   ================================================================ */
(function installStudentActionBus() {
  window._stuActionBusInstalled = true;

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var actBtn = t.closest(".stu-act-btn");
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        var action = actBtn.getAttribute("data-stu-action");
        var reg = actBtn.getAttribute("data-stu-reg") || "";
        var key = actBtn.getAttribute("data-stu-key") || "";
        var label = actBtn.getAttribute("data-stu-label") || reg;
        console.log("[stu-action] click", action, reg || key, label);

        if (action === "view") {
          if (typeof window.viewAdminStudent === "function") window.viewAdminStudent(key);
          return;
        }
        if (action === "unlock") {
          if (typeof window.setStudentProfileEditLock === "function") {
            window.setStudentProfileEditLock(reg, false);
          }
          return;
        }
        if (action === "lock") {
          if (typeof window.setStudentProfileEditLock === "function") {
            window.setStudentProfileEditLock(reg, true);
          }
          return;
        }
        return;
      }

      if (t.closest(".stu-bulk-unlock-btn")) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.bulkUnlockStudentProfiles === "function") {
          window.bulkUnlockStudentProfiles();
        }
        return;
      }
      if (t.closest(".stu-bulk-lock-btn")) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.bulkLockStudentProfiles === "function") {
          window.bulkLockStudentProfiles();
        }
        return;
      }
    },
    true
  );

  document.addEventListener(
    "change",
    function (e) {
      var t = e.target;
      if (!t) return;
      if (t.id === "adStuSelectAll" || (t.classList && t.classList.contains("stu-select-all-cb"))) {
        var on = !!t.checked;
        var root = document.getElementById("adStudents") || document;
        root.querySelectorAll(".stu-select-cb").forEach(function (cb) {
          if (!cb.disabled) cb.checked = on;
        });
        if (typeof window.updateStuBulkBarCount === "function") window.updateStuBulkBarCount();
      } else if (t.classList && t.classList.contains("stu-select-cb")) {
        if (typeof window.updateStuBulkBarCount === "function") window.updateStuBulkBarCount();
      }
    },
    true
  );

  console.log("[bridge] student action bus installed");
})();

/* ================================================================
   Admin + ACM — Student Data browser (branch / year filters)
   Full My Profile data list for certificate desk & admin review.
   ================================================================ */
(function () {
  'use strict';

  window._studentDataList = window._studentDataList || [];
  window._studentDataByKey = window._studentDataByKey || {};

  function sdEsc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function sdPick(extra, keys) {
    if (!extra || typeof extra !== 'object') return '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (extra[k] != null && String(extra[k]).trim() !== '') return String(extra[k]).trim();
      var found = Object.keys(extra).find(function (ek) {
        return ek.replace(/\s+/g, ' ').trim().toLowerCase() === k.replace(/\s+/g, ' ').trim().toLowerCase();
      });
      if (found && extra[found] != null && String(extra[found]).trim() !== '') {
        return String(extra[found]).trim();
      }
    }
    return '';
  }

  function sdYearOf(s) {
    var extra = s.extra || {};
    return (
      String(s.year || '').trim() ||
      sdPick(extra, ['Current Year', 'Year', 'Academic Year']) ||
      ''
    );
  }

  function sdAdmissionYear(s) {
    var extra = s.extra || {};
    return sdPick(extra, ['Year of Admission', 'Year Of Admission', 'Admission Year']) || '';
  }

  function sdNormalizeRow(s) {
    var extra = s.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    return {
      key: String(s.user_id || s.reg_no || s.email || Math.random()),
      reg_no: s.reg_no || '',
      name:
        s.name ||
        s.display_name ||
        sdPick(extra, ['Student (As per SSLC)', 'Student (As per Aadhar)', 'Name']) ||
        '—',
      father: s.father || sdPick(extra, ['Father Name', "Father's Name"]) || '',
      mother: sdPick(extra, ['Mother Name', "Mother's Name"]) || '',
      dept: s.dept || sdPick(extra, ['Branch']) || '',
      year: sdYearOf(Object.assign({}, s, { extra: extra })),
      admission_year: sdAdmissionYear({ extra: extra }),
      gender: sdPick(extra, ['Gender']) || '',
      phone:
        sdPick(extra, [
          'WhatsApp Number',
          'Student whatsapp Mobile Number',
          'Aadhar Registered Mobile',
          'Aadhar Registerd Mobile Number',
        ]) || '',
      parent_phone: sdPick(extra, ['Parents Mobile Number']) || '',
      email: s.email || sdPick(extra, ['Valid E-mail ID']) || '',
      dob: sdPick(extra, ['Date of Birth', 'DOB']) || '',
      category: sdPick(extra, ['Category']) || '',
      religion: sdPick(extra, ['Religion']) || '',
      caste: sdPick(extra, ['Caste']) || '',
      account_status: s.account_status || '',
      profile_status: s.profile_status || '',
      extra: extra,
      raw: s,
    };
  }

  function ensureStudentDataMenu() {
    // ---- Admin shell ----
    var adMenu = document.querySelector('#dbAdmin .sb-menu');
    if (adMenu && !document.getElementById('adStudentDataNav')) {
      var studentsLink = null;
      adMenu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('adStudents') !== -1) studentsLink = sl;
      });
      var nav = document.createElement('div');
      nav.className = 'sl';
      nav.id = 'adStudentDataNav';
      nav.setAttribute('onclick', "showSec('adStudentData',this)");
      nav.innerHTML = '<span class="sli">📊</span>Student Data';
      if (studentsLink && studentsLink.nextSibling) {
        studentsLink.parentNode.insertBefore(nav, studentsLink.nextSibling);
      } else if (studentsLink) {
        studentsLink.parentNode.appendChild(nav);
      } else {
        adMenu.appendChild(nav);
      }
    }
    var adContent = document.querySelector('#dbAdmin .db-content');
    if (adContent && !document.getElementById('adStudentData')) {
      var panel = document.createElement('div');
      panel.id = 'adStudentData';
      panel.style.display = 'none';
      panel.innerHTML = studentDataPanelHtml('ad');
      adContent.appendChild(panel);
    }

    // ---- Faculty / ACM shell ----
    var facMenu = document.querySelector('#dbFaculty .sb-menu');
    if (facMenu && !document.getElementById('facStudentDataNav')) {
      var acmLink = null;
      facMenu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('facACM') !== -1) acmLink = sl;
      });
      var fnav = document.createElement('div');
      fnav.className = 'sl';
      fnav.id = 'facStudentDataNav';
      fnav.setAttribute('data-fac', 'studentdata');
      fnav.setAttribute('onclick', "showSec('facStudentData',this)");
      fnav.innerHTML = '<span class="sli">📊</span>Student Data';
      if (acmLink && acmLink.nextSibling) {
        acmLink.parentNode.insertBefore(fnav, acmLink.nextSibling);
      } else if (acmLink) {
        acmLink.parentNode.appendChild(fnav);
      } else {
        facMenu.appendChild(fnav);
      }
      // Hide by default; demoLogin / roleAccess will show for ACM etc.
      // If ACM uses admin shell, faculty link is unused.
      fnav.style.display = 'none';
    }
    var facContent = document.querySelector('#dbFaculty .db-content');
    if (facContent && !document.getElementById('facStudentData')) {
      var fpanel = document.createElement('div');
      fpanel.id = 'facStudentData';
      fpanel.style.display = 'none';
      fpanel.innerHTML = studentDataPanelHtml('fac');
      facContent.appendChild(fpanel);
    }
  }

  function studentDataPanelHtml(prefix) {
    var p = prefix === 'fac' ? 'facSd' : 'adSd';
    var official = (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
        'Civil Engineering',
        'Computer Science and Engineering',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
      ];
    var branchOpts = official.map(function (b) {
      return '<option value="' + sdEsc(b) + '">' + sdEsc(b) + '</option>';
    }).join('');
    return '' +
      '<div class="info-box">📊 <strong>Student Data</strong> — All students with <strong>Branch</strong> and <strong>Year</strong> filters. Click a row to view full My Profile details. Used by Admin and ACM for certificate desk.</div>' +
      '<div class="card">' +
      '<div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">Student Data — Branch / Year</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn ol" onclick="window.renderStudentDataBrowser&&window.renderStudentDataBrowser()">↻ Refresh</button>' +
      '<button type="button" class="btn pr" onclick="window.exportStudentDataCsv&&window.exportStudentDataCsv()">⬇ Export CSV</button>' +
      '</div></div>' +
      '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:2fr 1.4fr 1fr 1fr;gap:10px;align-items:end;">' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Search</label>' +
      '<div class="sbar" style="margin:0;"><span class="si">🔍</span>' +
      '<input type="text" id="' + p + '_search" placeholder="Name, reg no, father, phone…" ' +
      'oninput="window.filterStudentDataList&&window.filterStudentDataList()" /></div></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Branch</label>' +
      '<select id="' + p + '_branch" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
      '<option value="">All Branches</option>' + branchOpts + '</select></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Current Year</label>' +
      '<select id="' + p + '_year" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
      '<option value="">All Years</option>' +
      '<option value="1st">1st Year</option>' +
      '<option value="2nd">2nd Year</option>' +
      '<option value="3rd">3rd Year</option>' +
      '</select></div>' +
      '<div class="fg" style="margin:0;"><label style="font-size:0.72rem;font-weight:700;">Admission Year</label>' +
      '<select id="' + p + '_adm" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
      'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
      '<option value="">All</option></select></div>' +
      '</div>' +
      '<div id="' + p + '_meta" style="padding:8px 16px;font-size:0.78rem;opacity:.8;border-bottom:1px solid var(--border);">Loading…</div>' +
      '<div id="' + p + '_stats" style="padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--border);"></div>' +
      '<div style="overflow-x:auto;max-height:calc(100vh - 280px);">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">' +
      '<thead style="position:sticky;top:0;background:var(--surface);z-index:1;"><tr>' +
      '<th style="padding:8px;text-align:left;">Reg No</th>' +
      '<th style="padding:8px;text-align:left;">Name</th>' +
      '<th style="padding:8px;text-align:left;">Father</th>' +
      '<th style="padding:8px;text-align:left;">Mother</th>' +
      '<th style="padding:8px;text-align:left;">Branch</th>' +
      '<th style="padding:8px;text-align:left;">Year</th>' +
      '<th style="padding:8px;text-align:left;">Adm. Year</th>' +
      '<th style="padding:8px;text-align:left;">Phone</th>' +
      '<th style="padding:8px;text-align:left;">Email</th>' +
      '<th style="padding:8px;text-align:left;">Action</th>' +
      '</tr></thead>' +
      '<tbody id="' + p + '_tbody"><tr><td colspan="10" style="padding:24px;text-align:center;opacity:.7;">Open this menu to load students.</td></tr></tbody>' +
      '</table></div></div>' +
      // Modal
      '<div id="' + p + '_modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:99990;align-items:center;justify-content:center;padding:16px;">' +
      '<div style="background:#fff;border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:#fff;z-index:1;">' +
      '<h3 style="margin:0;font-size:1rem;">Student Profile</h3>' +
      '<button type="button" class="btn ol" onclick="window.closeStudentDataView&&window.closeStudentDataView()">Close</button>' +
      '</div>' +
      '<div id="' + p + '_modalBody" style="padding:16px;"></div>' +
      '</div></div>';
  }

  function activePrefix() {
    var ad = document.getElementById('adStudentData');
    var fac = document.getElementById('facStudentData');
    var pri = document.getElementById('priStudentData');
    if (pri && pri.style.display !== 'none' && pri.offsetParent !== null) return 'priSd';
    if (ad && ad.style.display !== 'none' && ad.offsetParent !== null) return 'adSd';
    if (fac && fac.style.display !== 'none' && fac.offsetParent !== null) return 'facSd';
    if (pri && document.getElementById('dbPrincipal') && document.getElementById('dbPrincipal').classList.contains('show')) return 'priSd';
    if (ad && document.getElementById('dbAdmin') && document.getElementById('dbAdmin').classList.contains('show')) return 'adSd';
    return 'facSd';
  }

  function prefixFromSec(secId) {
    if (secId === 'facStudentData') return 'facSd';
    if (secId === 'adStudentData') return 'adSd';
    if (secId === 'priStudentData') return 'priSd';
    return activePrefix();
  }

  function yearMatch(studentYear, filterYear) {
    if (!filterYear) return true;
    var y = String(studentYear || '').toLowerCase().replace(/\s+/g, ' ').trim();
    var f = String(filterYear || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!y) return false;
    if (y.indexOf(f) !== -1 || f.indexOf(y) !== -1) return true;
    var yn = y.replace(/year/g, '').replace(/\s+/g, '');
    var fn = f.replace(/year/g, '').replace(/\s+/g, '');
    return !!(yn && fn && (yn.indexOf(fn) !== -1 || fn.indexOf(yn) !== -1));
  }

  function branchMatch(dept, filterBranch) {
    if (!filterBranch) return true;
    var d = String(dept || '').toLowerCase();
    var f = String(filterBranch || '').toLowerCase();
    if (!d) return false;
    if (d === f || d.indexOf(f) !== -1 || f.indexOf(d) !== -1) return true;
    // loose aliases
    if (f.indexOf('computer') >= 0 && d.indexOf('computer') >= 0) return true;
    if (f.indexOf('civil') >= 0 && d.indexOf('civil') >= 0) return true;
    if (f.indexOf('mech') >= 0 && d.indexOf('mech') >= 0) return true;
    if ((f.indexOf('electron') >= 0 || f.indexOf('ece') >= 0) &&
        (d.indexOf('electron') >= 0 || d.indexOf('ece') >= 0)) return true;
    return false;
  }

  function getFilteredList(p) {
    var q = ((document.getElementById(p + '_search') || {}).value || '').trim().toLowerCase();
    var branch = ((document.getElementById(p + '_branch') || {}).value || '').trim();
    var year = ((document.getElementById(p + '_year') || {}).value || '').trim();
    var adm = ((document.getElementById(p + '_adm') || {}).value || '').trim();
    return (window._studentDataList || []).filter(function (s) {
      if (!branchMatch(s.dept, branch)) return false;
      if (!yearMatch(s.year, year)) return false;
      if (adm) {
        if (String(s.admission_year || '').indexOf(adm) === -1) return false;
      }
      if (q) {
        var hay = [s.reg_no, s.name, s.father, s.mother, s.dept, s.year, s.phone, s.email, s.admission_year]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function paintStats(p, filtered, all) {
    var host = document.getElementById(p + '_stats');
    if (!host) return;
    var byBranch = {};
    filtered.forEach(function (s) {
      var b = s.dept || 'Unknown';
      byBranch[b] = (byBranch[b] || 0) + 1;
    });
    var chips = Object.keys(byBranch).sort().map(function (b) {
      return '<span class="badge" style="background:#eff6ff;color:#1e3a8a;font-size:0.72rem;">' +
        sdEsc(b) + ': <strong>' + byBranch[b] + '</strong></span>';
    }).join('');
    host.innerHTML = chips || '<span style="opacity:.6;font-size:0.78rem;">No branch stats</span>';
    var meta = document.getElementById(p + '_meta');
    if (meta) {
      meta.textContent = 'Showing ' + filtered.length + ' of ' + all.length +
        ' student(s) · Filter by Branch / Year / Admission Year';
    }
  }

  function paintTable(p) {
    var tbody = document.getElementById(p + '_tbody');
    if (!tbody) return;
    var all = window._studentDataList || [];
    var filtered = getFilteredList(p);
    paintStats(p, filtered, all);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="padding:28px;text-align:center;opacity:.7;">No students match these filters.</td></tr>';
      return;
    }
    // Sort: branch → year → name
    filtered = filtered.slice().sort(function (a, b) {
      var c = String(a.dept || '').localeCompare(String(b.dept || ''));
      if (c) return c;
      c = String(a.year || '').localeCompare(String(b.year || ''));
      if (c) return c;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    tbody.innerHTML = filtered.map(function (s) {
      var keyJs = JSON.stringify(String(s.key));
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:7px 8px;font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + sdEsc(s.reg_no || '—') + '</td>' +
        '<td style="padding:7px 8px;"><strong>' + sdEsc(s.name) + '</strong></td>' +
        '<td style="padding:7px 8px;">' + sdEsc(s.father || '—') + '</td>' +
        '<td style="padding:7px 8px;">' + sdEsc(s.mother || '—') + '</td>' +
        '<td style="padding:7px 8px;font-size:0.75rem;">' + sdEsc(s.dept || '—') + '</td>' +
        '<td style="padding:7px 8px;">' + sdEsc(s.year || '—') + '</td>' +
        '<td style="padding:7px 8px;">' + sdEsc(s.admission_year || '—') + '</td>' +
        '<td style="padding:7px 8px;font-size:0.75rem;">' + sdEsc(s.phone || '—') + '</td>' +
        '<td style="padding:7px 8px;font-size:0.72rem;">' + sdEsc(s.email || '—') + '</td>' +
        '<td style="padding:7px 8px;"><button type="button" class="btn ol" style="padding:3px 8px;font-size:0.72rem;" ' +
        "onclick='window.viewStudentDataRow&&window.viewStudentDataRow(" + keyJs + ")'>View</button></td>" +
        '</tr>';
    }).join('');
  }

  window.filterStudentDataList = function () {
    paintTable(activePrefix());
    // Keep panels in sync if they exist
    if (document.getElementById('adSd_tbody')) paintTable('adSd');
    if (document.getElementById('facSd_tbody')) paintTable('facSd');
    if (document.getElementById('priSd_tbody')) paintTable('priSd');
  };

  window.renderStudentDataBrowser = async function (secId) {
    ensureStudentDataMenu();
    var p = prefixFromSec(secId);
    var tbody = document.getElementById(p + '_tbody');
    var cu = window.currentUser;
    if (!cu) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" style="padding:24px;text-align:center;opacity:.75;">Sign in as Admin / ACM to view student data.</td></tr>';
      }
      return;
    }
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="10" style="padding:24px;text-align:center;opacity:.7;">Loading students…</td></tr>';
    }
    var data = null;
    try {
      var r = await fetch('/api/students?_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
      data = await r.json().catch(function () { return null; });
      if (!r.ok) data = null;
    } catch (e) {
      data = null;
    }
    if (!data || !Array.isArray(data.students)) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" style="padding:24px;text-align:center;color:#991b1b;">Failed to load students. Session may have expired — please log in again.</td></tr>';
      }
      return;
    }
    var list = data.students.map(sdNormalizeRow);
    window._studentDataList = list;
    window._studentDataByKey = {};
    list.forEach(function (s) { window._studentDataByKey[s.key] = s; });

    // Populate admission year filter
    var years = {};
    list.forEach(function (s) {
      if (s.admission_year) years[s.admission_year] = true;
    });
    ;['adSd', 'facSd', 'priSd'].forEach(function (px) {
      var sel = document.getElementById(px + '_adm');
      if (!sel) return;
      var prev = sel.value || '';
      var opts = '<option value="">All</option>';
      Object.keys(years).sort().reverse().forEach(function (y) {
        opts += '<option value="' + sdEsc(y) + '"' + (y === prev ? ' selected' : '') + '>' + sdEsc(y) + '</option>';
      });
      sel.innerHTML = opts;
      // HOD: lock branch select
      var br = document.getElementById(px + '_branch');
      if (br && cu.role === 'hod' && cu.branch) {
        br.innerHTML = '<option value="' + sdEsc(cu.branch) + '" selected>' + sdEsc(cu.branch) + '</option>';
        br.disabled = true;
      } else if (br && data.scope && data.scope.branch) {
        br.innerHTML = '<option value="' + sdEsc(data.scope.branch) + '" selected>' + sdEsc(data.scope.branch) + '</option>';
        br.disabled = true;
      }
    });

    paintTable('adSd');
    paintTable('facSd');
    paintTable('priSd');
  };

  window.viewStudentDataRow = function (key) {
    var s = window._studentDataByKey && window._studentDataByKey[key];
    if (!s) {
      alert('Student not found.');
      return;
    }
    var p = activePrefix();
    var body = document.getElementById(p + '_modalBody');
    var modal = document.getElementById(p + '_modal');
    if (!body || !modal) return;

    function row(label, val) {
      return '<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">' +
        '<div style="min-width:170px;font-weight:600;color:var(--navy);">' + sdEsc(label) + '</div>' +
        '<div style="flex:1;word-break:break-word;">' + sdEsc(val == null || val === '' ? '—' : val) + '</div></div>';
    }

    var html = '<div style="margin-bottom:12px;">' +
      '<div style="font-size:1.05rem;font-weight:700;">' + sdEsc(s.name) + '</div>' +
      '<div style="font-size:0.78rem;opacity:.75;margin-top:4px;">' +
      sdEsc(s.reg_no || '—') + ' · ' + sdEsc(s.dept || '—') + ' · ' + sdEsc(s.year || '—') +
      '</div></div>';

    html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:10px 0 4px;">Core</div>';
    html += row('Register Number', s.reg_no);
    html += row('Name', s.name);
    html += row('Father Name', s.father);
    html += row('Mother Name', s.mother);
    html += row('Branch', s.dept);
    html += row('Current Year', s.year);
    html += row('Admission Year', s.admission_year);
    html += row('Date of Birth', s.dob);
    html += row('Gender', s.gender);
    html += row('Category', s.category);
    html += row('Religion', s.religion);
    html += row('Caste', s.caste);
    html += row('Phone / WhatsApp', s.phone);
    html += row('Parents Mobile', s.parent_phone);
    html += row('Email', s.email);

    var extra = s.extra || {};
    var skip = {
      profile_edit_locked: 1, imported_from_excel: 1, imported_at: 1,
      'Profile Photo': 1, profile_photo: 1, photo: 1,
    };
    var keys = Object.keys(extra).filter(function (k) { return !skip[k]; }).sort();
    if (keys.length) {
      html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 4px;">Full My Profile (' + keys.length + ')</div>';
      keys.forEach(function (k) {
        var v = extra[k];
        if (typeof v === 'string' && v.indexOf('data:image/') === 0) return;
        html += row(k, v);
      });
    }

    var photo = extra['Profile Photo'] || extra.profile_photo || extra.photo;
    if (photo && typeof photo === 'string' && photo.indexOf('data:image/') === 0) {
      html = '<div style="margin-bottom:12px;"><img src="' + photo +
        '" alt="Photo" style="width:88px;height:88px;object-fit:cover;border-radius:8px;border:2px solid var(--border);" /></div>' + html;
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
  };

  window.closeStudentDataView = function () {
    ;['adSd_modal', 'facSd_modal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m) m.style.display = 'none';
    });
  };

  window.exportStudentDataCsv = function () {
    var p = activePrefix();
    var list = getFilteredList(p);
    if (!list.length) {
      alert('No rows to export for current filters.');
      return;
    }
    var headers = [
      'Reg No', 'Name', 'Father', 'Mother', 'Branch', 'Year', 'Admission Year',
      'Gender', 'DOB', 'Phone', 'Parent Phone', 'Email', 'Category', 'Religion', 'Caste',
    ];
    function csvCell(v) {
      var s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [headers.join(',')];
    list.forEach(function (s) {
      lines.push([
        s.reg_no, s.name, s.father, s.mother, s.dept, s.year, s.admission_year,
        s.gender, s.dob, s.phone, s.parent_phone, s.email, s.category, s.religion, s.caste,
      ].map(csvCell).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'student-data-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  };

  function bootStudentData() {
    ensureStudentDataMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(bootStudentData, 400); });
  } else {
    setTimeout(bootStudentData, 400);
  }

  // Re-ensure after ACM scope applies (hides/shows sidebar links)
  var origApply = window.applyAcmAdminScope;
  if (typeof origApply === 'function' && !origApply.__sdPatched) {
    window.applyAcmAdminScope = function (user) {
      var r = origApply.apply(this, arguments);
      ensureStudentDataMenu();
      // Make sure Student Data nav is visible under ACM scope
      var nav = document.getElementById('adStudentDataNav');
      if (nav) nav.style.display = '';
      return r;
    };
    window.applyAcmAdminScope.__sdPatched = true;
  }

  window.ensureStudentDataMenu = ensureStudentDataMenu;
})();

