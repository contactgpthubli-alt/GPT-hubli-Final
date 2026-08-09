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
/**
 * Lazy-load heavy staff modules AFTER login so the login screen stays fast.
 * First paint only needs legacy-app + this bridge (~0.9MB → ~0.85MB still, but
 * exam/ops/analysis/tc/acm/print are deferred until authenticated).
 */
var GPT_PERF_V = "20260809demoStu"
var _gpthModsPromise = null
function gpthLoadScript(src) {
  return new Promise(function (resolve) {
    try {
      var base = String(src).split("?")[0]
      if (
        document.querySelector('script[data-gpth-mod="' + base + '"]') ||
        document.querySelector('script[src^="' + base + '"]')
      ) {
        resolve(true)
        return
      }
      var s = document.createElement("script")
      s.src = src
      s.async = false
      s.dataset.gpthMod = base
      s.onload = function () {
        resolve(true)
      }
      s.onerror = function () {
        console.warn("[perf] script failed", src)
        resolve(false)
      }
      ;(document.body || document.documentElement).appendChild(s)
    } catch (e) {
      resolve(false)
    }
  })
}
/** Load stamp → exam → ops → analysis, then secondary modules in parallel. */
function ensureStaffModules() {
  if (_gpthModsPromise) return _gpthModsPromise
  var v = GPT_PERF_V
  _gpthModsPromise = gpthLoadScript("/gpth-stamp.js?v=" + v)
    .then(function () {
      return gpthLoadScript("/legacy-exam.js?v=" + v)
    })
    .then(function () {
      return gpthLoadScript("/legacy-ops.js?v=" + v)
    })
    .then(function () {
      return gpthLoadScript("/legacy-result-analysis.js?v=" + v)
    })
    .then(function () {
      // Secondary — do not block UI
      gpthLoadScript("/gpth-print.js?v=" + v)
      gpthLoadScript("/legacy-tc.js?v=" + v)
      gpthLoadScript("/legacy-acm-study.js?v=" + v)
      return true
    })
    .catch(function (e) {
      console.warn("[perf] ensureStaffModules", e)
      return false
    })
  return _gpthModsPromise
}
window.ensureStaffModules = ensureStaffModules

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

    // Prefer live academic fields over stale static "CSE · 2nd Year" demo text
    var liveDept =
      (stu && (stu.dept || (stu.academic && stu.academic.dept))) ||
      user.branch ||
      '';
    var liveYear = '';
    if (stu) {
      if (stu.year_label) liveYear = String(stu.year_label);
      else if (stu.academic && stu.academic.year_label) liveYear = String(stu.academic.year_label);
      else if (stu.year) liveYear = String(stu.year);
      else if (stu.current_study_year === 1 || (stu.academic && stu.academic.current_study_year === 1)) liveYear = '1st Year';
      else if (stu.current_study_year === 2 || (stu.academic && stu.academic.current_study_year === 2)) liveYear = '2nd Year';
      else if (stu.current_study_year === 3 || (stu.academic && stu.academic.current_study_year === 3)) liveYear = '3rd Year';
    }
    // Short branch code for sidebar
    var shortBranch = liveDept;
    var dl = String(liveDept).toLowerCase();
    if (dl.indexOf('computer') >= 0) shortBranch = 'CSE';
    else if (dl.indexOf('civil') >= 0) shortBranch = 'Civil';
    else if (dl.indexOf('electron') >= 0) shortBranch = 'ECE';
    else if (dl.indexOf('mech') >= 0) shortBranch = 'ME';
    var sbRole = document.querySelector('#dbStudent .sb-role');
    if (sbRole) {
      sbRole.textContent =
        (shortBranch || 'Student') + (liveYear ? ' · ' + liveYear : '');
    }

    var metaParts = [];
    if (reg) metaParts.push(reg);
    if (liveDept) metaParts.push(liveDept);
    if (liveYear) metaParts.push(liveYear);
    metaParts.push(academicYearLabel());
    setText('stuWelcomeMeta', metaParts.length ? metaParts.join(' · ') : '—');

    // Profile page header (same real record — no hard-coded CSE / year)
    setText('stuProfileName', name);
    var profMeta = [];
    if (reg) profMeta.push(reg);
    if (liveDept) profMeta.push(liveDept);
    if (liveYear) profMeta.push(liveYear);
    setText('stuProfileMeta', profMeta.length ? profMeta.join(' · ') : '—');

    var cgpa = stu && stu.cgpa != null && String(stu.cgpa).trim() !== '' ? String(stu.cgpa) : null;
    // Live C-20 CGPA from verified/pending exam results (grade points × credits)
    try {
      var examCg = await apiReqQuiet('/api/exam/attempts');
      if (examCg && examCg.cgpa) {
        cgpa = String(examCg.cgpa);
        if (stu) stu.cgpa = cgpa;
      } else if (examCg && examCg.cgpa_detail) {
        var det = examCg.cgpa_detail.live || examCg.cgpa_detail.official;
        if (det && det.label) {
          cgpa = String(det.label);
          if (stu) stu.cgpa = cgpa;
        }
      }
    } catch (eCg) { /* ignore */ }
    setText('stuKpiCgpa', cgpa || '—');
    if (cgpa) {
      var cg = parseFloat(cgpa);
      setTrend(
        'stuKpiCgpaTrend',
        cg >= 7 ? '↑ Good Standing (C-20)' : cg >= 5 ? '→ Average (C-20)' : '↓ Needs attention (C-20)',
        cg >= 7 ? 'up' : cg >= 5 ? '' : 'dn',
      );
    } else {
      setTrend('stuKpiCgpaTrend', 'Enter results → live CGPA', '');
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

    // Fallback: average published SGPAs if no exam-attempt CGPA yet
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
   * Admin static HTML (legacy-body) still has old Year filter options and no Status filter.
   * Patch every student-db toolbar (adStu / priStu / facStu) to DTE filters.
   */
  function upgradeStudentDbFilters() {
    ;['adStu', 'priStu', 'facStu'].forEach(function (pfx) {
      var yearSel = document.getElementById(pfx + 'YearFilter');
      if (yearSel) {
        var prevY = yearSel.value || '';
        // Normalize old option values → new
        var mapOld = {
          '1st Year': '1',
          '2nd Year': '2',
          '3rd Year': '3',
          'YEAR BACK': 'year_back',
          Completed: 'alumni',
          Alumni: 'alumni',
        };
        if (mapOld[prevY]) prevY = mapOld[prevY];
        yearSel.innerHTML =
          '<option value="">All Study Years</option>' +
          '<option value="1">1st Year</option>' +
          '<option value="2">2nd Year</option>' +
          '<option value="3">3rd Year</option>' +
          '<option value="alumni">Alumni</option>';
        if (prevY === '1' || prevY === '2' || prevY === '3' || prevY === 'alumni') {
          yearSel.value = prevY;
        }
        yearSel.onchange = function () {
          if (typeof window.filterAdminStudentList === 'function') window.filterAdminStudentList();
        };
      }

      var statusSel = document.getElementById(pfx + 'StatusFilter');
      if (!statusSel && yearSel && yearSel.parentNode) {
        statusSel = document.createElement('select');
        statusSel.id = pfx + 'StatusFilter';
        statusSel.style.cssText =
          'padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:150px;';
        statusSel.innerHTML =
          '<option value="active_like">Active (default)</option>' +
          '<option value="active">Active only</option>' +
          '<option value="detained">Detained</option>' +
          '<option value="year_back">Year Back</option>' +
          '<option value="passed_out">Passed Out / Alumni</option>' +
          '<option value="all">All statuses</option>';
        statusSel.onchange = function () {
          if (typeof window.filterAdminStudentList === 'function') window.filterAdminStudentList();
        };
        // Insert after year filter
        if (yearSel.nextSibling) yearSel.parentNode.insertBefore(statusSel, yearSel.nextSibling);
        else yearSel.parentNode.appendChild(statusSel);
      }

      // Label admission filter as Batch
      var admSel = document.getElementById(pfx + 'AdmYearFilter');
      if (admSel && admSel.options && admSel.options[0] && /Adm/i.test(admSel.options[0].text || '')) {
        admSel.options[0].text = 'All Batches';
      }

      // Ensure Select All checkbox exists (HOD / Principal panels created before this fix)
      if (!document.getElementById(pfx + 'SelectAll')) {
        var tbody = document.getElementById(pfx + 'TableBody');
        var table = tbody && tbody.closest ? tbody.closest('table') : null;
        var firstTh = table && table.querySelector('thead tr th');
        if (firstTh && !firstTh.querySelector('input[type="checkbox"]')) {
          firstTh.innerHTML =
            '<input type="checkbox" id="' + pfx + 'SelectAll" class="stu-select-all-cb" title="Select all visible" />';
        }
      }
    });
  }
  window.upgradeStudentDbFilters = upgradeStudentDbFilters;

  /** Root Admin + Principal: set active academic year (DTE session) + apply progression */
  function ensureAcademicYearPanel() {
    function inject(shellSel, navId, panelId, showSecId, afterNavMatch) {
      var menu = document.querySelector(shellSel + ' .sb-menu');
      var content = document.querySelector(shellSel + ' .db-content');
      if (!menu || !content) return;
      if (!document.getElementById(navId)) {
        var insertAfter = null;
        menu.querySelectorAll('.sl').forEach(function (sl) {
          var oc = sl.getAttribute('onclick') || '';
          var id = sl.id || '';
          if (afterNavMatch(oc, id, sl)) insertAfter = sl;
        });
        var nav = document.createElement('div');
        nav.className = 'sl';
        nav.id = navId;
        nav.setAttribute('onclick', "showSec('" + showSecId + "',this)");
        nav.innerHTML = '<span class="sli">📅</span>Academic Year';
        if (insertAfter && insertAfter.nextSibling) {
          insertAfter.parentNode.insertBefore(nav, insertAfter.nextSibling);
        } else if (insertAfter) {
          insertAfter.parentNode.appendChild(nav);
        } else {
          menu.appendChild(nav);
        }
      }
      if (!document.getElementById(panelId)) {
        var panel = document.createElement('div');
        panel.id = panelId;
        panel.style.display = 'none';
        panel.innerHTML =
          '<div class="info-box">📅 <strong>Active Academic Year</strong> — DTE Karnataka session (e.g. 2026-27). ' +
          'Root Admin and Principal only. Changing the year and applying progression advances study years (1→2→3) and auto mark pass-out after 3rd year. Detained / Year Back students stay frozen.</div>' +
          '<div class="card" style="padding:18px;">' +
          '<div class="form-row">' +
          '<div class="fg"><label>Active Academic Year</label>' +
          '<input type="text" id="' + panelId + '_ay" placeholder="2026-27" style="max-width:200px;" /></div>' +
          '<div class="fg"><label>Start month (1–12)</label>' +
          '<input type="number" id="' + panelId + '_month" min="1" max="12" value="6" style="max-width:100px;" /></div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
          '<button class="btn pr" type="button" onclick="window.saveActiveAcademicYear&&window.saveActiveAcademicYear(\'' + panelId + '\',false)">💾 Save year only</button>' +
          '<button class="btn go" type="button" onclick="window.saveActiveAcademicYear&&window.saveActiveAcademicYear(\'' + panelId + '\',true)">▶ Save + Apply progression</button>' +
          '<button class="btn ol" type="button" onclick="window.applyAcademicProgressionOnly&&window.applyAcademicProgressionOnly()">↻ Recompute all (current year)</button>' +
          '</div>' +
          '<div id="' + panelId + '_status" style="margin-top:14px;font-size:0.85rem;color:var(--text-muted);"></div>' +
          '<div id="' + panelId + '_report" style="margin-top:12px;"></div>' +
          '</div>';
        content.appendChild(panel);
      }
    }
    inject('#dbAdmin', 'adAcademicYearNav', 'adAcademicYear', 'adAcademicYear', function (oc, id) {
      return oc.indexOf('adUserApprovals') !== -1 || id === 'adUserApprovalsNav' || oc.indexOf('adHome') !== -1;
    });
    inject('#dbPrincipal', 'priAcademicYearNav', 'priAcademicYear', 'priAcademicYear', function (oc, id) {
      return oc.indexOf('priUserApprovals') !== -1 || id === 'priUserApprovalsNav' || oc.indexOf('priHome') !== -1;
    });
    // Make sure nav is visible (not stuck display:none from other role switches)
    ;['adAcademicYearNav', 'priAcademicYearNav'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }
  window.ensureAcademicYearPanel = ensureAcademicYearPanel;

  window.loadAcademicYearPanel = async function loadAcademicYearPanel() {
    ensureAcademicYearPanel();
    try {
      var res = await fetch('/api/institute-settings?_ts=' + Date.now(), { credentials: 'same-origin' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.academic) return;
      window._academicSettings = data.academic;
      ;['adAcademicYear', 'priAcademicYear'].forEach(function (pid) {
        var panel = document.getElementById(pid);
        if (panel && !panel.getAttribute('data-sm-tip')) {
          panel.setAttribute('data-sm-tip', '1');
          var tip = document.createElement('div');
          tip.className = 'info-box';
          tip.style.cssText = 'background:#eff6ff;border-color:#93c5fd;margin-bottom:12px;';
          tip.innerHTML =
            '💡 Academic Year is also under the main <strong>Student Management</strong> hub → <strong>Academic year</strong> tab. Old menu kept for a while.';
          if (panel.firstChild) panel.insertBefore(tip, panel.firstChild);
          else panel.appendChild(tip);
        }
        var ay = document.getElementById(pid + '_ay');
        var mo = document.getElementById(pid + '_month');
        var st = document.getElementById(pid + '_status');
        if (ay) ay.value = data.academic.active_academic_year || '';
        if (mo) mo.value = data.academic.academic_year_start_month || 6;
        if (st) {
          st.textContent =
            'Current active year: ' +
            (data.academic.active_academic_year || '—') +
            (data.can_edit ? ' · You can edit' : ' · View only');
        }
      });
    } catch (e) {
      console.warn('[bridge] academic year load', e);
    }
  };

  window.saveActiveAcademicYear = async function saveActiveAcademicYear(panelId, apply) {
    var ayEl = document.getElementById(panelId + '_ay');
    var moEl = document.getElementById(panelId + '_month');
    var st = document.getElementById(panelId + '_status');
    var rep = document.getElementById(panelId + '_report');
    var ay = ayEl ? String(ayEl.value || '').trim() : '';
    if (!ay) {
      alert('Enter academic year e.g. 2026-27');
      return;
    }
    if (apply && !confirm('Save active year ' + ay + ' and recompute study year for ALL students?\nDetained / Year Back stay frozen. Eligible students auto-alumni after 3rd year.')) {
      return;
    }
    if (st) st.textContent = 'Saving…';
    try {
      var r = await fetch('/api/institute-settings', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          active_academic_year: ay,
          academic_year_start_month: moEl ? Number(moEl.value) || 6 : 6,
          apply_progression: !!apply,
        }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Save failed');
        if (st) st.textContent = data.error || 'Failed';
        return;
      }
      window._academicSettings = data.academic;
      if (st) st.textContent = 'Saved · Active AY ' + (data.academic && data.academic.active_academic_year);
      if (rep && data.progression) {
        var p = data.progression;
        rep.innerHTML =
          '<div class="info-box"><strong>Progression report</strong><br>' +
          'Total rows: ' + p.total +
          ' · Advanced: ' + p.advanced +
          ' · Auto alumni: ' + p.auto_alumni +
          ' · Locked (detain/year-back): ' + p.locked_skipped +
          ' · Missing admission year: ' + p.missing_admission_year +
          ' · Unchanged: ' + p.unchanged +
          '</div>';
      } else if (rep) {
        rep.innerHTML = '<div class="info-box">Academic year saved. Use “Save + Apply progression” to advance study years.</div>';
      }
      alert('Academic year saved' + (apply ? ' and progression applied.' : '.'));
    } catch (e) {
      alert('Network error');
    }
  };

  window.applyAcademicProgressionOnly = async function applyAcademicProgressionOnly() {
    if (!confirm('Recompute study years for all students against the current active academic year?')) return;
    try {
      var r = await fetch('/api/institute-settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'apply_progression' }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Failed');
        return;
      }
      var p = data.progression || {};
      alert(
        'Done.\nAdvanced: ' + (p.advanced || 0) +
        '\nAuto alumni: ' + (p.auto_alumni || 0) +
        '\nLocked skipped: ' + (p.locked_skipped || 0) +
        '\nMissing admission year: ' + (p.missing_admission_year || 0),
      );
      if (typeof window.loadAcademicYearPanel === 'function') window.loadAcademicYearPanel();
    } catch (e) {
      alert('Network error');
    }
  };

  /**
   * Principal + HOD desk: Approvals (profile), Students, Student Data
   * matching ACM/Admin three-item shell. HOD data is branch-scoped by API.
   */
  function studentDbPanelHtml(pfx, titleNote) {
    return '' +
      '<div class="info-box">' + (titleNote || 'Student Database') +
      ' Use <strong>Study Year</strong> + <strong>Status</strong> + <strong>Batch</strong> filters. Open <strong>View</strong> for Detain / Year Back / Pass-out.</div>' +
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
      '<option value="">All Study Years</option>' +
      '<option value="1">1st Year</option><option value="2">2nd Year</option>' +
      '<option value="3">3rd Year</option><option value="alumni">Alumni</option></select>' +
      '<select id="' + pfx + 'StatusFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:150px;">' +
      '<option value="active_like">Active (default)</option>' +
      '<option value="active">Active only</option>' +
      '<option value="detained">Detained</option>' +
      '<option value="year_back">Year Back</option>' +
      '<option value="passed_out">Passed Out / Alumni</option>' +
      '<option value="all">All statuses</option></select>' +
      '<select id="' + pfx + 'AdmYearFilter" onchange="window.filterAdminStudentList&&window.filterAdminStudentList()" ' +
      'style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.82rem;min-width:130px;">' +
      '<option value="">All Batches</option></select>' +
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
      '<th style="width:36px;"><input type="checkbox" id="' + pfx + 'SelectAll" class="stu-select-all-cb" title="Select all visible" /></th>' +
      '<th>Reg No</th><th>Name / Email</th><th>Branch</th><th>Year</th><th>Account</th><th>Profile</th>' +
      '<th title="Student raised profile edit request">Raised edit request</th><th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="' + pfx + 'TableBody"><tr><td colspan="9" style="text-align:center;padding:24px;opacity:.7;">Loading…</td></tr></tbody>' +
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
      // One Student Data menu only — prefer existing nav, remove any duplicate
      var existingSd = document.getElementById('facStudentDataNav') || document.getElementById('facStudentDataNavHod');
      if (existingSd && currentUser && currentUser.role === 'hod') {
        existingSd.style.display = '';
        existingSd.setAttribute('data-fac', 'studentdata');
        existingSd.setAttribute('onclick', "showSec('facStudentData',this)");
        existingSd.innerHTML = '<span class="sli">📊</span>Student Data';
      } else if (currentUser && currentUser.role === 'hod') {
        addFacNav('facStudentDataNav', 'facStudentData', 'studentdata', '📊', 'Student Data', 'students');
      }
      // Strip duplicates (same label / data-fac)
      var seenSd = false;
      facMenu.querySelectorAll('.sl').forEach(function (sl) {
        var lab = (sl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        var df = sl.getAttribute('data-fac') || '';
        if (df === 'studentdata' || lab === 'student data' || lab.indexOf('student data') >= 0) {
          if (seenSd) {
            if (sl.parentNode) sl.parentNode.removeChild(sl);
          } else {
            seenSd = true;
            sl.style.display = (currentUser && currentUser.role === 'hod') ? '' : sl.style.display;
          }
        }
      });
      // Print / Export — same ACM / Exam tool (branch pre-locked for HOD)
      addFacNav('facHodPrintNav', 'facHodPrint', 'printexport', '🖨️', 'Print / Export', 'studentdata');

      // Remove broken Student Key List leftovers
      ;['facStudentKeyNav', 'facStudentKeyHod', 'facSubjectKeyNav', 'facSubjectKeyHod'].forEach(function (id) {
        var dead = document.getElementById(id);
        if (dead && dead.parentNode) dead.parentNode.removeChild(dead);
      });

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
      if (!document.getElementById('facHodPrint')) {
        var hp = document.createElement('div');
        hp.id = 'facHodPrint';
        hp.style.display = 'none';
        hp.setAttribute('data-acm-root', '1');
        hp.setAttribute('data-hod-print', '1');
        // Reuse same print/export markup as Exam & ACM
        var printInner = examPrintPanelHtml('facHodPrintInner');
        // examPrintPanelHtml wraps in display:none; show the inner card always inside this section
        printInner = printInner.replace('style="display:none;"', 'style="display:block;"');
        hp.innerHTML =
          '<div class="info-box" style="margin-bottom:12px;">🖨️ <strong>Print / Export (your branch)</strong> — Same tool as Exam Cell &amp; ACM. ' +
          'Select <strong>Year</strong>, load students, tick columns, then <strong>Print</strong> or <strong>Export CSV</strong>. Branch is fixed to your department.</div>' +
          printInner;
        facContent.appendChild(hp);
      }
    }
  }
  window.ensurePrincipalHodDesk = ensurePrincipalHodDesk;

  /**
   * Desk staff profile (Principal / HOD / ACM / Exam).
   * Static seat accounts need "who is using this account" info:
   * Name, Qualification, Designation (required); Mobile, KGID, Home address (optional).
   */
  function ensureStaffDeskProfile(user) {
    if (!user) user = window.currentUser;
    if (!user) return;
    var role = user.role;
    if (['principal', 'hod', 'acm', 'exam'].indexOf(role) === -1) return;

    var shellId = role === 'principal' ? 'dbPrincipal' : (role === 'hod' ? 'dbFaculty' : 'dbAdmin');
    var root = document.getElementById(shellId);
    if (!root) return;

    var navId = 'staffDeskProfileNav_' + role;
    var secId = 'staffDeskProfileSec_' + role;
    var content = root.querySelector('.db-content') || root;

    // Sidebar link
    var nav = document.getElementById(navId);
    if (!nav) {
      nav = document.createElement('div');
      nav.id = navId;
      nav.className = 'sl';
      nav.setAttribute('data-staff-profile', '1');
      if (role === 'hod') nav.setAttribute('data-fac', 'staffprofile');
      nav.innerHTML = '<span class="sli">👤</span>My Profile';
      nav.onclick = function () {
        // Hide other panels in this shell
        content.querySelectorAll(':scope > div[id]').forEach(function (p) {
          if (p.id !== secId) p.style.display = 'none';
        });
        var panel = document.getElementById(secId);
        if (panel) panel.style.display = '';
        root.querySelectorAll('.sb .sl').forEach(function (sl) { sl.classList.remove('act'); });
        nav.classList.add('act');
        window.loadStaffDeskProfile && window.loadStaffDeskProfile();
      };
      var sb = root.querySelector('.sb');
      if (sb) {
        // Prefer insert before Logout
        var logout = null;
        sb.querySelectorAll('.sl').forEach(function (sl) {
          var t = (sl.textContent || '').toLowerCase();
          var oc = sl.getAttribute('onclick') || '';
          if (t.indexOf('logout') >= 0 || oc.indexOf('logout') >= 0) logout = sl;
        });
        if (logout) sb.insertBefore(nav, logout);
        else sb.appendChild(nav);
      }
    }
    nav.style.display = '';

    // For ACM/Exam scoped shells, allow this nav even when others are hidden
    if (role === 'acm' || role === 'exam') {
      nav.style.display = '';
    }

    var panel = document.getElementById(secId);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = secId;
      panel.style.display = 'none';
      panel.innerHTML =
        '<div class="page-title" style="margin-bottom:12px;">' +
        '<h2 style="margin:0;font-family:\'Libre Baskerville\',serif;color:var(--navy);">Staff Profile</h2>' +
        '<p style="margin:6px 0 0;font-size:0.85rem;opacity:.8;">Who is currently using this ' +
        (role === 'hod' ? 'HOD' : role === 'acm' ? 'ACM' : role === 'exam' ? 'Exam Cell' : 'Principal') +
        ' seat account. Transfers keep the login; update the person details here.</p></div>' +
        '<div class="card" style="padding:18px;max-width:640px;">' +
        '<div class="info-box" style="margin:0 0 14px;font-size:0.82rem;">' +
        '<strong>Required:</strong> Name, Qualification, Designation &nbsp;·&nbsp; <strong>Optional:</strong> Mobile, KGID, Home address' +
        '</div>' +
        '<div style="display:grid;gap:12px;">' +
        '<div class="fg" style="margin:0;"><label>Name of the staff *</label>' +
        '<input type="text" id="spf_name" class="pf-field" placeholder="Full name" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;" /></div>' +
        '<div class="fg" style="margin:0;"><label>Qualification *</label>' +
        '<input type="text" id="spf_qualification" class="pf-field" placeholder="e.g. B.E., M.Tech" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;" /></div>' +
        '<div class="fg" style="margin:0;"><label>Designation *</label>' +
        '<input type="text" id="spf_designation" class="pf-field" placeholder="e.g. HOD / Lecturer / ACM Officer" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;" /></div>' +
        '<div class="fg" style="margin:0;"><label>Mobile number <span style="opacity:.6;font-weight:400;">(optional)</span></label>' +
        '<input type="text" id="spf_mobile" class="pf-field" placeholder="10-digit mobile" maxlength="15" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;" /></div>' +
        '<div class="fg" style="margin:0;"><label>KGID number <span style="opacity:.6;font-weight:400;">(optional)</span></label>' +
        '<input type="text" id="spf_kgid" class="pf-field" placeholder="KGID" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;" /></div>' +
        '<div class="fg" style="margin:0;"><label>Home address <span style="opacity:.6;font-weight:400;">(optional)</span></label>' +
        '<textarea id="spf_address" class="pf-field" rows="3" placeholder="Residential address" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;resize:vertical;"></textarea></div>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px;">' +
        '<button type="button" class="btn go" id="spf_saveBtn">💾 Save profile</button>' +
        '<span id="spf_msg" style="font-size:0.82rem;"></span></div>' +
        '<p style="margin:12px 0 0;font-size:0.75rem;opacity:.65;">Seat login stays the same. Only the person occupying this desk changes.</p>' +
        '</div>';
      content.appendChild(panel);
      var saveBtn = panel.querySelector('#spf_saveBtn');
      if (saveBtn) {
        saveBtn.onclick = function () { window.saveStaffDeskProfile && window.saveStaffDeskProfile(); };
      }
    }

    // Patch ACM/Exam allow-list so Profile nav is not hidden
    if (role === 'acm' || role === 'exam') {
      nav.style.display = '';
    }
  }
  window.ensureStaffDeskProfile = ensureStaffDeskProfile;

  window.loadStaffDeskProfile = async function loadStaffDeskProfile() {
    var msg = document.getElementById('spf_msg');
    function setMsg(t, err) {
      if (!msg) return;
      msg.textContent = t || '';
      msg.style.color = err ? '#991b1b' : '#065f46';
    }
    setMsg('Loading…', false);
    try {
      var r = await fetch('/api/auth/staff-profile?_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok || !data || !data.profile) {
        setMsg((data && data.error) || 'Failed to load profile', true);
        return;
      }
      var p = data.profile;
      var nameEl = document.getElementById('spf_name');
      var qEl = document.getElementById('spf_qualification');
      var dEl = document.getElementById('spf_designation');
      var mEl = document.getElementById('spf_mobile');
      var kEl = document.getElementById('spf_kgid');
      var aEl = document.getElementById('spf_address');
      if (nameEl) nameEl.value = p.display_name || '';
      if (qEl) qEl.value = p.qualification || '';
      if (dEl) dEl.value = p.designation || '';
      if (mEl) mEl.value = p.mobile || '';
      if (kEl) kEl.value = p.kgid || '';
      if (aEl) aEl.value = p.home_address || '';
      setMsg('', false);
    } catch (e) {
      setMsg('Network error', true);
    }
  };

  window.saveStaffDeskProfile = async function saveStaffDeskProfile() {
    var msg = document.getElementById('spf_msg');
    function setMsg(t, err) {
      if (!msg) return;
      msg.textContent = t || '';
      msg.style.color = err ? '#991b1b' : '#065f46';
    }
    var body = {
      display_name: (document.getElementById('spf_name') || {}).value || '',
      qualification: (document.getElementById('spf_qualification') || {}).value || '',
      designation: (document.getElementById('spf_designation') || {}).value || '',
      mobile: (document.getElementById('spf_mobile') || {}).value || '',
      kgid: (document.getElementById('spf_kgid') || {}).value || '',
      home_address: (document.getElementById('spf_address') || {}).value || '',
    };
    body.display_name = String(body.display_name).trim();
    body.qualification = String(body.qualification).trim();
    body.designation = String(body.designation).trim();
    if (!body.display_name || !body.qualification || !body.designation) {
      setMsg('Name, Qualification and Designation are required.', true);
      return;
    }
    setMsg('Saving…', false);
    try {
      var r = await fetch('/api/auth/staff-profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        setMsg(data.error || 'Save failed', true);
        return;
      }
      // Refresh header name chips
      if (data.profile && window.currentUser) {
        window.currentUser.display_name = data.profile.display_name;
        document.querySelectorAll('.db-uname').forEach(function (el) {
          // Only update the active shell chips that belong to this session
          if (el.offsetParent !== null || el.closest('#dbAdmin, #dbFaculty, #dbPrincipal')) {
            el.textContent = data.profile.display_name;
          }
        });
        document.querySelectorAll('#adAva, #facAva, #priAva').forEach(function (ava) {
          if (ava && !ava.querySelector('img')) {
            var n = data.profile.display_name || '';
            var parts = n.trim().split(/\s+/);
            ava.textContent = parts.length >= 2
              ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
              : n.slice(0, 2).toUpperCase();
          }
        });
      }
      setMsg('Profile saved.', false);
    } catch (e) {
      setMsg('Network error', true);
    }
  };

  /**
   * Hide Teaching Staff Profile (facMyProfile), Student Profile (branch tabs),
   * and OTHER clutter from HOD. Staff / Activities are faculty modules —
   * Student Data / Students desks already cover HOD needs.
   */
  function hideHodTeachingStaffProfile() {
    ;['myprofile', 'stuprofile', 'staff', 'activities'].forEach(function (key) {
      document.querySelectorAll('#dbFaculty [data-fac="' + key + '"]').forEach(function (el) {
        el.style.display = 'none';
      });
    });
    ;['facMyProfile', 'facStuProfile', 'facStaff', 'facActivities'].forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) sec.style.display = 'none';
    });
    document.querySelectorAll(
      '#dbFaculty .sl[data-fac="myprofile"], #dbFaculty .sl[data-fac="stuprofile"], #dbFaculty .sl[data-fac="staff"], #dbFaculty .sl[data-fac="activities"]'
    ).forEach(function (sl) {
      sl.classList.remove('act');
    });
    // Hide "Other" section header if no other items remain visible under it
    document.querySelectorAll('#dbFaculty [data-fac-sec="other"]').forEach(function (hdr) {
      var keys = ['staff', 'activities', 'placement', 'nss', 'yrc', 'alumni', 'sports', 'welfare', 'studentassoc', 'gallery'];
      var any = keys.some(function (k) {
        var el = document.querySelector('#dbFaculty [data-fac="' + k + '"]');
        return el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
      });
      hdr.style.display = any ? '' : 'none';
    });
    // Hide empty "Student" section header if no student-section items remain
    document.querySelectorAll('#dbFaculty [data-fac-sec="student"]').forEach(function (hdr) {
      var keys = ['stuprofile', 'attendance', 'timetable', 'results'];
      var any = keys.some(function (k) {
        var el = document.querySelector('#dbFaculty [data-fac="' + k + '"]');
        return el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
      });
      hdr.style.display = any ? '' : 'none';
    });
    // If currently stuck on a hidden panel, open Students or home
    var active = document.querySelector('#dbFaculty .db-content > div[id]:not([style*="display: none"]):not([style*="display:none"])');
    if (
      !active ||
      active.id === 'facMyProfile' ||
      active.id === 'facStuProfile' ||
      active.id === 'facStaff' ||
      active.id === 'facActivities'
    ) {
      var prefer = document.querySelector(
        '#dbFaculty .sl[data-fac="students"], #dbFaculty .sl[data-fac="studentdata"], #dbFaculty .sl[data-fac="home"]'
      );
      if (prefer && typeof window.showSec === 'function') {
        try {
          var oc = prefer.getAttribute('onclick') || '';
          var m = oc.match(/showSec\('([^']+)'/);
          if (m) window.showSec(m[1], prefer);
          else prefer.click();
        } catch (e) { /* ignore */ }
      }
    }
  }
  window.hideHodTeachingStaffProfile = hideHodTeachingStaffProfile;

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
      '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
      '<thead style="position:sticky;top:0;background:var(--surface);z-index:1;"><tr>' +
      '<th style="padding:10px 8px;text-align:left;">Reg. No</th>' +
      '<th style="padding:10px 8px;text-align:left;">Name of the student</th>' +
      '<th style="padding:10px 8px;text-align:left;">Father name</th>' +
      '<th style="padding:10px 8px;text-align:left;">Branch</th>' +
      '<th style="padding:10px 8px;text-align:left;width:90px;">View</th>' +
      '</tr></thead>' +
      '<tbody id="' + p + '_tbody"><tr><td colspan="5" style="padding:24px;text-align:center;opacity:.7;">Open this menu to load students.</td></tr></tbody>' +
      '</table></div></div>' +
      '<div id="' + p + '_modal" class="sd-view-modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99990;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;" ' +
      'onclick="if(event.target===this){window.closeStudentDataView&&window.closeStudentDataView();}">' +
      '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;" onclick="event.stopPropagation();">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:#fff;z-index:1;flex-shrink:0;">' +
      '<h3 style="margin:0;font-size:1.05rem;color:var(--navy);">Student Profile</h3>' +
      '<button type="button" class="btn ol sd-modal-close" style="min-width:44px;min-height:40px;font-weight:700;" ' +
      'onclick="window.closeStudentDataView&&window.closeStudentDataView();return false;">✕ Close</button>' +
      '</div><div id="' + p + '_modalBody" style="padding:16px 18px 20px;"></div></div></div>';
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

    function approvalRecordHtml(a) {
      if (window.gpthStamp) {
        if (a.status === 'approved' && (a.approved_by_name || a.approved_at)) {
          return (
            '<div style="margin-top:6px;">' +
            window.gpthStamp.html(
              {
                action: 'approved',
                by_name: a.approved_by_name,
                by_role: a.approved_by_role,
                at: a.approved_at,
              },
              'approved',
            ) +
            '</div>'
          );
        }
        if (a.status === 'rejected' && (a.rejected_by_name || a.rejected_at)) {
          return (
            '<div style="margin-top:6px;">' +
            window.gpthStamp.html(
              {
                action: 'rejected',
                by_name: a.rejected_by_name || a.approved_by_name,
                by_role: a.rejected_by_role || a.approved_by_role,
                at: a.rejected_at || a.approved_at,
              },
              'rejected',
            ) +
            '</div>'
          );
        }
        return '';
      }
      if (a.status === 'approved' && (a.approved_by_name || a.approved_at)) {
        var who = a.approved_by_name
          ? esc(a.approved_by_name) + (a.approved_by_role ? ' <span style="opacity:.75;">(' + esc(a.approved_by_role) + ')</span>' : '')
          : '—';
        var when = a.approved_at
          ? new Date(a.approved_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';
        return '<div style="font-size:0.68rem;margin-top:4px;line-height:1.35;color:#166534;">' +
          'Approved by <strong>' + who + '</strong>' +
          (when ? '<br><span style="opacity:.8;">' + when + '</span>' : '') +
          '</div>';
      }
      if (a.status === 'rejected' && (a.rejected_by_name || a.rejected_at)) {
        var rwho = a.rejected_by_name
          ? esc(a.rejected_by_name) + (a.rejected_by_role ? ' <span style="opacity:.75;">(' + esc(a.rejected_by_role) + ')</span>' : '')
          : '—';
        var rwhen = a.rejected_at
          ? new Date(a.rejected_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';
        return '<div style="font-size:0.68rem;margin-top:4px;line-height:1.35;color:#991b1b;">' +
          'Rejected by <strong>' + rwho + '</strong>' +
          (rwhen ? '<br><span style="opacity:.8;">' + rwhen + '</span>' : '') +
          '</div>';
      }
      return '';
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
        '<div style="font-size:0.68rem;opacity:.7;">' + esc(a.email) + '</div>' +
        approvalRecordHtml(a) +
        '</td>' +
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
      ? ('<div class="acc-bulk-bar" data-bulk-scope="active" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px 12px;background:#fef2f2;border-radius:8px;border:1.5px solid #fecaca;">' +
        '<label style="font-size:0.82rem;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;">' +
        '<input type="checkbox" class="acc-select-all-cb" data-bulk-scope="active" style="width:16px;height:16px;" /> Select all</label>' +
        '<button type="button" class="btn re acc-bulk-delete-btn" style="padding:8px 14px;font-weight:700;">🗑 Delete selected</button>' +
        '<button type="button" class="btn re acc-bulk-demo-btn" style="padding:8px 14px;font-weight:700;">🗑 Delete all DEMO</button>' +
        '<span class="acc-selected-count" data-bulk-scope="active" style="font-size:0.8rem;font-weight:700;color:#991b1b;">0 selected</span>' +
        '<span style="font-size:0.72rem;opacity:.75;">Checked rows → Trash (can Restore later)</span>' +
        '</div>')
      : '';

    // Bulk bar for Deleted Accounts (Trash)
    var trashBulkBar = isFullAdmin
      ? ('<div class="acc-bulk-bar acc-trash-bulk-bar" data-bulk-scope="trash" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:10px 12px;background:#fff7ed;border-radius:8px;border:1.5px solid #fdba74;">' +
        '<label style="font-size:0.82rem;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;color:#9a3412;">' +
        '<input type="checkbox" class="acc-select-all-cb" data-bulk-scope="trash" style="width:16px;height:16px;" /> Select all trash</label>' +
        '<button type="button" class="btn gr acc-bulk-restore-btn" style="padding:8px 14px;font-weight:700;">↩ Restore selected</button>' +
        '<button type="button" class="btn re acc-bulk-purge-btn" style="padding:8px 14px;font-weight:700;">☠ Purge selected</button>' +
        '<span class="acc-selected-count" data-bulk-scope="trash" style="font-size:0.8rem;font-weight:700;color:#9a3412;">0 selected</span>' +
        '<span style="font-size:0.72rem;opacity:.8;">Purge permanently removes accounts (cannot undo)</span>' +
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
        '<p style="font-size:0.78rem;opacity:.8;margin:0 0 10px;">Accidentally deleted? Use <strong>Restore</strong> or bulk <strong>Restore selected</strong>. ' +
        '<strong>Purge</strong> permanently removes the account.</p>' +
        trashBulkBar +
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

  window.getSelectedTrashIds = function () {
    var root = document.getElementById('bridgeAccountApprovals') ||
      document.getElementById('bridgeUserManagement') || document;
    var ids = [];
    var seen = {};
    root.querySelectorAll('.acc-select-cb:checked').forEach(function (cb) {
      if (cb.getAttribute('data-mode') !== 'trash') return;
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
      // Keep principal / HOD shells free of static demo rows when opening sections
      if (currentUser && (currentUser.role === 'principal' || currentUser.role === 'hod' ||
          currentUser.role === 'faculty' || currentUser.role === 'teaching')) {
        try { stripDummyDashboards(currentUser); } catch (e) { /* ignore */ }
      }
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
      // Results Management — force open + live data (fixes blank page for HOD)
      if (secId === 'facResults' || secId === 'facResModule') {
        try {
          if (typeof window.ensureFacResultsPanel === 'function') window.ensureFacResultsPanel();
          if (typeof window.reloadFacResults === 'function') window.reloadFacResults();
          else if (typeof window.facFilterResults === 'function') window.facFilterResults();
        } catch (eRes) { console.warn('[bridge] facResults open', eRes); }
      }
      // HOD Print / Export (same ACM/Exam tool)
      if (secId === 'facHodPrint') {
        try {
          if (typeof window.acmPrintInitFields === 'function') window.acmPrintInitFields();
          if (typeof window.prepareHodPrintPanel === 'function') window.prepareHodPrintPanel();
        } catch (eHodPr) { /* ignore */ }
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
      // Exam Cell desk
      if (
        (secId === 'adExam' ||
          secId === 'adExamFee' ||
          secId === 'adResultVerify' ||
          secId === 'facExamModule') &&
        typeof window.renderExamModule === 'function'
      ) {
        try { ensureExamAdminDesk(); } catch (e) { /* ignore */ }
        window.renderExamModule();
      }
      // Attendance Management (HOD / faculty) — live roster + branch lock
      if (secId === 'facAttendance' && typeof window.setupAttendancePanel === 'function') {
        window.setupAttendancePanel();
      }
      // Timetable upload (staff) + student view — live, branch-scoped
      if (secId === 'facTimetable' && typeof window.setupTimetableUploadPanel === 'function') {
        window.setupTimetableUploadPanel();
      }
      if (secId === 'stuTimetable' && typeof window.setupStudentTimetablePanel === 'function') {
        window.setupStudentTimetablePanel();
      }
      // Ensure student sidebar has Time Table entry (was missing from shell menu)
      if (currentUser && currentUser.role === 'student') {
        try { ensureStudentTimetableMenu(); } catch (e) { /* ignore */ }
      }
      // Academic year control (admin / principal)
      if ((secId === 'adAcademicYear' || secId === 'priAcademicYear') &&
          typeof window.loadAcademicYearPanel === 'function') {
        window.loadAcademicYearPanel();
      }
      // Student Certificates — prefill reg + load live My Requests status
      if (secId === 'stuCerts' && currentUser && currentUser.role === 'student') {
        if (typeof window.prefillStudentCertForms === 'function') window.prefillStudentCertForms();
        renderStuCertRequests();
        startStuCertPolling();
      }
      // Live form builder / student submit / verifier inbox
      if ((secId === 'adForms' || secId === 'facForms') && typeof window.renderLiveFormManager === 'function') {
        window.renderLiveFormManager();
      }
      if (secId === 'stuForms' && typeof window.renderStudentFormsPanel === 'function') {
        window.renderStudentFormsPanel();
      }
      if ((secId === 'facACM' || secId === 'adACM' || secId === 'facFormVerify' || secId === 'adFormVerify') &&
          typeof window.renderFormVerifyInbox === 'function') {
        window.renderFormVerifyInbox();
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

  /** Restore full Root Admin sidebar after ACM / Exam scoped session. */
  function clearAcmAdminScope() {
    if (!window._acmScopedAdmin && !window._examScopedAdmin) return;
    window._acmScopedAdmin = false;
    window._examScopedAdmin = false;
    if (window._acmScopeTimers) {
      window._acmScopeTimers.forEach(function (t) { clearTimeout(t); });
      window._acmScopeTimers = [];
    }
    if (window._examScopeTimers) {
      window._examScopeTimers.forEach(function (t) { clearTimeout(t); });
      window._examScopeTimers = [];
    }
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
  function paintAcmAdminMenu(user) {
    var root = document.getElementById('dbAdmin');
    if (!root || !window._acmScopedAdmin) return;
    // ACM: Approvals + Students + Student Data + ACM + Student Management hub (write like HOD).
    // Hide separate Live Academic / Branch Transfer top-level (inside SM hub tabs).
    var allowedSecs = {
      adApprovals: 1,
      adStudents: 1,
      adStudentData: 1,
      adACM: 1,
      adOpsCategory: 1,
    };
    root.querySelectorAll('.sb .sl').forEach(function (sl) {
      var oc = sl.getAttribute('onclick') || '';
      var id = sl.id || '';
      var keep = false;
      if (oc.indexOf('logout') !== -1) keep = true;
      if (sl.getAttribute('data-staff-profile') === '1') keep = true;
      Object.keys(allowedSecs).forEach(function (sec) {
        if (oc.indexOf("'" + sec + "'") !== -1 || oc.indexOf('"' + sec + '"') !== -1) keep = true;
      });
      if (id === 'adOpsCatNav') keep = true;
      if (id === 'adOpsLiveNav' || id === 'adOpsXferNav') keep = false;
      if (oc.indexOf('adOpsLive') !== -1 || oc.indexOf('adOpsTransfer') !== -1) keep = false;
      if (oc.indexOf('adExam') !== -1) keep = false;
      if (oc.indexOf('adAcademicYear') !== -1) keep = false;
      sl.style.display = keep ? '' : 'none';
    });
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
  }

  function applyAcmAdminScope(user) {
    var root = document.getElementById('dbAdmin');
    if (!root) return;
    window._acmScopedAdmin = true;
    window._examScopedAdmin = false;
    try { updateViewingAsBadge(user || window.currentUser); } catch (e) { /* ignore */ }
    try { ensureStaffDeskProfile(user || window.currentUser); } catch (e) { /* ignore */ }

    paintAcmAdminMenu(user || window.currentUser);

    if (!window._acmScopeTimers) window._acmScopeTimers = [];
    window._acmScopeTimers.forEach(function (t) { clearTimeout(t); });
    window._acmScopeTimers = [80, 300, 800, 2000, 5000].map(function (ms) {
      return setTimeout(function () {
        if (!window._acmScopedAdmin) return;
        paintAcmAdminMenu(window.currentUser || user);
      }, ms);
    });

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
    console.log('[bridge] ACM scoped admin shell active (Approvals + Students + ACM + Student Management)');
  }
  window.paintAcmAdminMenu = paintAcmAdminMenu;
  window.applyAcmAdminScope = applyAcmAdminScope;
  window.clearAcmAdminScope = clearAcmAdminScope;

  /** Official branches for Exam print / filters */
  function examOfficialBranches() {
    return (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
        'Civil Engineering',
        'Computer Science and Engineering',
        'Electronics and Communication Engineering',
        'Mechanical Engineering',
      ];
  }

  function examPrintPanelHtml(panelId) {
    var opts = examOfficialBranches().map(function (b) {
      return '<option value="' + String(b).replace(/"/g, '&quot;') + '">' + b + '</option>';
    }).join('');
    return '' +
      '<div id="' + panelId + '" style="display:none;">' +
      '<div class="card">' +
      '<div class="card-hd"><h3>🖨️ Print / Export Student Data</h3></div>' +
      '<div style="padding:18px;">' +
      '<div class="info-box" style="margin-bottom:14px;">Select <strong>Branch</strong> + <strong>Year</strong>, load students, tick columns, then Print or Export CSV.</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end;margin-bottom:12px;">' +
      '<div class="fg" style="margin:0;"><label>Branch</label>' +
      '<select data-acm-print-branch="1" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;">' +
      '<option value="">— Select —</option>' + opts + '</select></div>' +
      '<div class="fg" style="margin:0;"><label>Year (Roman)</label>' +
      '<select data-acm-print-year="1" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;">' +
      '<option value="">— Select —</option>' +
      '<option value="I">I</option><option value="II">II</option><option value="III">III</option>' +
      '</select></div>' +
      '<div class="fg" style="margin:0;"><label>Admission Year (optional)</label>' +
      '<select data-acm-print-adm-year="1" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;">' +
      '<option value="">All Adm. Years</option></select></div>' +
      '<div><button type="button" class="btn pr" onclick="window.acmPrintLoadClass&&window.acmPrintLoadClass()">Load Students</button></div>' +
      '</div>' +
      '<div data-acm-print-class-meta="1" style="font-size:0.82rem;opacity:.85;margin-bottom:10px;">Choose Branch + Year, then Load Students.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<button type="button" class="btn ol" onclick="window.acmPrintSelectAll&&window.acmPrintSelectAll(true)">Select all fields</button>' +
      '<button type="button" class="btn ol" onclick="window.acmPrintSelectAll&&window.acmPrintSelectAll(false)">Clear fields</button>' +
      '<button type="button" class="btn ol" onclick="window.acmPrintSelectCommon&&window.acmPrintSelectCommon()">Common fields</button>' +
      '<button type="button" class="btn pr" onclick="window.acmPrintDirect&&window.acmPrintDirect()">🖨️ Print</button>' +
      '<button type="button" class="btn go" onclick="window.acmExportExcel&&window.acmExportExcel()">⬇ Export CSV</button>' +
      '</div>' +
      '<div data-acm-print-fields="1" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 12px;max-height:180px;overflow:auto;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;background:var(--bg);"></div>' +
      '<div data-acm-print-preview="1" style="overflow:auto;max-height:360px;border:1px solid var(--border);border-radius:8px;padding:10px;background:#fff;">' +
      '<span style="opacity:.65;">Preview appears after Load Students.</span></div>' +
      '</div></div></div>';
  }

  function examModuleMarkup(prefix) {
    // prefix: 'ad' → admin shell panel ids; 'fac' reuses existing facExamModule tabs + adds lookup/print
    var pdcId = prefix === 'ad' ? 'adExPDC' : 'facExPDC';
    var lookupId = prefix === 'ad' ? 'adExLookup' : 'facExLookup';
    var printId = prefix === 'ad' ? 'adExamPrint' : 'facExamPrint';
    var tabFn = prefix === 'ad' ? 'showAdExamTab' : 'showFacExamTab';
    var html = '';
    if (prefix === 'ad') {
      html +=
        '<div class="info-box" style="margin-bottom:14px;">📚 <strong>Exam Cell</strong> — Same desk tools as ACM (Approvals, Students, Student Data) plus Exam Module. ' +
        'PDC requests, student lookup, and class print/export. <em>No ACM certificate module.</em></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px;">' +
        '<div class="card" style="padding:12px 14px;"><div style="font-size:0.68rem;opacity:.7;font-weight:700;">PDC PENDING</div>' +
        '<div data-exam-kpi="pending" style="font-size:1.4rem;font-weight:800;color:#be185d;">0</div></div>' +
        '<div class="card" style="padding:12px 14px;"><div style="font-size:0.68rem;opacity:.7;font-weight:700;">READY</div>' +
        '<div data-exam-kpi="ready" style="font-size:1.4rem;font-weight:800;color:#065f46;">0</div></div>' +
        '<div class="card" style="padding:12px 14px;"><div style="font-size:0.68rem;opacity:.7;font-weight:700;">TOTAL EXAM REQS</div>' +
        '<div data-exam-kpi="total" style="font-size:1.4rem;font-weight:800;color:#1a4fa0;">0</div></div>' +
        '</div>' +
        '<div class="tabs" style="margin-bottom:14px;">' +
        '<button class="tab act" type="button" onclick="' + tabFn + '(\'' + pdcId + '\',this)">🎓 PDC Requests</button>' +
        '<button class="tab" type="button" onclick="' + tabFn + '(\'' + lookupId + '\',this)">🔍 Student Lookup</button>' +
        '<button class="tab" type="button" onclick="' + tabFn + '(\'' + printId + '\',this)">🖨️ Print / Export</button>' +
        '<button class="tab" type="button" onclick="' + tabFn + '(\'adExKeylist\',this)">🗝️ Keylist</button>' +
        '<button class="tab" type="button" onclick="' + tabFn + '(\'adExNotEligible\',this)">🚫 Not Eligible</button>' +
        '<button class="tab" type="button" onclick="' + tabFn + '(\'adExAttShort\',this)">⚠️ Att. Shortage</button>' +
        '</div>' +
        '<div id="' + pdcId + '">' +
        '<div class="card" style="border-left:4px solid #be185d;">' +
        '<div class="card-hd"><h3>📥 Student PDC / Exam Certificate Requests</h3>' +
        '<div class="card-acts"><span class="badge pending" data-exam-badge="1">0 Pending</span>' +
        '<button class="btn ol" type="button" onclick="window.renderExamModule&&window.renderExamModule()">↻ Refresh</button></div></div>' +
        '<div style="overflow-x:auto;"><table><thead><tr>' +
        '<th>Req. ID</th><th>Student</th><th>Reg. No.</th><th>Branch</th><th>Type</th><th>Submitted</th><th>Status</th><th>Action</th>' +
        '</tr></thead><tbody data-exam-tbody="1">' +
        '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">Loading…</td></tr>' +
        '</tbody></table></div></div></div>';
    }
    html +=
      '<div id="' + lookupId + '" style="display:none;">' +
      '<div class="card"><div class="card-hd"><h3>🔍 Student Lookup</h3></div>' +
      '<div style="padding:18px;">' +
      '<div class="fg"><label>Register Number / Name / Branch</label>' +
      '<input type="text" data-exam-lookup-q="1" placeholder="Search student…" ' +
      'oninput="window.examStudentLookup&&window.examStudentLookup()" ' +
      'style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:0.9rem;" /></div>' +
      '<div data-exam-lookup-result="1" style="margin-top:12px;"></div>' +
      '</div></div></div>';
    html += examPrintPanelHtml(printId);
    if (prefix === 'ad') {
      html +=
        '<div id="adExKeylist" style="display:none;">' +
        '<div class="info-box">🗝️ <strong>Keylist</strong> — Upload or manage answer key lists for exam subjects.</div>' +
        '<div class="card" style="padding:22px;"><p style="opacity:.75;margin:0;">Upload keylists here (PDF/image). Live storage can be connected later.</p>' +
        '<div class="fg" style="margin-top:12px;"><label>Upload Keylist</label>' +
        '<input type="file" accept=".pdf,.jpg,.png" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;width:100%;" /></div>' +
        '<button class="btn pr" type="button" onclick="alert(\'Keylist upload recorded for Exam Cell.\')">📤 Upload Keylist</button></div></div>' +
        '<div id="adExNotEligible" style="display:none;">' +
        '<div class="info-box">🚫 <strong>Not Eligible</strong> — Students below attendance criteria. Use Student Lookup / Print to extract lists.</div>' +
        '<div class="card" style="padding:18px;"><p style="opacity:.75;margin:0 0 10px;">Use <strong>Print / Export</strong> with Branch + Year, then filter in Excel; or Student Lookup for individual checks.</p>' +
        '<button class="btn pr" type="button" onclick="window.showAdExamTab&&window.showAdExamTab(\'adExamPrint\',null)">Open Print / Export →</button></div></div>' +
        '<div id="adExAttShort" style="display:none;">' +
        '<div class="info-box">⚠️ <strong>Attendance Shortage</strong> — Generate shortage lists via Print / Export or upload official format.</div>' +
        '<div class="card" style="padding:18px;"><div class="fg"><label>Upload Shortage Format (PDF/DOCX)</label>' +
        '<input type="file" accept=".pdf,.docx" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;width:100%;" /></div>' +
        '<button class="btn go" type="button" onclick="alert(\'Attendance shortage format saved for Exam Cell.\')">📤 Upload Format</button></div></div>';
    }
    return html;
  }

  function ensureExamAdminDesk() {
    var menu = document.querySelector('#dbAdmin .sb-menu');
    var content = document.querySelector('#dbAdmin .db-content');
    if (!menu || !content) return;

    if (!document.getElementById('adExamNav')) {
      var after = null;
      menu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('adStudentData') !== -1 || oc.indexOf('adStudents') !== -1) after = sl;
        if (oc.indexOf('adACM') !== -1) after = sl;
      });
      var nav = document.createElement('div');
      nav.className = 'sl';
      nav.id = 'adExamNav';
      nav.setAttribute('onclick', "showSec('adExam',this)");
      nav.innerHTML = '<span class="sli">📚</span>Exam Module';
      if (after && after.nextSibling) after.parentNode.insertBefore(nav, after.nextSibling);
      else if (after) after.parentNode.appendChild(nav);
      else menu.appendChild(nav);
    }

    // Exam Fee menu (fee verification only — separate from Exam Module)
    if (!document.getElementById('adExamFeeNav')) {
      var afterExam = document.getElementById('adExamNav');
      var feeNav = document.createElement('div');
      feeNav.className = 'sl';
      feeNav.id = 'adExamFeeNav';
      feeNav.setAttribute('onclick', "showSec('adExamFee',this)");
      feeNav.innerHTML = '<span class="sli">💳</span>Exam Fee';
      if (afterExam && afterExam.nextSibling) afterExam.parentNode.insertBefore(feeNav, afterExam.nextSibling);
      else if (afterExam) afterExam.parentNode.appendChild(feeNav);
      else menu.appendChild(feeNav);
    }

    // Result Verification menu (results verify + analysis)
    if (!document.getElementById('adResultVerifyNav')) {
      var afterFee = document.getElementById('adExamFeeNav') || document.getElementById('adExamNav');
      var rvNav = document.createElement('div');
      rvNav.className = 'sl';
      rvNav.id = 'adResultVerifyNav';
      rvNav.setAttribute('onclick', "showSec('adResultVerify',this)");
      rvNav.innerHTML = '<span class="sli">✅</span>Result Verification';
      if (afterFee && afterFee.nextSibling) afterFee.parentNode.insertBefore(rvNav, afterFee.nextSibling);
      else if (afterFee) afterFee.parentNode.appendChild(rvNav);
      else menu.appendChild(rvNav);
    }

    if (!document.getElementById('adExam')) {
      var panel = document.createElement('div');
      panel.id = 'adExam';
      panel.style.display = 'none';
      panel.setAttribute('data-exam-root', '1');
      panel.innerHTML = examModuleMarkup('ad');
      content.appendChild(panel);
    }

    if (!document.getElementById('adExamFee')) {
      var feePanel = document.createElement('div');
      feePanel.id = 'adExamFee';
      feePanel.style.display = 'none';
      feePanel.setAttribute('data-exam-fee-root', '1');
      feePanel.innerHTML =
        '<div class="info-box" style="margin-bottom:12px;"><strong>Exam Fee</strong> — Verify student K2 fee payments. ' +
        '<strong>Regular exam fee verification</strong> and <strong>Makeup exam fee verification</strong> are separate. ' +
        'Declare cycles and fine schedules live here too.</div>';
      content.appendChild(feePanel);
    }

    if (!document.getElementById('adResultVerify')) {
      var rvPanel = document.createElement('div');
      rvPanel.id = 'adResultVerify';
      rvPanel.style.display = 'none';
      rvPanel.setAttribute('data-result-verify-root', '1');
      rvPanel.innerHTML =
        '<div class="info-box" style="margin-bottom:12px;"><strong>Result Verification</strong> — Verify student-uploaded regular and makeup results. ' +
        'Result Analysis is also here.</div>';
      content.appendChild(rvPanel);
    }

    // Enhance faculty Exam Module with Lookup + Print if missing
    var fac = document.getElementById('facExamModule');
    if (fac && !document.getElementById('facExLookup')) {
      var tabs = fac.querySelector('.tabs');
      if (tabs) {
        var b1 = document.createElement('button');
        b1.className = 'tab';
        b1.type = 'button';
        b1.setAttribute('onclick', "showFacExamTab('facExLookup',this)");
        b1.textContent = '🔍 Student Lookup';
        tabs.appendChild(b1);
        var b2 = document.createElement('button');
        b2.className = 'tab';
        b2.type = 'button';
        b2.setAttribute('onclick', "showFacExamTab('facExamPrint',this)");
        b2.textContent = '🖨️ Print / Export';
        tabs.appendChild(b2);
      }
      var wrap = document.createElement('div');
      wrap.innerHTML = examModuleMarkup('fac');
      while (wrap.firstChild) fac.appendChild(wrap.firstChild);
    }

    if (typeof ensureStudentDataMenu === 'function') {
      try { ensureStudentDataMenu(); } catch (e) { /* ignore */ }
    }
  }
  window.ensureExamAdminDesk = ensureExamAdminDesk;

  window.showAdExamTab = function (tabId, btn) {
    var root = document.getElementById('adExam');
    if (!root) return;
    ;['adExPDC', 'adExLookup', 'adExamPrint', 'adExKeylist', 'adExNotEligible', 'adExAttShort'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = id === tabId ? '' : 'none';
    });
    root.querySelectorAll('.tabs .tab').forEach(function (t) { t.classList.remove('act'); });
    if (btn) btn.classList.add('act');
    else {
      root.querySelectorAll('.tabs .tab').forEach(function (t) {
        var oc = t.getAttribute('onclick') || '';
        if (oc.indexOf("'" + tabId + "'") !== -1) t.classList.add('act');
      });
    }
    if (tabId === 'adExamPrint' && typeof window.acmPrintInitFields === 'function') {
      try { window.acmPrintInitFields(); } catch (e) { /* ignore */ }
    }
    if (tabId === 'adExPDC' && typeof window.renderExamModule === 'function') {
      window.renderExamModule();
    }
  };

  // Patch showFacExamTab if missing or extend existing
  var _origShowFacExamTab = typeof window.showFacExamTab === 'function' ? window.showFacExamTab : null;
  window.showFacExamTab = function (tabId, btn) {
    var root = document.getElementById('facExamModule');
    if (!root) return;
    var known = ['facExKeylist', 'facExNotEligible', 'facExPDC', 'facExAttShort', 'facExLookup', 'facExamPrint'];
    known.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = id === tabId ? (id === 'facExKeylist' || id === tabId ? 'block' : '') : 'none';
    });
    // Prefer block for visible tab
    var show = document.getElementById(tabId);
    if (show) show.style.display = 'block';
    root.querySelectorAll('.tabs .tab').forEach(function (t) { t.classList.remove('act'); });
    if (btn) btn.classList.add('act');
    if (tabId === 'facExamPrint' && typeof window.acmPrintInitFields === 'function') {
      try { window.acmPrintInitFields(); } catch (e) { /* ignore */ }
    }
    if (tabId === 'facExPDC' && typeof window.renderExamCertRequests === 'function') {
      try { window.renderExamCertRequests(); } catch (e) { /* ignore */ }
    }
    if (tabId === 'facExPDC' && typeof window.renderExamModule === 'function') {
      try { window.renderExamModule(); } catch (e) { /* ignore */ }
    }
  };

  function clearExamAdminScope() {
    if (!window._examScopedAdmin) return;
    window._examScopedAdmin = false;
    if (window._examScopeTimers) {
      window._examScopeTimers.forEach(function (t) { clearTimeout(t); });
      window._examScopeTimers = [];
    }
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
   * Hide every admin sidebar item except the Exam allow-list.
   * Safe to call repeatedly (ops/SM inject can re-add menus later).
   *
   * Intended Exam menu (as confirmed by staff):
   *   Approvals · Students · Student Data · Exam Module ·
   *   Branch Transfer · Student Management · Live Academic · Logout
   * Not full Root Admin (no Forms, Cash, Library, Academic Year alone, ACM, etc.).
   */
  function paintExamAdminMenu(user) {
    var root = document.getElementById('dbAdmin');
    if (!root || !window._examScopedAdmin) return;
    var allowedSecs = {
      adApprovals: 1,
      adStudents: 1,
      adStudentData: 1,
      adExam: 1,
      adExamFee: 1,
      adResultVerify: 1,
      // Student Management hub + related ops (same as image 107)
      adOpsCategory: 1,
      adOpsTransfer: 1,
      adOpsLive: 1,
    };
    var allowedIds = {
      adOpsCatNav: 1,
      adOpsXferNav: 1,
      adOpsLiveNav: 1,
      adExamNav: 1,
      adExamFeeNav: 1,
      adResultVerifyNav: 1,
    };
    root.querySelectorAll('.sb .sl').forEach(function (sl) {
      var oc = sl.getAttribute('onclick') || '';
      var id = sl.id || '';
      var keep = false;
      if (oc.indexOf('logout') !== -1) keep = true;
      if (sl.getAttribute('data-staff-profile') === '1') keep = true;
      if (allowedIds[id]) keep = true;
      Object.keys(allowedSecs).forEach(function (sec) {
        if (oc.indexOf("'" + sec + "'") !== -1 || oc.indexOf('"' + sec + '"') !== -1) keep = true;
      });
      // Never show full admin modules Exam does not need
      if (oc.indexOf('adACM') !== -1) keep = false;
      if (oc.indexOf('adAcademicYear') !== -1) keep = false;
      if (oc.indexOf('adForms') !== -1) keep = false;
      if (oc.indexOf('adCash') !== -1) keep = false;
      if (oc.indexOf('adLibrary') !== -1) keep = false;
      if (oc.indexOf('adRoles') !== -1) keep = false;
      if (oc.indexOf('adStaff') !== -1) keep = false;
      if (id === 'adAcademicYearNav' || id === 'adAccountApprovalsNav') keep = false;
      sl.style.display = keep ? '' : 'none';
    });
    root.querySelectorAll('.sb .sb-sec').forEach(function (sec) {
      sec.style.display = 'none';
    });
    var roleEl = root.querySelector('.sb-role');
    if (roleEl) roleEl.textContent = 'Exam Cell';
    var uname = root.querySelector('.db-uname');
    if (uname) {
      if (!uname.getAttribute('data-prev-name')) {
        uname.setAttribute('data-prev-name', uname.textContent || 'Root Admin');
      }
      uname.textContent = (user && user.display_name) ? user.display_name : 'Exam Cell';
    }
    var ava = root.querySelector('#adAva');
    if (ava && user && user.display_name && !ava.querySelector('img')) {
      ava.textContent = initialsOf(user.display_name);
    }
  }

  /**
   * Exam Cell desk: Approvals + Students + Student Data + Exam Module +
   * Student Management hub + Branch Transfer + Live Academic.
   * No ACM Module / full Root Admin.
   */
  function applyExamAdminScope(user) {
    ensureExamAdminDesk();
    var root = document.getElementById('dbAdmin');
    if (!root) return;
    window._examScopedAdmin = true;
    window._acmScopedAdmin = false;
    try { updateViewingAsBadge(user || window.currentUser); } catch (e) { /* ignore */ }
    try { ensureStaffDeskProfile(user || window.currentUser); } catch (e) { /* ignore */ }
    // Ensure SM / Branch / Live Academic nav items exist before allow-list paint
    try {
      if (typeof window.opsEnsureMenus === 'function') window.opsEnsureMenus();
    } catch (eOps) { /* ignore */ }

    paintExamAdminMenu(user || window.currentUser);

    // Re-paint after late menu injects (legacy-ops / SM hub / Academic Year)
    if (!window._examScopeTimers) window._examScopeTimers = [];
    window._examScopeTimers.forEach(function (t) { clearTimeout(t); });
    window._examScopeTimers = [80, 300, 800, 2000, 5000].map(function (ms) {
      return setTimeout(function () {
        if (!window._examScopedAdmin) return;
        paintExamAdminMenu(window.currentUser || user);
      }, ms);
    });

    var examLink = document.getElementById('adExamNav');
    if (typeof window.showSec === 'function') {
      window.showSec('adExam', examLink);
    }
    if (typeof window.renderExamModule === 'function') window.renderExamModule();
    if (typeof window.renderProfileRequestApprovals === 'function') {
      window.renderProfileRequestApprovals();
    }
    if (typeof window.renderAdminStudentDatabase === 'function') {
      window.renderAdminStudentDatabase();
    }
    if (typeof window.renderStudentDataBrowser === 'function') {
      try { window.renderStudentDataBrowser('adStudentData'); } catch (e) { /* ignore */ }
    }
    console.log('[bridge] Exam scoped admin shell (Approvals · Students · Student Data · Exam Module · Exam Fee · Result Verification · SM · Branch · Live)');
  }
  window.applyExamAdminScope = applyExamAdminScope;
  window.clearExamAdminScope = clearExamAdminScope;
  window.paintExamAdminMenu = paintExamAdminMenu;

  /** Fix sticky "VIEWING AS …" badge so it always matches the real logged-in role. */
  function updateViewingAsBadge(user) {
    try {
      var existing = document.getElementById('_demoRoleBadge');
      if (!user || !user.role || user.role === 'student') {
        if (existing) existing.remove();
        return;
      }
      var roleLabels = {
        faculty: 'Teaching Staff', hod: 'HOD', teaching: 'Teaching Staff',
        registrar: 'Registrar', acm: 'ACM', exam: 'Exam Cell', est: 'EST',
        library: 'Library Staff', placement: 'Placement Officer', nss: 'NSS Officer',
        yrc: 'Youth Red Cross', alumni: 'Alumni Officer', sports: 'Sports Officer',
        welfare: 'Student Welfare Officer', cash: 'Cash Officer', accounts: 'Accounts',
        stores: 'Stores', studentassoc: 'Student Association',
        principal: 'Principal', admin: 'Root Admin',
      };
      var roleColors = {
        faculty: '#d4600a', hod: '#b45309', teaching: '#d4600a',
        registrar: '#0e7490', acm: '#1d4ed8', exam: '#be185d', est: '#15803d',
        library: '#78350f', placement: '#0f4c75', nss: '#166534',
        yrc: '#991b1b', alumni: '#3730a3', sports: '#065f46',
        welfare: '#7e22ce', cash: '#713f12', accounts: '#1e3a5f',
        stores: '#44403c', studentassoc: '#4a044e',
        principal: '#0f4c75', admin: '#1e3a5f',
      };
      var role = user.role;
      if (existing) existing.remove();
      var badge = document.createElement('div');
      badge.id = '_demoRoleBadge';
      badge.style.cssText =
        'position:fixed;bottom:18px;right:18px;z-index:9999;background:' +
        (roleColors[role] || '#333') +
        ";color:white;padding:8px 16px;border-radius:10px;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:0.78rem;box-shadow:0 4px 16px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;";
      badge.innerHTML =
        '<span style="opacity:0.7;font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Viewing as</span>&nbsp;' +
        (roleLabels[role] || role) +
        '&nbsp;<button type="button" onclick="this.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:0.7rem;margin-left:4px;">✕</button>';
      document.body.appendChild(badge);
    } catch (e) {
      console.warn('[bridge] viewing-as badge', e);
    }
  }
  window.updateViewingAsBadge = updateViewingAsBadge;

  function openDashboardFor(user) {
    if (!user || !user.id || !user.role) {
      console.warn('[security] openDashboardFor refused — no verified user');
      setCurrentUser(null);
      if (typeof window.lockAllDashboards === 'function') window.lockAllDashboards();
      if (typeof window.showCmsLoginGate === 'function') window.showCmsLoginGate();
      return;
    }
    // Must set currentUser BEFORE any shell open so showSec/login guards pass
    setCurrentUser(user);
    // Kick off deferred modules ASAP (non-blocking); re-scope when ready
    try {
      ensureStaffModules().then(function () {
        try {
          if (user.role === 'exam' && typeof applyExamAdminScope === 'function') applyExamAdminScope(user);
          if (user.role === 'acm' && typeof applyAcmAdminScope === 'function') applyAcmAdminScope(user);
          if (typeof window.opsEnsureMenus === 'function') window.opsEnsureMenus();
        } catch (eMod) { /* ignore */ }
      });
    } catch (eKick) { /* ignore */ }
    // Start 20-minute idle auto-logout (login + session restore)
    try {
      if (typeof window.__gpthStartIdleWatch === 'function') window.__gpthStartIdleWatch();
      else if (typeof startIdleWatch === 'function') startIdleWatch();
    } catch (eIdle) { /* ignore */ }
    var role = user.role;
    if (user.reg_no) { window.STU_REG_NO = user.reg_no; } // keep student modules pointed at the real logged-in student
    clearAcmAdminScope();
    try { clearExamAdminScope(); } catch (e) { /* ignore */ }
    // Always sync role badge to the actual account (fixes ACM showing "VIEWING AS HOD")
    try { updateViewingAsBadge(user); } catch (e) { /* ignore */ }
    // Create Account Approvals panels before role shell opens them
    if (role === 'admin' || role === 'principal' || role === 'hod') {
      try { ensureAccountApprovalPanels(); } catch (e) { /* ignore */ }
    }
    bypass = true;
    window.__allowDashboardOpen = true;
    try {
      if (role === 'acm') {
        // ACM uses Root Admin shell UI, then menus are limited to Approvals / Students / ACM
        origLogin('admin');
        setTimeout(function () { applyAcmAdminScope(user); }, 40);
      } else if (role === 'exam') {
        // Exam Cell: same desk as ACM (Approvals + Students + Student Data) + Exam Module (no ACM)
        origLogin('admin');
        setTimeout(function () { applyExamAdminScope(user); }, 40);
      } else if (role === 'student' || role === 'admin' || role === 'principal') {
        origLogin(role);
        if (role === 'admin' || role === 'principal') {
          setTimeout(function () {
            ensureAccountApprovalPanels();
            ensurePrincipalHodDesk();
            try { ensureAcademicYearPanel(); } catch (e) { /* ignore */ }
            try { upgradeStudentDbFilters(); } catch (e) { /* ignore */ }
            if (role === 'principal') {
              ;['priUserApprovalsNav', 'priProfileApprovalsNav', 'priStudentsDeskNav', 'priStudentDataNav', 'priAcademicYearNav'].forEach(function (id) {
                var nav = document.getElementById(id);
                if (nav) nav.style.display = '';
              });
            }
            if (role === 'admin') {
              var ayNav = document.getElementById('adAcademicYearNav');
              if (ayNav) ayNav.style.display = '';
            }
          }, 50);
        }
      } else {
        // Faculty-family: original demoLogin only configures sidebar UI (no network) —
        // safe here because currentUser is already set from server session.
        if (typeof origDemoLogin === 'function') {
          origDemoLogin(role);
        } else {
          origLogin('faculty');
        }
        if (role === 'hod') {
          setTimeout(function () {
            ensureAccountApprovalPanels();
            ensurePrincipalHodDesk();
            try { upgradeStudentDbFilters(); } catch (e) { /* ignore */ }
            document.querySelectorAll(
              '#dbFaculty [data-fac="accountapprovals"], #dbFaculty [data-fac="students"], #dbFaculty [data-fac="studentdata"], #dbFaculty [data-fac="approvals"]'
            ).forEach(function (el) {
              el.style.display = '';
            });
            var hodNav = document.getElementById('facUserApprovalsNav');
            if (hodNav) hodNav.style.display = '';
            hideHodTeachingStaffProfile();
          }, 80);
        }
      }
    } finally {
      bypass = false;
      window.__allowDashboardOpen = false;
    }
    // Restore deep-link section only after authenticated open
    try {
      var sec = new URL(window.location.href).searchParams.get('section');
      if (sec && typeof window.showSec === 'function') {
        setTimeout(function () {
          if (!window.currentUser) return;
          var link = document.querySelector('.sl[onclick*="' + sec + '"], .sl[onclick*="\'' + sec + '\'"]');
          window.showSec(sec, link || null);
        }, 120);
      }
    } catch (eSec) { /* ignore */ }
    if (user.force_password_change) {
      alert('🔐 For security, please change your default password now (Profile → Change Password).');
    }
  }

  /**
   * Remove static demo/dummy cards, fake KPIs, sample approval rows, and
   * sidebar count badges from Principal + Faculty/HOD shells.
   * Real modules (Approvals, Students, Student Data, Account Approvals) inject live UI separately.
   */
  function stripDummyDashboards(user) {
    if (!user) return;
    var role = user.role;
    var isPri = role === 'principal';
    var isFacShell = role === 'hod' || role === 'faculty' || role === 'teaching' ||
      role === 'registrar' || role === 'exam' || role === 'est' || role === 'library' ||
      role === 'placement' || role === 'nss' || role === 'yrc' || role === 'alumni' ||
      role === 'sports' || role === 'welfare' || role === 'cash' || role === 'accounts' ||
      role === 'stores' || role === 'studentassoc' || role === 'nonteaching' || role === 'guest';
    if (!isPri && !isFacShell) return;

    function emptyState(msg) {
      return '<div class="info-box" style="margin:12px 0;opacity:.9;">' +
        (msg || 'No data yet. Live records will appear here when available.') + '</div>';
    }

    // ---- Sidebar fake badges (not bridge live badges) ----
    ;['#dbPrincipal', '#dbFaculty'].forEach(function (sel) {
      var root = document.querySelector(sel);
      if (!root) return;
      root.querySelectorAll('.slb').forEach(function (b) {
        if (!b.classList.contains('bridge-badge')) {
          b.style.display = 'none';
          b.textContent = '';
        }
      });
    });

    // ---- Principal ----
    if (isPri) {
      var priWelcome = document.querySelector('#priHome .welcome-card h2');
      var priWelcomeP = document.querySelector('#priHome .welcome-card p');
      if (priWelcome) {
        priWelcome.textContent = 'Welcome, ' + (user.display_name || 'Principal') + ' 👔';
      }
      if (priWelcomeP) {
        priWelcomeP.textContent = 'Full institutional oversight · Government Polytechnic Hubli';
      }
      // KPI numbers → placeholders until live paint
      document.querySelectorAll('#priHome .kpi-num').forEach(function (el, i) {
        if (i === 0) el.setAttribute('data-pri-kpi', 'students');
        else if (i === 1) el.setAttribute('data-pri-kpi', 'faculty');
        else if (i === 2) el.setAttribute('data-pri-kpi', 'pending');
        else if (i === 3) el.setAttribute('data-pri-kpi', 'other');
        el.textContent = '—';
      });
      document.querySelectorAll('#priHome .kpi-trend').forEach(function (el) {
        el.textContent = '';
        el.className = 'kpi-trend';
      });
      document.querySelectorAll('#priHome .pm-status .badge, #priHome .pr-module-card .badge').forEach(function (el) {
        el.textContent = '—';
        el.className = 'badge';
      });

      // Remove ALL demo app-items (onclick alert = static mock UI)
      document.querySelectorAll('#dbPrincipal .app-item').forEach(function (el) {
        if (/alert\s*\(/.test(el.innerHTML || '')) el.remove();
        else if (/hrs ago|Staff Member|Mr\.|Mrs\.|Ms\./i.test(el.textContent || '')) el.remove();
      });

      // EST pending demo cards
      var priPending = document.getElementById('priPending');
      if (priPending) {
        priPending.querySelectorAll('.app-item').forEach(function (el) { el.remove(); });
        var body = document.getElementById('priProfileApprovalBody');
        if (body) {
          body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:.7;">No pending staff profile requests.</td></tr>';
        }
        var pc = document.getElementById('priProfilePendingCount');
        if (pc) { pc.textContent = '0'; pc.className = 'badge'; }
        // If cards still show demo tables with sample rows, clear tbody rows that look demo
        priPending.querySelectorAll('tbody').forEach(function (tb) {
          if (tb.id === 'priProfileApprovalBody') return;
          if (tb.id && tb.id.indexOf('bridge') === 0) return;
          var hasDemo = /PRF\/|Staff Member|Mr\.|hrs ago|KGD|98XXXX/i.test(tb.textContent || '');
          if (hasDemo || (tb.querySelectorAll('tr').length && /onclick="alert\(/.test(tb.innerHTML))) {
            tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:18px;opacity:.7;">No pending items.</td></tr>';
          }
        });
      }

      // Other principal panels with static sample tables / lists
      ;[
        'priCommittee', 'priOfficers', 'priLibrary', 'priWorkload',
        'priFacStatus', 'priHODStatus', 'priAttStatus', 'priOffice', 'priEST',
        'priStudents', 'priGallery',
      ].forEach(function (id) {
        var sec = document.getElementById(id);
        if (!sec) return;
        sec.querySelectorAll('.app-item').forEach(function (el) { el.remove(); });
        sec.querySelectorAll('tbody').forEach(function (tb) {
          if (tb.id && (tb.id.indexOf('bridge') === 0 || tb.id.indexOf('adStu') === 0 || tb.id.indexOf('priStu') === 0)) return;
          var text = tb.textContent || '';
          var html = tb.innerHTML || '';
          if (/Staff Member|Mr\.|Mrs\.|Ms\.|Guest Faculty|Sample|demo|XXXX|hrs ago|Pending Principal|All Active|Civil Engineering · HOD/i.test(text) ||
              /onclick="alert\(/i.test(html)) {
            var cols = (tb.closest('table') && tb.closest('table').querySelectorAll('thead th').length) || 6;
            tb.innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center;padding:20px;opacity:.75;">No records yet.</td></tr>';
          }
        });
        // Demo grid cards with fake numbers
        sec.querySelectorAll('.kpi-num').forEach(function (el) {
          if (/^\d|Today|—/.test((el.textContent || '').trim()) && !el.getAttribute('data-live')) {
            el.textContent = '—';
          }
        });
      });

      // Grievances: keep live host empty if only demo
      var gList = document.getElementById('priGrievanceList');
      if (gList && /demo|sample|Student complaint/i.test(gList.textContent || '')) {
        gList.innerHTML = '';
      }
      var gEmpty = document.getElementById('priGrievEmpty');
      if (gEmpty) gEmpty.style.display = '';

      // Live paint principal KPIs (students count)
      paintPrincipalLiveKpis(user);
    }

    // ---- Faculty / HOD shell ----
    if (isFacShell) {
      var name = user.display_name || (role === 'hod' ? 'HOD' : 'Staff');
      var branch = user.branch || '';
      var facWelcome = document.querySelector('#facHome .welcome-card h2');
      var facWelcomeP = document.querySelector('#facHome .welcome-card p');
      if (facWelcome) {
        facWelcome.textContent = 'Welcome, ' + name + (role === 'hod' ? ' 🎓' : ' 👋');
      }
      if (facWelcomeP) {
        facWelcomeP.textContent =
          (branch ? branch + ' · ' : '') +
          (role === 'hod' ? 'Head of Department' : 'Faculty / Staff') +
          ' · Government Polytechnic Hubli';
      }
      document.querySelectorAll('#facHome .kpi-num').forEach(function (el, i) {
        el.setAttribute('data-fac-kpi', String(i));
        el.textContent = '—';
      });
      document.querySelectorAll('#facHome .kpi-trend').forEach(function (el) {
        el.textContent = '';
        el.className = 'kpi-trend';
      });

      // Remove ALL faculty demo app-items (mock alerts / sample students)
      document.querySelectorAll('#dbFaculty .app-item').forEach(function (el) {
        if (el.closest('#bridgeProfileRequestsFac') || el.closest('[data-live="1"]') || el.closest('[data-live-approvals="1"]')) return;
        if (/alert\s*\(/.test(el.innerHTML || '') ||
            /hrs ago|NSS Registration|Guest Faculty|Sports Activity|Staff Member/i.test(el.textContent || '')) {
          el.remove();
        }
      });

      // facApprovals demo app-items — clear; live profile approvals re-render into host
      var facAp = document.getElementById('facApprovals');
      if (facAp) {
        facAp.querySelectorAll('.app-item').forEach(function (el) { el.remove(); });
        var card = facAp.querySelector('.card');
        if (card && !card.querySelector('#bridgeProfileRequestsFac') && !document.getElementById('facApprovalsEmptyHint')) {
          var host = document.createElement('div');
          host.setAttribute('data-live-approvals', '1');
          host.id = 'facApprovalsEmptyHint';
          host.innerHTML = emptyState(
            role === 'hod'
              ? 'No pending department items right now. Profile update requests for your branch appear when students submit them.'
              : 'No pending department approvals right now.'
          );
          card.appendChild(host);
        }
      }
      document.querySelectorAll('#dbFaculty tbody').forEach(function (tb) {
        // Never wipe live result / student / ops tables
        if (tb.id && (
          tb.id.indexOf('bridge') === 0 ||
          tb.id.indexOf('facStu') === 0 ||
          tb.id.indexOf('facSd') === 0 ||
          tb.id.indexOf('adStu') === 0 ||
          tb.id === 'facResultViewBody' ||
          tb.id === 'resultMasterBody' ||
          tb.id === 'pdfLogBody' ||
          tb.id.indexOf('Ops') >= 0
        )) return;
        // Skip anything inside Results Management
        if (tb.closest('#facResults') || tb.closest('#frView') || tb.closest('#frAnalysis')) return;
        var text = tb.textContent || '';
        var html = tb.innerHTML || '';
        // Require stronger demo signals — bare "Student" matched live result tables
        if (/Staff Member|hrs ago|XXXX|Mr\.|Mrs\.|onclick="alert\(/i.test(text + html) &&
            !/171[A-Z]{2}\d{5}|SGPA|Sem\s*\d/i.test(text)) {
          var cols = (tb.closest('table') && tb.closest('table').querySelectorAll('thead th').length) || 5;
          tb.innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center;padding:18px;opacity:.75;">No records yet.</td></tr>';
        }
      });

      if (role === 'hod') {
        paintHodLiveKpis(user);
        try { hideHodTeachingStaffProfile(); } catch (e) { /* ignore */ }
      }
    }
  }
  window.stripDummyDashboards = stripDummyDashboards;

  async function paintPrincipalLiveKpis(user) {
    try {
      var s = await apiReqQuiet('/api/students?_ts=' + Date.now());
      var n = (s && Array.isArray(s.students)) ? s.students.length : null;
      var el = document.querySelector('#priHome [data-pri-kpi="students"]');
      if (el && n != null) el.textContent = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      var pend = await apiReqQuiet('/api/users?status=pending&_ts=' + Date.now());
      var pEl = document.querySelector('#priHome [data-pri-kpi="pending"]');
      if (pEl && pend && pend.counts) pEl.textContent = String(pend.counts.pending || 0);
      var fEl = document.querySelector('#priHome [data-pri-kpi="faculty"]');
      if (fEl) fEl.textContent = '—';
      var oEl = document.querySelector('#priHome [data-pri-kpi="other"]');
      if (oEl) oEl.textContent = '—';
    } catch (e) { /* ignore */ }
  }

  async function paintHodLiveKpis(user) {
    try {
      var s = await apiReqQuiet('/api/students?_ts=' + Date.now());
      var n = (s && Array.isArray(s.students)) ? s.students.length : 0;
      var el0 = document.querySelector('#facHome [data-fac-kpi="0"]');
      if (el0) el0.textContent = String(n);
      var el2 = document.querySelector('#facHome [data-fac-kpi="2"]');
      var pend = await apiReqQuiet('/api/users?status=pending&_ts=' + Date.now());
      if (el2 && pend && pend.counts) el2.textContent = String(pend.counts.pending || 0);
      var el1 = document.querySelector('#facHome [data-fac-kpi="1"]');
      if (el1) el1.textContent = '—';
      var el3 = document.querySelector('#facHome [data-fac-kpi="3"]');
      if (el3) el3.textContent = '—';
    } catch (e) { /* ignore */ }
  }

  async function afterAuth(user) {
    setCurrentUser(user);
    // Correct sticky role badge immediately (before any deferred UI)
    try { updateViewingAsBadge(user); } catch (e) { /* ignore */ }
    // Wait for deferred modules so Exam/SM/stamps exist before first paints
    try {
      await ensureStaffModules();
    } catch (eMods) {
      console.warn('[perf] modules', eMods);
    }
    await hydratePrivate();
    await paintStudentDashboard(user);
    // Strip static demo content from Principal / HOD shells first
    try { stripDummyDashboards(user); } catch (e) { console.warn('[bridge] stripDummy', e); }
    // Staff desk profile (Principal / HOD / ACM / Exam) — who is using the static seat
    if (user && (user.role === 'principal' || user.role === 'hod' || user.role === 'acm' || user.role === 'exam')) {
      try { ensureStaffDeskProfile(user); } catch (e) { console.warn('[bridge] staff profile', e); }
    }
    // Profile edit requests: Admin, Principal, HOD, ACM
    if (user && (user.role === 'admin' || user.role === 'hod' || user.role === 'acm' || user.role === 'principal' || user.role === 'exam') &&
        typeof window.renderProfileRequestApprovals === 'function') {
      try { window.renderProfileRequestApprovals(); } catch (e) { /* ignore */ }
    }
    // Account / desk first (so Academic Year nav can sit next to Approvals)
    if (user && (user.role === 'admin' || user.role === 'principal' || user.role === 'hod')) {
      ensureAccountApprovalPanels();
      ensurePrincipalHodDesk();
      // HOD: force desk menus visible
      var hodNav = document.getElementById('facUserApprovalsNav');
      if (hodNav) hodNav.style.display = user.role === 'hod' ? '' : 'none';
      if (user.role === 'hod') {
        document.querySelectorAll(
          '#dbFaculty [data-fac="accountapprovals"], #dbFaculty [data-fac="students"], #dbFaculty [data-fac="studentdata"], #dbFaculty [data-fac="approvals"], #dbFaculty [data-fac="results"], #dbFaculty [data-fac="attendance"], #dbFaculty [data-fac="timetable"], #dbFaculty [data-fac="home"]'
        ).forEach(function (el) {
          el.style.display = '';
        });
        hideHodTeachingStaffProfile();
        try { ensureStaffDeskProfile(user); } catch (e) { /* ignore */ }
        // Prefetch results so Results Mgmt is not empty on first open
        try {
          if (typeof window.reloadFacResults === 'function') {
            setTimeout(function () { /* warm cache only if panel exists */ }, 0);
          }
          fetch('/api/results?_ts=' + Date.now(), {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
              if (!data || !Array.isArray(data.results) || typeof resultDB === 'undefined') return;
              resultDB.length = 0;
              data.results.forEach(function (row) {
                resultDB.push({
                  reg: row.reg,
                  name: row.name,
                  branch: row.branch,
                  sem: Number(row.sem),
                  session: row.session,
                  subjects: row.subjects || [],
                  sgpa: row.sgpa != null ? Number(row.sgpa) : null,
                  result: row.result,
                });
              });
            })
            .catch(function () { /* ignore */ });
        } catch (ePref) { /* ignore */ }
      }
      try { renderAccountApprovals(); } catch (e) { console.warn('[bridge] account approvals', e); }
      try { upgradeStudentDbFilters(); } catch (e) { /* ignore */ }
    }
    // Academic year panel: Root Admin + Principal (after desk so menu anchors exist)
    if (user && (user.role === 'admin' || user.role === 'principal')) {
      try {
        ensureAcademicYearPanel();
        if (typeof window.loadAcademicYearPanel === 'function') window.loadAcademicYearPanel();
      } catch (e) { console.warn('[bridge] academic year panel', e); }
    }
    if (user && user.role === 'acm') {
      applyAcmAdminScope(user);
      if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    }
    if (user && user.role === 'exam') {
      applyExamAdminScope(user);
      if (typeof window.renderExamModule === 'function') window.renderExamModule();
    }
    // Attendance panel: lock HOD branch + prepare controls after login
    if (user && (user.role === 'hod' || user.role === 'faculty' || user.role === 'admin' || user.role === 'principal') &&
        typeof window.setupAttendancePanel === 'function') {
      try { window.setupAttendancePanel(); } catch (e) { console.warn('[bridge] attendance setup', e); }
    }
    // Prefetch timetable panel shell for staff (branch filter applied when opened)
    if (user && (user.role === 'hod' || user.role === 'faculty' || user.role === 'admin' || user.role === 'principal') &&
        typeof window.setupTimetableUploadPanel === 'function') {
      try { window.setupTimetableUploadPanel(); } catch (e) { console.warn('[bridge] timetable setup', e); }
    }
    // Student: inject Time Table menu (missing from slim sidebar)
    if (user && user.role === 'student') {
      try { ensureStudentTimetableMenu(); } catch (e) { console.warn('[bridge] student TT menu', e); }
    }
    // Forms: ensure builder meta + verifier menu + preload admin list
    try {
      if (typeof window.ensureFormBuilderMeta === 'function') window.ensureFormBuilderMeta();
      if (typeof window.ensureFormVerifyMenu === 'function') window.ensureFormVerifyMenu(user);
      if (user && (user.role === 'admin' || user.role === 'principal') &&
          typeof window.renderLiveFormManager === 'function') {
        setTimeout(function () {
          try { window.renderLiveFormManager(); } catch (e2) { /* ignore */ }
        }, 200);
      }
    } catch (e) { console.warn('[bridge] forms boot', e); }
    // Live notification panel + badge
    if (typeof window.renderLiveNotifications === 'function') {
      window.renderLiveNotifications();
    }
  }

  /** Add Time Table to student sidebar if the slim menu omitted it. */
  function ensureStudentTimetableMenu() {
    var menu = document.querySelector('#dbStudent .sb-menu');
    if (!menu) return;
    if (menu.querySelector('[data-stu-nav="timetable"]')) return;
    var att = null;
    menu.querySelectorAll('.sl').forEach(function (sl) {
      var oc = sl.getAttribute('onclick') || '';
      if (oc.indexOf('stuAtt') >= 0) att = sl;
    });
    var item = document.createElement('div');
    item.className = 'sl';
    item.setAttribute('data-stu-nav', 'timetable');
    item.setAttribute('onclick', "showSec('stuTimetable',this)");
    item.innerHTML = '<span class="sli">📅</span>Time Table';
    if (att && att.nextSibling) {
      att.parentNode.insertBefore(item, att.nextSibling);
    } else if (att) {
      att.parentNode.appendChild(item);
    } else {
      // Before forms / library if possible
      var forms = null;
      menu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('stuForms') >= 0) forms = sl;
      });
      if (forms) forms.parentNode.insertBefore(item, forms);
      else menu.appendChild(item);
    }
  }
  window.ensureStudentTimetableMenu = ensureStudentTimetableMenu;

  window.demoLogin = async function (role) {
    if ((window.__GPT_CONFIG || {}).demoLoginEnabled === false) { alert('Demo login is disabled.'); return; }
    // Only the student demo account remains; other role demos were removed.
    var r = serverRole(role);
    if (r !== 'student') {
      alert('Only the student demo account is available.\nLogin: demo.student@gpthubli.ac.in / demo1234');
      return;
    }
    var res = await api.post('/api/auth/demo-login', { role: 'student' });
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
    stopIdleWatch();
    clearAcmAdminScope();
    try { clearExamAdminScope(); } catch (e) { /* ignore */ }
    api.post('/api/auth/logout').catch(function () { /* ignore */ });
    setCurrentUser(null);
    // Always drop sticky "VIEWING AS …" chip after logout
    try {
      if (typeof window.updateViewingAsBadge === 'function') window.updateViewingAsBadge(null);
      else {
        var badge = document.getElementById('_demoRoleBadge');
        if (badge) badge.remove();
      }
    } catch (eBadge) { /* ignore */ }
    window.__allowDashboardOpen = false;
    if (typeof window.lockAllDashboards === 'function') window.lockAllDashboards();
    try { origLogout(); } catch (e2) { /* ignore */ }
    // Return to private CMS login (not the old public homepage)
    if (typeof window.showCmsLoginGate === 'function') window.showCmsLoginGate();
    try {
      var url = new URL(window.location.href);
      ;['section', 'ap_branch', 'ap_year', 'ap_adm_year', 'ap_q', 'ap_type'].forEach(function (k) {
        url.searchParams.delete(k);
      });
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    } catch (e3) { /* ignore */ }
  };

  /* ---------- Idle auto-logout (20 minutes without user activity) ---------- */
  var IDLE_MS = 20 * 60 * 1000;
  var IDLE_TOUCH_THROTTLE_MS = 60 * 1000; // server sliding refresh at most once/min
  var idleLastActivity = Date.now();
  var idleLastTouchAt = 0;
  var idleTimer = null;
  var idleWatching = false;
  var idleListenersBound = false;
  var idleLoggingOut = false;

  function isDashboardOpen() {
    function isShown(id) {
      var el = document.getElementById(id);
      return !!(el && el.classList && el.classList.contains('show'));
    }
    return isShown('dbAdmin') || isShown('dbFaculty') || isShown('dbPrincipal') || isShown('dbStudent');
  }

  function forceIdleLogout(reason) {
    if (idleLoggingOut) return;
    if (!window.currentUser && !isDashboardOpen()) return;
    idleLoggingOut = true;
    console.warn('[security]', reason || 'Idle timeout — logging out');
    try {
      if (!window.__gpthIdleNoticeShown) {
        window.__gpthIdleNoticeShown = true;
        try {
          alert('Your session expired after 20 minutes of inactivity. Please sign in again.');
        } catch (a) { /* ignore */ }
        setTimeout(function () { window.__gpthIdleNoticeShown = false; }, 2000);
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof window.logout === 'function') window.logout();
      else {
        stopIdleWatch();
        setCurrentUser(null);
        if (typeof window.lockAllDashboards === 'function') window.lockAllDashboards();
        if (typeof window.showCmsLoginGate === 'function') window.showCmsLoginGate();
      }
    } finally {
      idleLoggingOut = false;
    }
  }

  function noteUserActivity() {
    if (!idleWatching) return;
    if (!window.currentUser && !isDashboardOpen()) return;
    idleLastActivity = Date.now();
    // Sliding server session — throttled so we don't hit API on every mouse move
    if (Date.now() - idleLastTouchAt >= IDLE_TOUCH_THROTTLE_MS) {
      idleLastTouchAt = Date.now();
      fetch('/api/auth/touch', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(function (r) {
          if (r.status === 401) forceIdleLogout('Session expired on touch');
        })
        .catch(function () { /* network blip */ });
    }
  }

  function checkIdle() {
    if (!idleWatching) return;
    if (!window.currentUser && !isDashboardOpen()) return;
    if (Date.now() - idleLastActivity >= IDLE_MS) {
      forceIdleLogout('Idle for 20 minutes');
    }
  }

  function startIdleWatch() {
    idleLastActivity = Date.now();
    idleLastTouchAt = 0;
    idleLoggingOut = false;
    idleWatching = true;
    if (!idleListenersBound) {
      idleListenersBound = true;
      ;['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click', 'wheel'].forEach(function (ev) {
        document.addEventListener(ev, noteUserActivity, { capture: true, passive: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') checkIdle();
      });
    }
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(checkIdle, 15000);
    noteUserActivity();
  }

  function stopIdleWatch() {
    idleWatching = false;
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
  }

  window.__gpthStartIdleWatch = startIdleWatch;
  window.__gpthStopIdleWatch = stopIdleWatch;
  window.__gpthNoteActivity = noteUserActivity;

  /** Session heartbeat — if cookie expires or is cleared, force lock immediately.
   *  Does NOT extend the session (idle timeout still applies). */
  setInterval(async function () {
    try {
      var dashOpen = isDashboardOpen();
      if (!dashOpen && !window.currentUser) return;
      // Client-side idle check between heartbeats
      if (Date.now() - idleLastActivity >= IDLE_MS) {
        forceIdleLogout('Idle for 20 minutes');
        return;
      }
      var me = await apiReqQuiet('/api/auth/me');
      if (!me || !me.user) {
        if (window.currentUser || dashOpen) {
          forceIdleLogout('Session lost');
        }
      } else if (!idleWatching) {
        startIdleWatch();
      }
    } catch (e) { /* ignore network blips */ }
  }, 45000);

  /** Disable browser "Save password?" on all login / password inputs in this portal. */
  function hardenPasswordFields(root) {
    try {
      var scope = root || document;
      scope.querySelectorAll('input[type="password"], input[type="text"][id*="Login"], input[id*="Pw"], input[id*="Password"]').forEach(function (inp) {
        try {
          inp.setAttribute('autocomplete', inp.type === 'password' ? 'new-password' : 'off');
          inp.setAttribute('data-lpignore', 'true');
          inp.setAttribute('data-1p-ignore', 'true');
          inp.setAttribute('data-form-type', 'other');
          if (!inp.getAttribute('name') || /password|user|email|login/i.test(inp.getAttribute('name') || '')) {
            if (inp.type === 'password') inp.setAttribute('name', 'gpth_pw_' + (inp.id || 'x'));
            else inp.setAttribute('name', 'gpth_id_' + (inp.id || 'x'));
          }
        } catch (e1) { /* ignore */ }
      });
      scope.querySelectorAll('form').forEach(function (f) {
        try { f.setAttribute('autocomplete', 'off'); } catch (e2) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }
  hardenPasswordFields(document);
  setTimeout(function () { hardenPasswordFields(document); }, 500);
  setTimeout(function () { hardenPasswordFields(document); }, 2000);

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

  /**
   * @param {string} formKey
   * @param {{ silent?: boolean }} [opts] silent=true → no alert (login prefill)
   */
  window.fillCertFromReg = async function (formKey, opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var ids = certFormIds(formKey);
    if (!ids) return;
    var regEl = document.getElementById(ids.reg);
    if (!regEl) return;
    var reg = String(regEl.value || '').trim();
    // Always prefer logged-in student reg on silent prefill
    var myReg =
      currentUser && currentUser.role === 'student'
        ? String(currentUser.reg_no || window.STU_REG_NO || '').trim()
        : '';
    if (silent && myReg) {
      reg = myReg;
      regEl.value = myReg;
    }
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
      // Snap to account reg — never alert during silent/login prefill
      if (stu.expected) {
        if (!silent) {
          alert('Register number must match your account (' + stu.expected + ').');
        }
        regEl.value = stu.expected;
        stu = await resolveCertStudent(regEl.value);
      } else {
        return;
      }
    }
    if (!stu) {
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

  /** Prefill register no. on all cert forms from logged-in student and autofill (silent). */
  window.prefillStudentCertForms = async function () {
    if (!currentUser || currentUser.role !== 'student') return;
    var reg = currentUser.reg_no || window.STU_REG_NO || '';
    if (!reg) return;
    // Always overwrite leftover regs from a previous browser session
    ['tc', 'study', 'studying', 'noc', 'pdc'].forEach(function (key) {
      var ids = certFormIds(key);
      if (!ids) return;
      var regEl = document.getElementById(ids.reg);
      if (regEl) regEl.value = reg;
    });
    var keys = ['tc', 'study', 'studying', 'noc', 'pdc'];
    for (var i = 0; i < keys.length; i++) {
      await window.fillCertFromReg(keys[i], { silent: true });
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

  // Exam Cell "Student PDC Requests" table (faculty shell + admin exam desk)
  async function renderExamCertRequests() {
    var data = await apiReqQuiet('/api/cert-requests?routed_to=' + encodeURIComponent('Exam Cell') + '&_ts=' + Date.now());
    if (!data || !Array.isArray(data.requests)) {
      data = await apiReqQuiet('/api/cert-requests?_ts=' + Date.now());
      if (data && Array.isArray(data.requests)) {
        data.requests = data.requests.filter(function (r) {
          return r.routed_to === 'Exam Cell' || /pdc|provisional/i.test(String(r.cert_type || ''));
        });
      }
    }
    if (!data || !Array.isArray(data.requests)) return;
    var reqs = data.requests;

    function rowHtml(r) {
      var action = (r.status === 'pending' || r.status === 'processing')
        ? '<button class="btn btn-sm" style="background:#065f46;color:#fff;margin-right:6px" onclick="bridgeUpdateCertReq(' + r.id + ',\'ready\')">Mark Ready</button>' +
          '<button class="btn btn-sm" style="background:#991b1b;color:#fff" onclick="bridgeUpdateCertReq(' + r.id + ',\'rejected\')">Reject</button>'
        : (r.status === 'ready'
          ? '<button class="btn btn-sm" style="background:#1a4fa0;color:#fff" onclick="bridgeUpdateCertReq(' + r.id + ',\'collected\')">Collected</button>'
          : certStatusBadge(r.status));
      return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;">' + esc(r.req_code) +
        '</td><td><strong>' + esc(r.student_name) + '</strong></td><td style="font-family:JetBrains Mono,monospace;font-size:0.72rem;">' + esc(r.reg_no) +
        '</td><td>' + esc(r.branch || '—') + '</td><td>' + esc(r.cert_type) + '</td><td style="font-size:0.75rem;">' + esc(fmtDate(r.created_at)) +
        '</td><td>' + certStatusBadge(r.status) + '</td><td>' + action + '</td></tr>';
    }

    var rowsHtml = reqs.map(rowHtml).join('') ||
      '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">No Exam Cell certificate requests.</td></tr>';
    var pendingN = reqs.filter(function (r) { return r.status === 'pending' || r.status === 'processing'; }).length;
    var readyN = reqs.filter(function (r) { return r.status === 'ready'; }).length;

    // Faculty shell legacy table (may have 9 cols)
    var facSec = document.getElementById('facExPDC');
    if (facSec) {
      var facTb = facSec.querySelector('tbody');
      if (facTb) {
        facTb.innerHTML = reqs.map(function (r) {
          var action = r.status === 'pending'
            ? '<button class="btn btn-sm" style="background:#065f46;color:#fff;margin-right:6px" onclick="bridgeUpdateCertReq(' + r.id + ',\'ready\')">Mark Ready</button>' +
              '<button class="btn btn-sm" style="background:#991b1b;color:#fff" onclick="bridgeUpdateCertReq(' + r.id + ',\'rejected\')">Reject</button>'
            : certStatusBadge(r.status);
          return '<tr><td style="font-family:\'JetBrains Mono\',monospace;font-size:0.7rem;">' + esc(r.req_code) +
            '</td><td>' + esc(r.student_name) + '</td><td>' + esc(r.reg_no) + '</td><td>' + esc(r.branch || '—') +
            '</td><td>—</td><td>' + esc(r.cert_type) + '</td><td>' + esc(fmtDate(r.created_at)) +
            '</td><td>' + certStatusBadge(r.status) + '</td><td>' + action + '</td></tr>';
        }).join('') || '<tr><td colspan="9" style="opacity:.7">No incoming requests.</td></tr>';
      }
      var badge = facSec.querySelector('.card-acts .badge');
      if (badge) badge.textContent = pendingN + ' Pending';
    }

    // Exam desk panels
    document.querySelectorAll('[data-exam-tbody="1"]').forEach(function (tb) {
      tb.innerHTML = rowsHtml;
    });
    document.querySelectorAll('[data-exam-badge="1"]').forEach(function (el) {
      el.textContent = pendingN + ' Pending';
    });
    document.querySelectorAll('[data-exam-kpi="pending"]').forEach(function (el) {
      el.textContent = String(pendingN);
    });
    document.querySelectorAll('[data-exam-kpi="ready"]').forEach(function (el) {
      el.textContent = String(readyN);
    });
    document.querySelectorAll('[data-exam-kpi="total"]').forEach(function (el) {
      el.textContent = String(reqs.length);
    });
  }
  window.renderExamModule = renderExamCertRequests;
  window.renderExamCertRequests = renderExamCertRequests;

  window.examStudentLookup = async function () {
    if (typeof acmEnsureStudents === 'function') {
      await acmEnsureStudents();
    } else if (typeof window.acmEnsureStudents === 'function') {
      await window.acmEnsureStudents();
    } else {
      var data = await apiReqQuiet('/api/students?_ts=' + Date.now());
      window._acmStudentsCache = (data && data.students) ? data.students : [];
    }
    var roots = [
      document.getElementById('adExam'),
      document.getElementById('facExamModule'),
    ].filter(Boolean);
    var root = roots.find(function (r) { return r.offsetParent !== null; }) || roots[0];
    if (!root) return;
    var qEl = root.querySelector('[data-exam-lookup-q="1"]');
    var box = root.querySelector('[data-exam-lookup-result="1"]');
    if (!qEl || !box) return;
    var q = qEl.value.trim();
    if (q.length < 2) { box.innerHTML = ''; return; }
    var list = (window._acmStudentsCache || []).filter(function (s) {
      var hay = [s.reg_no, s.name, s.display_name, s.email, s.dept, s.year].join(' ').toLowerCase();
      return hay.indexOf(q.toLowerCase()) !== -1;
    }).slice(0, 15);
    if (!list.length) {
      box.innerHTML = '<div style="opacity:.7;padding:12px;">No students match “' + esc(q) + '”.</div>';
      return;
    }
    function card(s) {
      if (typeof acmStudentCard === 'function') return acmStudentCard(s);
      return '<div style="padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">' +
        '<strong>' + esc(s.name || s.display_name || '—') + '</strong><br>' +
        '<span style="font-family:JetBrains Mono,monospace;font-size:0.78rem;">' + esc(s.reg_no || '—') + '</span> · ' +
        esc(s.dept || '—') + (s.year ? ' · ' + esc(s.year) : '') + '</div>';
    }
    box.innerHTML = list.map(card).join('');
  };

  window.bridgeUpdateCertReq = async function (id, status) {
    var remarks = status === 'ready' ? 'Certificate ready. Collect from Exam Cell.' :
      status === 'rejected' ? 'Request rejected. Contact Exam Cell for details.' :
      status === 'collected' ? 'Certificate collected by student.' : null;
    var res = await api.patch('/api/cert-requests', { id: id, status: status, remarks: remarks });
    if (res && res.ok) {
      renderExamCertRequests();
      if (typeof window.renderExamModule === 'function') window.renderExamModule();
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
    var statusVal = statusEl ? statusEl.value : 'active';
    if (statusVal === '__all__') statusVal = ''; // empty → paint treats as active unless we special-case
    // When user explicitly wants all archive rows:
    if (statusEl && statusEl.value === '__all__') statusVal = '__all__';
    return {
      q: searchEl ? searchEl.value.trim().toLowerCase() : '',
      status: statusVal || 'active',
      type: typeEl ? typeEl.value : '',
    };
  }

  function acmPaintTables(list) {
    var f = acmReadFilters();
    // Default: only active work (pending / processing / ready). Fulfilled purpose
    // (collected) and rejected leave the desk queue unless staff picks that status.
    var statusF = (f.status || 'active').toLowerCase();
    var filtered = (list || []).filter(function (r) {
      var st = String(r.status || '').toLowerCase();
      if (statusF === '__all__') {
        /* show everything */
      } else if (statusF === 'active' || !statusF) {
        if (st === 'collected' || st === 'rejected') return false;
      } else if (st !== statusF) {
        return false;
      }
      if (f.type && String(r.cert_type || '').toLowerCase().indexOf(f.type.toLowerCase()) === -1) return false;
      if (f.q) {
        var hay = [r.req_code, r.student_name, r.reg_no, r.branch, r.cert_type].join(' ').toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    });

    var rowsHtml;
    if (!filtered.length) {
      rowsHtml = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">No pending ACM requests. Fulfilled (collected) items are hidden from this desk.</td></tr>';
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

  function acmEnsureStatusFilterOptions() {
    // Prefer Active desk queue; keep explicit options for archive lookup
    acmActiveRoots().forEach(function (root) {
      root.querySelectorAll('[data-acm-status="1"]').forEach(function (sel) {
        if (sel.getAttribute('data-acm-status-ready') === '1') return;
        sel.setAttribute('data-acm-status-ready', '1');
        var cur = sel.value || '';
        sel.innerHTML =
          '<option value="active">Active (pending / processing / ready)</option>' +
          '<option value="pending">Pending only</option>' +
          '<option value="processing">Processing</option>' +
          '<option value="ready">Ready</option>' +
          '<option value="collected">Collected (archive)</option>' +
          '<option value="rejected">Rejected (archive)</option>' +
          '<option value="__all__">Show all statuses</option>';
        // Map old "all"/empty to active
        if (!cur || cur === 'all' || cur === '') sel.value = 'active';
        else if (['pending', 'processing', 'ready', 'collected', 'rejected'].indexOf(cur) >= 0) sel.value = cur;
        else sel.value = 'active';
        if (!sel.__acmBound) {
          sel.__acmBound = true;
          sel.addEventListener('change', function () {
            if (typeof window.filterAcmRequests === 'function') window.filterAcmRequests();
          });
        }
      });
    });
  }

  async function renderAcmModule() {
    var roots = acmActiveRoots();
    if (!roots.length) return;

    acmEnsureStatusFilterOptions();

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
    // Live schema used on Student → My Profile (includes admin custom fields like "TEST Section")
    try {
      var schema = null;
      if (typeof window.stuProfileSchema !== 'undefined' && Array.isArray(window.stuProfileSchema) && window.stuProfileSchema.length) {
        schema = window.stuProfileSchema;
      } else if (typeof stuProfileSchema !== 'undefined' && Array.isArray(stuProfileSchema) && stuProfileSchema.length) {
        schema = stuProfileSchema;
      } else if (typeof defaultStuSections !== 'undefined' && Array.isArray(defaultStuSections)) {
        schema = defaultStuSections;
      }
      if (schema) {
        schema.forEach(function (sec) {
          if (!sec || sec.visible === false) return;
          (sec.fields || []).forEach(function (f) {
            if (!f) return;
            // Builder fields: label is primary; also accept name/title fallbacks
            var lab = f.label || f.name || f.title || '';
            if (lab) add(lab);
          });
        });
      }
    } catch (e) { /* ignore */ }
    // Any extra keys already present on loaded class (approved custom values)
    (window._acmPrintClass || []).forEach(function (s) {
      var extra = s && s.extra;
      if (typeof extra === 'string') {
        try { extra = JSON.parse(extra); } catch (e2) { extra = {}; }
      }
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(function (k) {
          if (k === 'profile_edit_locked') return;
          if (/photo/i.test(k)) return;
          if (typeof extra[k] === 'string' && extra[k].indexOf('data:image/') === 0) return;
          add(k);
        });
      }
    });
    // Cache from last schema API fetch (in case global schema not yet mutated)
    if (Array.isArray(window._printSchemaLabels)) {
      window._printSchemaLabels.forEach(add);
    }
    return labels;
  }

  /** Always reload admin My Profile schema before Print/Export so new sections appear. */
  async function acmEnsurePrintSchema() {
    try {
      if (typeof window.loadStudentProfileSchema === 'function') {
        await window.loadStudentProfileSchema(true);
      } else {
        var data = await apiReqQuiet('/api/profile-schema?key=student&_ts=' + Date.now());
        if (data && Array.isArray(data.schema)) {
          if (typeof stuProfileSchema !== 'undefined' && Array.isArray(stuProfileSchema)) {
            stuProfileSchema.length = 0;
            data.schema.forEach(function (sec) { stuProfileSchema.push(sec); });
          }
          window.stuProfileSchema = data.schema.slice();
        }
      }
      // Flatten labels for fallback
      var flat = [];
      var sch =
        (typeof window.stuProfileSchema !== 'undefined' && window.stuProfileSchema) ||
        (typeof stuProfileSchema !== 'undefined' ? stuProfileSchema : null);
      if (Array.isArray(sch)) {
        sch.forEach(function (sec) {
          if (!sec || sec.visible === false) return;
          (sec.fields || []).forEach(function (f) {
            if (f && f.label) flat.push(String(f.label).trim());
          });
        });
      }
      window._printSchemaLabels = flat;
    } catch (e) {
      console.warn('[acm-print] schema load', e);
    }
  }

  function acmPrintActiveRoot() {
    // Prefer the print panel that is currently visible (tab open) — ACM, Exam, or HOD
    var panels = Array.prototype.slice.call(document.querySelectorAll('[data-acm-print-fields="1"]'));
    var host = panels.find(function (el) {
      var tab = el.closest('#facAcmPrint, #adAcmPrint, #adExamPrint, #facExamPrint, #facHodPrint, #facHodPrintInner');
      if (!tab) return false;
      // Climb to section that showSec toggles (facHodPrint)
      var sec = el.closest('#facHodPrint, #facAcmPrint, #adAcmPrint, #adExamPrint, #facExamPrint') || tab;
      return sec.offsetParent !== null || (sec.style && sec.style.display !== 'none' && sec.offsetHeight > 0);
    }) || panels[0] || null;
    if (!host) return null;
    return host.closest('[data-acm-root="1"]') ||
      host.closest('[data-exam-root="1"]') ||
      host.closest('#facACM, #adACM, #adExam, #facExamModule, #facHodPrint') ||
      host.parentElement;
  }

  /** HOD: lock Branch to own department on Print / Export panel. */
  window.prepareHodPrintPanel = function prepareHodPrintPanel() {
    var root = document.getElementById('facHodPrint');
    if (!root) return;
    var branchName = '';
    try {
      if (typeof attHodBranch === 'function' && window.currentUser) {
        branchName = attHodBranch(window.currentUser) || '';
      }
    } catch (e0) { /* ignore */ }
    if (!branchName && window.currentUser && window.currentUser.branch) {
      branchName = String(window.currentUser.branch);
    }
    // Map short codes → full official names used by print filters
    var codeMap = {
      CE: 'Civil Engineering',
      CSE: 'Computer Science and Engineering',
      ECE: 'Electronics and Communication Engineering',
      ME: 'Mechanical Engineering',
    };
    var up = String(branchName || '').toUpperCase();
    if (codeMap[up]) branchName = codeMap[up];
    else if (up.indexOf('CIVIL') >= 0) branchName = codeMap.CE;
    else if (up.indexOf('COMPUTER') >= 0 || up.indexOf('CSE') >= 0) branchName = codeMap.CSE;
    else if (up.indexOf('ELECTRON') >= 0 || up.indexOf('ECE') >= 0) branchName = codeMap.ECE;
    else if (up.indexOf('MECH') >= 0) branchName = codeMap.ME;

    root.querySelectorAll('[data-acm-print-branch="1"]').forEach(function (sel) {
      if (branchName) {
        // Ensure option exists
        var found = false;
        Array.prototype.forEach.call(sel.options, function (o) {
          if (o.value === branchName) found = true;
        });
        if (!found) {
          var opt = document.createElement('option');
          opt.value = branchName;
          opt.textContent = branchName;
          sel.appendChild(opt);
        }
        sel.value = branchName;
        sel.disabled = true;
        sel.title = 'HOD branch is fixed to your department';
      }
    });
  };

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
      // Prefer exact schema label if we have a normalized match (custom admin fields)
      if (labelByNorm[nk]) put(labelByNorm[nk], v);
      else {
        // New custom key not yet in schema list — still export as its own column
        map[k] = String(v);
        labelByNorm[nk] = k;
      }
    });

    return map;
  }

  /** Map any year label → 1 | 2 | 3 (supports Roman I/II/III and 1st/2nd/3rd). */
  function acmPrintYearNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v >= 1 && v <= 3) return v;
    var s = String(v).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (/^(i|1|1st|first)(\s*year)?$/.test(s) || s.indexOf('1st') === 0 || s === 'i') return 1;
    if (/^(ii|2|2nd|second)(\s*year)?$/.test(s) || s.indexOf('2nd') === 0 || s === 'ii') return 2;
    if (/^(iii|3|3rd|third)(\s*year)?$/.test(s) || s.indexOf('3rd') === 0 || s === 'iii') return 3;
    var n = parseInt(s, 10);
    if (n >= 1 && n <= 3) return n;
    return null;
  }
  function acmPrintYearMatch(studentYear, filterYear, studyYearNum) {
    if (!filterYear) return true;
    var want = acmPrintYearNum(filterYear);
    if (want == null) return false;
    var have = acmPrintYearNum(studyYearNum != null ? studyYearNum : studentYear);
    if (have == null) have = acmPrintYearNum(studentYear);
    return have === want;
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
    // Always re-fetch schema + students so admin-added fields (e.g. TEST Section) appear
    await acmEnsurePrintSchema();
    window._acmStudentsCache = null;
    await acmEnsureStudents();

    // Prefer root that has the print controls (visible or not)
    var root = acmPrintActiveRoot();
    if (!root) {
      // Fallback: any print branch select on the page
      var anyBranch = document.querySelector('[data-acm-print-branch="1"]');
      root = anyBranch ? (anyBranch.closest('[data-acm-root="1"]') || anyBranch.closest('#facACM, #adACM, #facHodPrint') || document) : null;
    }
    if (!root) {
      alert('Print panel not found. Open Print / Export (ACM, Exam Cell, or HOD menu).');
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
      var sy = s.current_study_year != null ? s.current_study_year : (s.study_year != null ? s.study_year : null);
      if (!acmPrintYearMatch(s.year, year, sy)) return false;
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

    // Paint every ACM / Exam / HOD print surface
    document.querySelectorAll('#facACM, #adACM, #adExam, #facExamModule, #facHodPrint, [data-acm-root="1"], [data-exam-root="1"]').forEach(paintRoot);
    // Also paint by panel id if nested oddly
    ;['facAcmPrint', 'adAcmPrint', 'adExamPrint', 'facExamPrint', 'facHodPrint', 'facHodPrintInner'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) paintRoot(el);
    });

    acmPrintRefreshPreview();
  };

  /** Show full field checklist as soon as Print tab is opened (includes latest admin schema). */
  window.acmPrintInitFields = async function () {
    await acmEnsurePrintSchema();
    window._acmPrintFieldUnion = acmPrintAllProfileLabels();
    ;['facAcmPrint', 'adAcmPrint', 'adExamPrint', 'facExamPrint', 'facHodPrint', 'facHodPrintInner'].forEach(function (id) {
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
      var panel = document.getElementById('adAcmPrint') ||
        document.getElementById('facAcmPrint') ||
        document.getElementById('adExamPrint') ||
        document.getElementById('facExamPrint');
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
      document.querySelectorAll(
        '#adAcmPrint [data-acm-print-field]:checked, #facAcmPrint [data-acm-print-field]:checked, ' +
        '#adExamPrint [data-acm-print-field]:checked, #facExamPrint [data-acm-print-field]:checked'
      ).forEach(function (cb) {
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

    var existingGate = document.getElementById('cmsLoginGate');
    var alreadyWired = existingGate && existingGate.getAttribute('data-cms-wired') === '1';
    if (alreadyWired) {
      window.showCmsLoginGate && window.showCmsLoginGate();
      return;
    }

    // Remove lightweight cms-boot placeholder and build full interactive gate
    if (existingGate) {
      try { existingGate.remove(); } catch (e) { /* ignore */ }
    }

    var gate = document.createElement('div');
    gate.id = 'cmsLoginGate';
    gate.setAttribute('data-cms-wired', '1');
    gate.innerHTML =
      '<div class="cms-shell">' +
      '<div class="cms-bg" aria-hidden="true">' +
      '<img src="/images/campus-building.jpg" alt="" loading="lazy" decoding="async" />' +
      '<div class="cms-bg-overlay"></div>' +
      '</div>' +
      '<div class="cms-card">' +
      '<div class="cms-card-hd">' +
      '<img class="cms-logo" src="/images/college-logo.png" alt="Government Polytechnic Hubballi" ' +
      'onerror="this.onerror=null;this.src=\'/images/college-logo.jpg\'" />' +
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
      '<form id="cmsLoginForm" autocomplete="off" onsubmit="return false;">' +
      '<div class="cms-fg"><label>Username / Register No. / Email</label>' +
      '<input type="text" id="cmsLoginId" name="gpth_login_id" autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="e.g. 171CS15003 or email" /></div>' +
      '<div class="cms-fg"><label>Password</label>' +
      '<input type="password" id="cmsLoginPw" name="gpth_login_pw" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="Enter password" /></div>' +
      '<div class="cms-msg" id="cmsLoginMsg"></div>' +
      '<button type="button" class="cms-submit" id="cmsLoginBtn">Sign in →</button>' +
      '</form>' +
      '<div class="cms-foot">' +
      'Private portal — authorised users only.<br>' +
      '<a href="/student" style="display:inline-block;margin:6px 0 2px;font-weight:700;">📱 Open Student Mobile App</a><br>' +
      '<a id="cmsRegisterLink" href="#">New student? Create account</a><br>' +
      '<span style="display:inline-block;margin-top:10px;font-size:0.72rem;opacity:.9;">Developed by <strong>Akshay Uppar</strong></span>' +
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
        if (idEl) idEl.value = '';
        window.hideCmsLoginGate();
        openDashboardFor(res.user);
        await afterAuth(res.user);
        if (typeof startIdleWatch === 'function') startIdleWatch();
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

  // Install CMS gate immediately (don't wait) — kills old landing flash
  try {
    hideDemoBarIfDisabled();
    installCmsLoginGate();
  } catch (eGate) {
    console.warn('[bridge] early cms gate', eGate);
  }

  // Session restore + light boot (defer heavy public hydration forever — CMS is private)
  setTimeout(async function () {
    hideDemoBarIfDisabled();
    try { installCmsLoginGate(); } catch (e2) { /* ignore */ }
    /* Do NOT call hydratePublic() — old public homepage content is unused and freezes boot */
    // Always lock shells until /api/auth/me proves a session
    if (typeof window.lockAllDashboards === 'function') window.lockAllDashboards();
    setCurrentUser(null);
    var me = null;
    try {
      me = await apiReqQuiet('/api/auth/me');
    } catch (eMe) {
      me = null;
    }
    if (me && me.user && me.user.id) {
      window.hideCmsLoginGate && window.hideCmsLoginGate();
      openDashboardFor(me.user);
      // afterAuth is heavy — keep UI responsive
      try {
        await afterAuth(me.user);
      } catch (eAuth) {
        console.error('[bridge] afterAuth', eAuth);
      }
    } else {
      setCurrentUser(null);
      if (typeof window.lockAllDashboards === 'function') window.lockAllDashboards();
      window.showCmsLoginGate && window.showCmsLoginGate();
      // Strip deep-link section params when unauthenticated (cannot "open" account via URL alone)
      try {
        var url = new URL(window.location.href);
        if (url.searchParams.has('section') || url.searchParams.has('ap_branch')) {
          ;['section', 'ap_branch', 'ap_year', 'ap_adm_year', 'ap_q', 'ap_type'].forEach(function (k) {
            url.searchParams.delete(k);
          });
          window.history.replaceState({}, '', url.pathname + (url.search || ''));
        }
      } catch (eUrl) { /* ignore */ }
    }
  }, 0);
}

/* Boot: wait until legacy-app.js has defined its globals before wrapping them.
   Fast poll (20ms) so CMS login wires quickly after scripts land. */
(function bridgeBoot(attempt) {
  attempt = attempt || 0;
  if (typeof window.login === 'function' && typeof window.demoLogin === 'function') {
    try { __initGptBridge(); } catch (e) { console.error('[bridge] init failed', e); }
    return;
  }
  if (attempt > 200) { console.error('[bridge] legacy app never became ready'); return; }
  setTimeout(function () { bridgeBoot(attempt + 1); }, 20);
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
  // NOTE: bulk DTE/Excel import also sets profile_edit_locked=true as a seed —
  // that must NOT block first-time fill (see profile_first_filled below).
  window._stuProfileEditLocked = extra.profile_edit_locked === true || extra.profile_edit_locked === 'true';
  var PROFILE_META_KEYS = {
    profile_edit_locked: 1,
    profile_first_filled: 1,
    'Profile Photo': 1,
    profile_photo: 1,
    photo: 1,
    imported_from_excel: 1,
    imported_from_dte_pdf: 1,
    imported_at: 1,
    imported_missing_ece: 1,
    source_pdf: 1,
    syllabus_scheme: 1,
    'Temporary Reg No': 1,
    'Application ID': 1,
  };
  var filledExtra = Object.keys(extra).filter(function (k) {
    if (PROFILE_META_KEYS[k]) return false;
    var v = extra[k];
    return v != null && String(v).trim() !== '';
  }).length;
  var importSeed = !!(
    extra.imported_from_dte_pdf === true ||
    extra.imported_from_dte_pdf === 'true' ||
    extra.imported_from_excel === true ||
    extra.imported_from_excel === 'true' ||
    extra.imported_missing_ece ||
    extra['Temporary Reg No'] === true ||
    extra['Temporary Reg No'] === 'true'
  );
  var firstFilled =
    extra.profile_first_filled === true || extra.profile_first_filled === 'true';
  // Legacy staff lock without import seed = already reviewed (not first-time)
  if (!firstFilled && window._stuProfileEditLocked && !importSeed && filledExtra >= 8) {
    firstFilled = true;
  }
  // First-time until student self-saves once (or staff marks first-filled on approve).
  // Import seed lock must never block Year-1 first fill.
  window._stuProfileFirstTime = !firstFilled;
  window._stuProfileIncomplete =
    !firstFilled || (!window._stuProfileEditLocked && filledExtra < 12 && !importSeed);

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
  printBtn.textContent = '⬇ Download profile PDF (A4)';
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

    var profileInput = {
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
    };
    var html = buildStudentFullProfilePrintHtml(profileInput);
    // Real A4 PDF download on web (jsPDF) — avoids blank browser print page
    doStudentProfilePrintHtml(html, profileInput);
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

function loadJsPdfUmd() {
  return new Promise(function (resolve, reject) {
    try {
      if (window.jspdf && window.jspdf.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
    } catch (e) { /* ignore */ }
    var existing = document.querySelector('script[data-gpth-jspdf="1"]');
    if (existing) {
      existing.addEventListener('load', function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF load failed'));
      });
      existing.addEventListener('error', function () { reject(new Error('jsPDF script error')); });
      return;
    }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
    s.async = true;
    s.setAttribute('data-gpth-jspdf', '1');
    s.onload = function () {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF missing after load'));
    };
    s.onerror = function () { reject(new Error('Could not load jsPDF')); };
    document.head.appendChild(s);
  });
}

/** Build A4 profile PDF client-side (works on web Firefox/Chrome — not blank print). */
function buildStudentProfilePdfBlobSync(jsPDF, input) {
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
    var val = profilePrintDisplay(pair[1]);
    var key = label.toLowerCase();
    if (seen[key]) return;
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

  var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  var pageW = 210, pageH = 297, mL = 14, mR = 14, mT = 12, mB = 14;
  var contentW = pageW - mL - mR;
  var navy = [11, 61, 110];
  var ink = [15, 23, 42];
  var muted = [71, 85, 105];
  var y = mT;
  var name = profilePrintDisplay(input.name);
  var reg = profilePrintDisplay(input.reg_no);
  var branch = profilePrintDisplay(input.branch);
  var year = profilePrintDisplay(input.year);
  var photo = (input.photo && String(input.photo).indexOf('data:image/') === 0) ? String(input.photo) : '';
  var now = new Date();
  var printDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  var printTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  function ensureSpace(need) {
    if (y + need > pageH - mB) {
      pdf.setDrawColor(148, 163, 184);
      pdf.line(mL, pageH - 12, pageW - mR, pageH - 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(muted[0], muted[1], muted[2]);
      pdf.text('GPT Hubli Student Portal · Government Polytechnic Hubballi', mL, pageH - 8);
      pdf.text('Page ' + pdf.getNumberOfPages(), pageW - mR, pageH - 8, { align: 'right' });
      pdf.addPage();
      y = mT;
      pdf.setFillColor(navy[0], navy[1], navy[2]);
      pdf.rect(0, 0, pageW, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.text('Student Profile (continued) — ' + reg, mL, 5.5);
      y = 14;
    }
  }

  pdf.setFillColor(navy[0], navy[1], navy[2]);
  pdf.rect(0, 0, pageW, 6, 'F');
  y = 12;
  pdf.setTextColor(navy[0], navy[1], navy[2]);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.text('GOVERNMENT OF KARNATAKA  ·  DEPARTMENT OF TECHNICAL EDUCATION', pageW / 2, y, { align: 'center' });
  y += 6;
  pdf.setFontSize(14);
  pdf.text('GOVERNMENT POLYTECHNIC, HUBBALLI', pageW / 2, y, { align: 'center' });
  y += 5;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(muted[0], muted[1], muted[2]);
  pdf.text('Student Master Record — Official Profile Printout', pageW / 2, y, { align: 'center' });
  y += 7;
  pdf.setDrawColor(navy[0], navy[1], navy[2]);
  pdf.setLineWidth(0.8);
  pdf.line(mL, y, pageW - mR, y);
  y += 8;

  pdf.setFillColor(navy[0], navy[1], navy[2]);
  pdf.rect(mL, y - 4, contentW, 8, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('STUDENT PROFILE', pageW / 2, y + 1.5, { align: 'center' });
  y += 12;

  var photoW = 28, photoH = 34;
  var textMaxW = contentW - photoW - 6;
  pdf.setTextColor(navy[0], navy[1], navy[2]);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  var nameLines = pdf.splitTextToSize(name === '—' ? 'Student' : name, textMaxW);
  pdf.text(nameLines, mL, y);
  var idY = y + nameLines.length * 5.5;
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.text(reg, mL, idY);
  idY += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setDrawColor(navy[0], navy[1], navy[2]);
  pdf.setFillColor(240, 246, 252);
  var c1w = pdf.getTextWidth(branch) + 6;
  pdf.roundedRect(mL, idY - 3.5, c1w, 6, 1, 1, 'FD');
  pdf.setTextColor(navy[0], navy[1], navy[2]);
  pdf.text(branch, mL + 3, idY);
  var c2w = pdf.getTextWidth(year) + 6;
  pdf.roundedRect(mL + c1w + 3, idY - 3.5, c2w, 6, 1, 1, 'FD');
  pdf.text(year, mL + c1w + 6, idY);
  idY += 8;

  var photoX = pageW - mR - photoW;
  var photoY = y - 2;
  pdf.setDrawColor(navy[0], navy[1], navy[2]);
  pdf.setFillColor(248, 250, 252);
  pdf.rect(photoX, photoY, photoW, photoH, 'FD');
  if (photo) {
    try {
      var fmt = photo.indexOf('image/png') >= 0 ? 'PNG' : 'JPEG';
      pdf.addImage(photo, fmt, photoX + 0.6, photoY + 0.6, photoW - 1.2, photoH - 1.2);
    } catch (e) { /* ignore photo */ }
  } else {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(148, 163, 184);
    pdf.text('No photo', photoX + photoW / 2, photoY + photoH / 2, { align: 'center' });
  }
  y = Math.max(idY, photoY + photoH + 4);

  ensureSpace(12);
  pdf.setFillColor(navy[0], navy[1], navy[2]);
  pdf.rect(mL, y, contentW, 7, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.text('PROFILE DETAILS  ·  ' + rows.length + ' fields', mL + 3, y + 4.8);
  y += 10;

  var colGap = 4;
  var colW = (contentW - colGap) / 2;
  var labelW = colW * 0.42;
  var valueW = colW * 0.58;
  var rowH = 6.2;
  var shortRows = [];
  var longRows = [];
  rows.forEach(function (r) {
    if (r.value.length > 55 || /address|remark|note/i.test(r.label)) longRows.push(r);
    else shortRows.push(r);
  });
  var mid = Math.ceil(shortRows.length / 2);
  var left = shortRows.slice(0, mid);
  var right = shortRows.slice(mid);
  var maxPairs = Math.max(left.length, right.length);
  for (var i = 0; i < maxPairs; i++) {
    ensureSpace(rowH + 1);
    function drawField(x, label, value) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(x, y - 3.8, colW, rowH, 'F');
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.15);
      pdf.line(x, y + 2.2, x + colW, y + 2.2);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7);
      pdf.setTextColor(navy[0], navy[1], navy[2]);
      var lab = pdf.splitTextToSize(label, labelW - 2);
      pdf.text(lab[0] || label, x + 1, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(ink[0], ink[1], ink[2]);
      var valLines = pdf.splitTextToSize(value || '—', valueW - 2);
      pdf.text(valLines[0] || '—', x + labelW, y);
    }
    if (left[i]) drawField(mL, left[i].label, left[i].value);
    if (right[i]) drawField(mL + colW + colGap, right[i].label, right[i].value);
    y += rowH;
  }

  if (longRows.length) {
    y += 3;
    ensureSpace(10);
    pdf.setFillColor(11, 61, 110);
    pdf.rect(mL, y, contentW, 6.5, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text('ADDITIONAL DETAILS', mL + 3, y + 4.4);
    y += 9;
    longRows.forEach(function (r) {
      var lines = pdf.splitTextToSize(r.value || '—', contentW - 4);
      ensureSpace(5 + lines.length * 4.2 + 2);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(navy[0], navy[1], navy[2]);
      pdf.text(String(r.label).toUpperCase(), mL + 1, y);
      y += 4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(ink[0], ink[1], ink[2]);
      pdf.text(lines, mL + 1, y);
      y += lines.length * 4.2 + 3;
    });
  }

  y += 6;
  ensureSpace(28);
  pdf.setDrawColor(navy[0], navy[1], navy[2]);
  pdf.setLineWidth(0.4);
  pdf.line(mL, y, pageW - mR, y);
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(muted[0], muted[1], muted[2]);
  pdf.text('Printed: ' + printDate + '  ' + printTime, mL, y);
  pdf.text('System-generated profile — verify with college office if required.', mL, y + 4.5);
  pdf.setDrawColor(ink[0], ink[1], ink[2]);
  pdf.line(pageW - mR - 55, y + 16, pageW - mR, y + 16);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(ink[0], ink[1], ink[2]);
  pdf.text('Student / Office use', pageW - mR - 27.5, y + 20, { align: 'center' });

  pdf.setDrawColor(148, 163, 184);
  pdf.line(mL, pageH - 12, pageW - mR, pageH - 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(muted[0], muted[1], muted[2]);
  pdf.text('GPT Hubli Student Portal · Government Polytechnic Hubballi', mL, pageH - 8);
  pdf.text('Page ' + pdf.getNumberOfPages(), pageW - mR, pageH - 8, { align: 'right' });

  return pdf.output('blob');
}

function downloadBlobFile(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () {
    try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
  }, 60000);
  // Also open in new tab so user can print from PDF viewer if download is blocked
  try {
    window.open(url, '_blank');
  } catch (e2) { /* ignore */ }
}

function doStudentProfilePrintHtml(html, profileInput) {
  // Prefer real A4 PDF download (fixes blank Firefox print dialog)
  if (profileInput) {
    loadJsPdfUmd()
      .then(function (jsPDF) {
        var blob = buildStudentProfilePdfBlobSync(jsPDF, profileInput);
        var reg = String(profileInput.reg_no || 'student').replace(/[^\w\-]+/g, '_');
        downloadBlobFile(blob, 'profile-' + reg + '.pdf');
      })
      .catch(function (err) {
        console.warn('[profile pdf] jsPDF failed, falling back to HTML print', err);
        doStudentProfilePrintHtmlFallback(html);
      });
    return;
  }
  doStudentProfilePrintHtmlFallback(html);
}

function doStudentProfilePrintHtmlFallback(html) {
  // Open dedicated window (more reliable than main-window print CSS on Firefox)
  try {
    var w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(function () {
        try { w.print(); } catch (e) { /* user can print from window */ }
      }, 400);
      return;
    }
  } catch (e) { /* continue */ }

  if (typeof window.gpthPrintHtml === 'function') {
    window.gpthPrintHtml(html, { title: 'Student Profile', filename: 'student-profile.html', autoPrint: false });
    return;
  }
  alert('Could not open profile PDF. Allow pop-ups and try again.');
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
      lockBanner.innerHTML =
        '🔒 <strong>Profile is view-only</strong> — You can still <strong>raise an edit request</strong> below. ' +
        'Approver will review and apply changes (no need to wait for unlock first).';
      container.parentNode.insertBefore(lockBanner, container.nextSibling);
    }
  } else {
    lockBanner.innerHTML =
      '🔒 <strong>Profile is view-only</strong> — You can still <strong>raise an edit request</strong> below. ' +
      'Approver will review and apply changes (no need to wait for unlock first).';
  }
  if (!pendingBanner) {
    var host = document.getElementById('stuDynamicProfileSections');
    if (host && host.parentNode) {
      pendingBanner = document.createElement('div');
      pendingBanner.id = 'stuProfilePendingBanner';
      pendingBanner.className = 'info-box';
      pendingBanner.style.cssText = 'display:none;margin-top:14px;margin-bottom:0;border-left:4px solid #1a4fa0;';
      pendingBanner.innerHTML = '⏳ <strong>Edit request raised</strong> — waiting for Admin / HOD / ACM review. Profile stays view-only until decided.';
      host.parentNode.insertBefore(pendingBanner, host.nextSibling);
    }
  }

  var pending = false;
  try {
    var pr = await profileApiGet('/api/profile-requests?mine=1');
    pending = !!(pr && ((pr.mine_pending > 0) || (pr.pending && pr.pending.length > 0)));
  } catch (e) { pending = false; }
  window._stuProfileRequestPending = pending;

  var firstMode = !!(window._stuProfileFirstTime || window._stuProfileIncomplete);
  // Import seed lock must not show "view-only" during first-time fill
  if (lockBanner) {
    lockBanner.style.display =
      (locked && !pending && !window._stuProfileEditEnabled && !firstMode) ? '' : 'none';
  }
  if (pendingBanner) pendingBanner.style.display = pending ? '' : 'none';
  if (banner && pending) banner.style.display = 'none';

  if (btn) {
    if (pending) {
      btn.disabled = true;
      btn.style.opacity = '0.55';
      btn.style.cursor = 'not-allowed';
      btn.textContent = 'Edit Request Pending';
      btn.classList.remove('gr');
      window._stuProfileEditEnabled = false;
    } else if (!window._stuProfileEditEnabled) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      btn.textContent = window._stuProfileFirstTime
        ? 'Fill My Profile (First Time)'
        : 'Raise Edit Request';
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
      firstBanner.innerHTML = 'Welcome! Please fill your complete My Profile for the first time, then click Save My Profile.';
      hostFt.parentNode.insertBefore(firstBanner, hostFt.nextSibling);
    }
  }
  if (firstBanner) {
    firstBanner.style.display = (!pending && firstMode) ? '' : 'none';
    if (firstMode) {
      firstBanner.innerHTML =
        '<strong>First-time profile update is open.</strong> ' +
        'Your fields are editable now — complete your details and click <strong>Save My Profile</strong>. ' +
        'No staff unlock is needed for this first fill. After you save, further changes use Raise Edit Request.';
    }
  }

  // First-time / incomplete: auto-open edit mode (ignore import seed lock)
  if (!pending && !window._stuProfileEditEnabled && firstMode) {
    try {
      enableStuProfileEdit({ firstTime: true, quiet: true });
    } catch (eAuto) { /* ignore */ }
  }
}
window.updateStuProfileLockUI = updateStuProfileLockUI;

/** Unlock fields on Student → My Profile for a request draft (fee years follow Current Year rules). */
function enableStuProfileEdit(opts) {
  opts = opts || {};
  // Students may always open a draft request (even if view-only / "locked")
  var container = document.getElementById('stuDynamicProfileSections');
  if (!container) {
    if (!opts.quiet) alert('Profile section not found.');
    return false;
  }

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
      hint.textContent = 'You can edit this field';
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
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.cursor = '';
    btn.textContent = opts.firstTime || window._stuProfileFirstTime
      ? 'Save My Profile'
      : 'Submit Edit Request';
    btn.classList.add('gr');
  }
  var banner = document.getElementById('stuProfileEditBanner');
  if (banner) banner.style.display = opts.quiet ? 'none' : '';

  return true;
}
window.enableStuProfileEdit = enableStuProfileEdit;

/**
 * Student My Profile:
 *  - Default: view-only
 *  - Raise Edit Request → draft fields (works even when Admin locked view-only)
 *  - Submit → pending on Approvals (data saves only after approve)
 *  - No need for Admin to unlock first
 */
async function submitStuProfileUpdate() {
  var container = document.getElementById('stuDynamicProfileSections');
  if (!container) { alert('Profile section not found.'); return; }

  // First action: open draft for a raised edit request
  if (!window._stuProfileEditEnabled) {
    // Block starting a new draft if a request is already pending approval
    try {
      var pending = await profileApiGet('/api/profile-requests?mine=1');
      if (pending && ((pending.mine_pending > 0) || (pending.pending && pending.pending.length > 0))) {
        alert('You already have an edit request pending Admin/HOD/Exam/ACM approval.\n\nWait until it is reviewed, then raise a new request if needed.');
        updateStuProfileLockUI();
        return;
      }
    } catch (e) { /* allow attempt if check fails */ }

    enableStuProfileEdit({ firstTime: !!window._stuProfileFirstTime });
    alert(
      window._stuProfileFirstTime
        ? 'Profile is now editable.\n\nFill your details, then click Save My Profile.\nYour branch HOD, Admin, Exam Cell and ACM can also see update requests under Approvals.'
        : 'Edit request draft opened.\n\n• Change the fields you need\n• Fee sections unlock based on Current Year\n• Submit so HOD / Admin / Exam / ACM can approve\n\nThen click "Submit Edit Request".'
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
    var labelText = label.textContent.replace(/✏️.*$/, '').replace(/You can edit this field/g, '').trim();
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

  // First-time / incomplete: save profile data immediately + notify staff queue
  var firstSave = !!window._stuProfileFirstTime || !!window._stuProfileIncomplete;
  var res;
  if (firstSave) {
    res = await apiClient.post('/api/profile-requests', {
      targetType: 'student',
      targetId: regNo,
      changes: changes,
      first_time_save: true,
    });
  } else {
    res = await apiClient.post('/api/profile-requests', {
      targetType: 'student',
      targetId: regNo,
      changes: changes,
    });
  }

  if (res && res.ok) {
    var hasPhoto = !!changes['Profile Photo'];
    if (res.applied_immediately) {
      alert(
        'Profile saved.\n\n' +
        (hasPhoto ? 'Photo saved.\n\n' : '') +
        'Your details are stored. Staff can still review later under Approvals if needed.'
      );
      window._stuProfileFirstTime = false;
      window._stuProfileIncomplete = false;
      window._stuProfileEditEnabled = false;
      window._stuPendingPhoto = null;
      // Refresh from server
      try {
        var s = await apiClient.get('/api/students?_ts=' + Date.now());
        if (s && s.students && s.students[0] && typeof window.applyLiveStudentProfile === 'function') {
          var row = s.students[0];
          if (typeof students !== 'undefined') students[row.reg_no || regNo] = row;
          window.applyLiveStudentProfile(row, row.reg_no || regNo);
        }
      } catch (eRef) {
        updateStuProfileLockUI();
      }
    } else {
      alert(
        'Update request submitted! Awaiting HOD / Admin / Exam Cell / ACM approval.\n\n' +
        (hasPhoto ? 'Profile photo is included in this request.\n\n' : '') +
        'Open Approvals on the staff side to review. Your profile stays view-only until approved.'
      );
      window._stuProfileEditEnabled = false;
      if (typeof renderStuDynamicProfile === 'function') renderStuDynamicProfile();
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
        btn.textContent = 'Edit Request Pending';
        btn.disabled = true;
        btn.style.opacity = '0.55';
        btn.style.cursor = 'not-allowed';
      }
    }
  } else {
    alert((res && (res.error || res.message)) || 'Could not submit profile. Try again.');
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
  if (role !== 'admin' && role !== 'hod' && role !== 'acm' && role !== 'principal' && role !== 'exam') return;
  if (typeof ensurePrincipalHodDesk === 'function') {
    try { ensurePrincipalHodDesk(); } catch (e) { /* ignore */ }
  }
  // ACM/Exam use admin Approvals UI; Principal has own panel; HOD uses faculty Approvals
  var containerId =
    (role === 'admin' || role === 'acm' || role === 'exam') ? 'adApprovals' :
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

// Slow poll for profile approvals only when a relevant panel is visible.
setInterval(function () {
  if (!window.currentUser) return;
  if (document.hidden) return;
  var r = window.currentUser.role;
  if (r !== 'admin' && r !== 'hod' && r !== 'acm' && r !== 'exam' && r !== 'principal') return;
  var ae = document.activeElement;
  if (ae && ae.id && (ae.id.indexOf('ap') === 0 || ae.id.indexOf('accAp') === 0)) return;
  var anyOpen = false;
  ;['adApprovals', 'facApprovals', 'priProfileApprovals', 'adUserApprovals', 'facUserApprovals', 'priUserApprovals'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (el.style.display === 'none') return;
    if (el.offsetParent === null && el.style.display !== 'block') return;
    anyOpen = true;
  });
  if (!anyOpen) return;
  if (typeof renderProfileRequestApprovals === 'function') renderProfileRequestApprovals();
}, 45000);

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

/** Root element for the active Student Database panel (admin / principal / HOD). */
function studentDbRootForPrefix(pfx) {
  pfx = pfx || activeStudentDbPrefix();
  if (pfx === 'priStu') {
    return document.getElementById('priStudentsDesk') || document.getElementById('priStuTableBody') || document;
  }
  if (pfx === 'facStu') {
    return document.getElementById('facBranchStudents') || document.getElementById('facStuTableBody') || document;
  }
  return document.getElementById('adStudents') || document.getElementById('adStuTableBody') || document;
}
window.studentDbRootForPrefix = studentDbRootForPrefix;

function updateStuBulkBarCount() {
  var pfx = activeStudentDbPrefix();
  var root = studentDbRootForPrefix(pfx);
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
  // Upgrade static Admin filters + inject Status filter if missing
  try {
    if (typeof window.upgradeStudentDbFilters === 'function') window.upgradeStudentDbFilters();
    else if (typeof upgradeStudentDbFilters === 'function') upgradeStudentDbFilters();
  } catch (e) { /* ignore */ }
  // Paint all existing student-db table bodies for this session
  var prefixes = ['adStu', 'priStu', 'facStu'].filter(function (pfx) {
    return !!document.getElementById(pfx + 'TableBody');
  });
  // Admin static panel may exist without being in prefixes if tbody id differs — still upgrade
  if (!prefixes.length && document.getElementById('adStudents')) {
    try { upgradeStudentDbFilters(); } catch (e2) { /* ignore */ }
  }
  if (!prefixes.length) return;

  var cu = window.currentUser;
  if (!cu || (cu.role !== 'admin' && cu.role !== 'acm' && cu.role !== 'exam' && cu.role !== 'hod' && cu.role !== 'registrar' && cu.role !== 'principal')) {
    prefixes.forEach(function (pfx) {
      var tb = document.getElementById(pfx + 'TableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.75;">Sign in as Admin / Principal / HOD / Exam to view students.</td></tr>';
    });
    return;
  }
  prefixes.forEach(function (pfx) {
    var tb = document.getElementById(pfx + 'TableBody');
    if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">Loading students…</td></tr>';
  });

  // include_alumni=1 + lite=1 (no photos / no N+1 counts) so list stays fast
  var data = await profileApiGet('/api/students?include_alumni=1&lite=1&_ts=' + Date.now());
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
  window._academicSettings = data.academic_settings || null;

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
        var ay = (s.admission_academic_year || '') + '';
        if (!ay.trim()) {
          var extra = s.extra || {};
          if (typeof extra === 'string') {
            try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
          }
          ay =
            (extra['Admission Academic Year'] || extra['Year of Admission'] || extra['Year Of Admission'] || extra['Admission Year'] || '') + '';
        }
        ay = ay.trim();
        if (ay) admYears[ay] = true;
      });
      var aopts = '<option value="">All Batches</option>';
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
  var statusF = ((document.getElementById(pfx + 'StatusFilter') || {}).value || 'active_like').trim();
  var admYear = ((document.getElementById(pfx + 'AdmYearFilter') || {}).value || '').trim();
  var prof = ((document.getElementById(pfx + 'ProfileFilter') || {}).value || '').trim();

  function studentAdmissionYear(s) {
    if (s.admission_academic_year) return String(s.admission_academic_year).trim();
    var extra = s.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    var keys = ['Admission Academic Year', 'Year of Admission', 'Year Of Admission', 'Admission Year', 'year_of_admission'];
    for (var i = 0; i < keys.length; i++) {
      if (extra[keys[i]] != null && String(extra[keys[i]]).trim() !== '') {
        return String(extra[keys[i]]).trim();
      }
    }
    // case-insensitive scan
    var found = Object.keys(extra || {}).find(function (k) {
      return /year\s*of\s*admission|admission\s*year|admission\s*academic/i.test(k);
    });
    return found ? String(extra[found]).trim() : '';
  }

  function academicStatusOf(s) {
    return String(s.academic_status || (s.academic && s.academic.academic_status) || 'active').toLowerCase();
  }

  function studyYearNum(s) {
    if (s.current_study_year === 1 || s.current_study_year === 2 || s.current_study_year === 3) return Number(s.current_study_year);
    var y = String(s.year || '').toLowerCase();
    if (/alumni|pass/.test(y)) return 0;
    if (/3|iii|third/.test(y)) return 3;
    if (/2|ii|second/.test(y)) return 2;
    if (/1|i|first/.test(y)) return 1;
    return null;
  }

  var list = window._adminStudentList || [];
  var filtered = list.filter(function (s) {
    if (prof && s.profile_status !== prof) return false;
    if (branch) {
      var d = String(s.dept || '').toLowerCase();
      if (d.indexOf(branch) === -1) return false;
    }
    var st = academicStatusOf(s);
    if (statusF === 'active_like') {
      if (st === 'passed_out') return false;
    } else if (statusF === 'active') {
      if (st !== 'active') return false;
    } else if (statusF === 'detained' || statusF === 'year_back' || statusF === 'passed_out') {
      if (st !== statusF) return false;
    }
    // statusF === 'all' → no status filter
    // Accept new codes (1/2/3/alumni) and legacy labels (1st year, year back, completed)
    if (year === 'alumni' || year === 'completed' || year.indexOf('alumni') >= 0 || year.indexOf('completed') >= 0) {
      if (st !== 'passed_out') return false;
    } else if (year === 'year_back' || year.indexOf('year back') >= 0 || year === 'yearback') {
      if (st !== 'year_back') return false;
    } else if (year === '1' || year === '2' || year === '3') {
      if (st === 'passed_out') return false;
      if (studyYearNum(s) !== Number(year)) return false;
    } else if (year.indexOf('1st') >= 0 || year === 'i') {
      if (st === 'passed_out' || studyYearNum(s) !== 1) return false;
    } else if (year.indexOf('2nd') >= 0 || year === 'ii') {
      if (st === 'passed_out' || studyYearNum(s) !== 2) return false;
    } else if (year.indexOf('3rd') >= 0 || year === 'iii') {
      if (st === 'passed_out' || studyYearNum(s) !== 3) return false;
    } else if (year) {
      var yl = String(s.year || '').toLowerCase();
      if (yl.indexOf(year) === -1) return false;
    }
    if (admYear) {
      var ay = studentAdmissionYear(s);
      if (!ay || ay.indexOf(admYear) === -1) return false;
    }
    if (q) {
      var hay = [s.name, s.display_name, s.reg_no, s.dept, s.year, s.email, studentAdmissionYear(s), st].join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  // Group display order: by branch then name (already sorted from API; keep stable)
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;opacity:.7;">No students match your filters.</td></tr>';
    if (meta) meta.textContent = 'Showing 0 of ' + list.length + ' student account(s)';
    updateStuBulkBarCount();
    return;
  }

  var rows = filtered.map(function (s) {
    var key = studentListKey(s);
    var reg = s.reg_no || '—';
    var regAttr = s.reg_no ? escHtml(String(s.reg_no)) : '';
    var nameAttr = escHtml(String(s.name || s.display_name || reg));
    var nReq = Number(s.pending_profile_requests) || 0;
    var raisedCol = nReq > 0
      ? '<span class="badge pending" style="font-weight:800;">⚡ ' + nReq + ' raised</span>' +
        '<div style="margin-top:4px;"><button class="btn pr stu-act-btn" type="button" data-stu-action="goto-approvals" data-stu-reg="' +
        regAttr + '" style="padding:3px 8px;font-size:0.72rem;">Open Approvals</button></div>'
      : '<span style="font-size:0.75rem;opacity:.55;">—</span>';
    var lock = s.profile_edit_locked ? ' 🔒' : ' 🔓';
    var canToggle = !!(s.reg_no);
    var lockBtn = !canToggle
      ? '<span style="font-size:0.72rem;opacity:.6;">No reg no</span>'
      : (s.profile_edit_locked
        ? '<button class="btn gr stu-act-btn" type="button" data-stu-action="unlock" data-stu-reg="' + regAttr + '" data-stu-label="' + nameAttr + '">🔓 Unlock Edit</button>'
        : '<button class="btn stu-act-btn" type="button" style="background:#b45309;color:#fff;" data-stu-action="lock" data-stu-reg="' + regAttr + '" data-stu-label="' + nameAttr + '">🔒 Lock Edit</button>');
    var st = academicStatusOf(s);
    var statusBadge = st === 'passed_out'
      ? '<span class="badge" style="background:#e0e7ff;color:#3730a3;">Alumni</span>'
      : st === 'detained'
        ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Detained</span>'
        : st === 'year_back'
          ? '<span class="badge" style="background:#ffedd5;color:#9a3412;">Year Back</span>'
          : '';
    var batchHint = s.admission_academic_year
      ? '<div style="font-size:0.65rem;opacity:.65;">Batch ' + escHtml(s.admission_academic_year) + '</div>'
      : '';
    var cb = canToggle
      ? '<input type="checkbox" class="stu-select-cb" data-stu-reg="' + regAttr + '" title="Select for bulk lock/unlock" />'
      : '<input type="checkbox" disabled title="No reg number" />';
    var rowHi = nReq > 0 ? ' style="background:#fffbeb;"' : '';
    return '<tr data-stu-key="' + escHtml(key) + '" data-stu-reg="' + regAttr + '"' + rowHi + '>' +
      '<td style="width:36px;text-align:center;">' + cb + '</td>' +
      '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">' + escHtml(reg) + '</td>' +
      '<td><strong>' + escHtml(s.name || '—') + '</strong>' +
      (s.email ? '<div style="font-size:0.68rem;opacity:.7;">' + escHtml(s.email) + '</div>' : '') +
      '</td>' +
      '<td>' + escHtml(s.dept || '—') + '</td>' +
      '<td>' + escHtml(s.year || '—') + ' ' + statusBadge + batchHint + '</td>' +
      '<td>' + accountStatusBadge(s.account_status) + '</td>' +
      '<td>' + profileStatusBadge(s.profile_status) + lock + '</td>' +
      '<td>' + raisedCol + '</td>' +
      '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">' +
      '<button class="btn ol stu-act-btn" type="button" data-stu-action="view" data-stu-key="' + escHtml(key) + '">View</button>' +
      lockBtn +
      '</div></td>' +
      '</tr>';
  }).join('');

  tbody.innerHTML = rows;
  if (meta) {
    var ayLabel = (window._academicSettings && window._academicSettings.active_academic_year)
      ? (' · Active AY ' + window._academicSettings.active_academic_year)
      : '';
    meta.textContent = 'Showing ' + filtered.length + ' of ' + list.length +
      ' student account(s)' + ayLabel + ' · Study year, status, batch, profile, search';
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
        regAttrM + '" data-stu-label="' + nameAttrM + '">🔓 Open free edit</button>';
      html += '<span style="font-size:0.75rem;opacity:.75;">View-only — student can still raise edit requests (no unlock required).</span>';
    } else {
      html += '<button class="btn stu-act-btn" type="button" style="background:#b45309;color:#fff;" data-stu-action="lock" data-stu-reg="' +
        regAttrM + '" data-stu-label="' + nameAttrM + '">🔒 Set view-only</button>';
      html += '<span style="font-size:0.75rem;opacity:.75;">Student can raise edit requests anytime — see Raised edit request column.</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:12px 0 6px;">Account</div>';
  html += row('Email', s.email);
  html += row('Display name', s.display_name);
  html += row('Reg. Number', s.reg_no);
  html += row('Account status', s.account_status);

  html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 6px;">Core academic (DTE)</div>';
  html += row('Name', s.name);
  html += row('Branch / Department', s.dept);
  html += row('Year of Study', s.year);
  html += row('Admission batch', s.admission_academic_year || studentAdmissionYearSafe(s));
  html += row('Academic status', s.academic_status || 'active');
  html += row('Progress locked', s.progress_locked ? 'Yes (detain / year-back)' : 'No');
  html += row('Pass-out year', s.pass_out_academic_year);
  html += row('Father', s.father);
  html += row('CGPA', s.cgpa);
  html += row('Attendance', s.att);

  // HOD / Exam / Admin / Principal academic actions
  var cuAct = window.currentUser;
  if (s.reg_no && cuAct && (cuAct.role === 'admin' || cuAct.role === 'principal' || cuAct.role === 'hod' || cuAct.role === 'exam')) {
    var regA = escHtml(String(s.reg_no));
    html += '<div style="font-size:0.74rem;font-weight:700;color:var(--navy);margin:16px 0 8px;">Academic actions</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    if (cuAct.role !== 'exam') {
      html += '<button class="btn stu-act-btn" type="button" style="background:#991b1b;color:#fff;" data-stu-action="acad-detain" data-stu-reg="' + regA + '">Detain</button>';
      html += '<button class="btn stu-act-btn" type="button" style="background:#c2410c;color:#fff;" data-stu-action="acad-yearback" data-stu-reg="' + regA + '">Year Back</button>';
      html += '<button class="btn gr stu-act-btn" type="button" data-stu-action="acad-unlock" data-stu-reg="' + regA + '">Unlock progress</button>';
    }
    html += '<button class="btn stu-act-btn" type="button" style="background:#3730a3;color:#fff;" data-stu-action="acad-passout" data-stu-reg="' + regA + '">Mark Pass-out</button>';
    html += '<button class="btn ol stu-act-btn" type="button" data-stu-action="acad-set-admission" data-stu-reg="' + regA + '">Set admission year</button>';
    html += '</div>';
    html += '<p style="font-size:0.72rem;opacity:.75;margin-top:8px;">Detained / Year Back freeze auto-progress until HOD unlocks. Pass-out keeps login (read-only alumni portal).</p>';
  }

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

function studentAdmissionYearSafe(s) {
  if (!s) return '';
  if (s.admission_academic_year) return String(s.admission_academic_year);
  var extra = s.extra || {};
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
  }
  return (
    extra['Admission Academic Year'] ||
    extra['Year of Admission'] ||
    extra['Admission Year'] ||
    ''
  );
}

async function runStudentAcademicAction(action, reg) {
  if (!reg) {
    alert('No register number.');
    return;
  }
  var map = {
    'acad-detain': 'detain',
    'acad-yearback': 'year_back',
    'acad-unlock': 'unlock',
    'acad-passout': 'pass_out',
    'acad-set-admission': 'set_admission',
  };
  var apiAction = map[action];
  if (!apiAction) return;

  var body = { action: apiAction, reg_no: reg };
  if (apiAction === 'detain') {
    if (!confirm('Detain ' + reg + '?\nStudy year freezes until HOD unlocks progress.')) return;
    body.reason = prompt('Reason for detention (optional):', '') || 'Detained';
  } else if (apiAction === 'year_back') {
    if (!confirm('Apply Year Back for ' + reg + '?\nStudy year drops by one (min 1st) and freezes until unlock.')) return;
    var ty = prompt('Target study year (1, 2, or 3). Leave blank for automatic −1:', '');
    if (ty === '1' || ty === '2' || ty === '3') body.target_year = Number(ty);
    body.reason = prompt('Reason for year back (optional):', '') || 'Year back';
  } else if (apiAction === 'unlock') {
    if (!confirm('Unlock progress for ' + reg + ' and recompute study year from admission batch + active academic year?')) return;
    body.reason = 'Unlocked';
  } else if (apiAction === 'pass_out') {
    if (!confirm('Mark ' + reg + ' as Passed Out / Alumni?\nLogin stays active (read-only student portal).')) return;
    body.reason = prompt('Remarks (optional):', '') || 'Marked pass-out';
  } else if (apiAction === 'set_admission') {
    var ay = prompt('Admission academic year (batch), e.g. 2026-27:', studentAdmissionYearSafe(window._adminStudentByKey && Object.values(window._adminStudentByKey).find(function (x) { return String(x.reg_no).toUpperCase() === String(reg).toUpperCase(); }) || {}) || '');
    if (!ay) return;
    body.admission_academic_year = ay.trim();
    var et = prompt('Entry type: regular or lateral', 'regular');
    if (et && String(et).toLowerCase().indexOf('lat') === 0) {
      body.entry_type = 'lateral';
      body.entry_study_year = 2;
    } else {
      body.entry_type = 'regular';
      body.entry_study_year = 1;
    }
    body.reason = 'Admission year set';
  }

  try {
    var r = await fetch('/api/students/academic', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || !data.ok) {
      alert(data.error || 'Academic action failed');
      return;
    }
    showStuToast('Updated ' + reg + ' · ' + (data.academic && data.academic.year_label ? data.academic.year_label : apiAction));
    if (typeof window.renderAdminStudentDatabase === 'function') {
      await window.renderAdminStudentDatabase();
    }
    // Re-open view if possible
    var key = null;
    (window._adminStudentList || []).forEach(function (s) {
      if (String(s.reg_no || '').toUpperCase() === String(reg).toUpperCase()) key = studentListKey(s);
    });
    if (key && typeof window.viewAdminStudent === 'function') window.viewAdminStudent(key);
  } catch (err) {
    alert('Network error');
  }
}
window.runStudentAcademicAction = runStudentAcademicAction;

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
      ? '🔒 Profile set view-only for ' + regNo + ' (student can still raise edit requests).'
      : '🔓 Free edit open for ' + regNo + ' (optional; requests work either way).'
  );

  // Optimistic local update so button flips even before re-fetch finishes
  (window._adminStudentList || []).forEach(function (s) {
    if (String(s.reg_no || '') === String(regNo)) {
      s.profile_edit_locked = !!locked;
      if (s.extra && typeof s.extra === 'object') s.extra.profile_edit_locked = !!locked;
    }
  });
  // Also keep Student Data cache in sync (ACM / Exam / HOD Student Data view)
  (window._studentDataList || []).forEach(function (s) {
    if (String(s.reg_no || '') === String(regNo)) {
      s.profile_edit_locked = !!locked;
      if (s.extra && typeof s.extra === 'object') s.extra.profile_edit_locked = !!locked;
    }
  });
  filterAdminStudentList();

  // Hard refresh from server (cache-busted)
  await renderAdminStudentDatabase();
  // Re-open view modal on whichever desk is active (admin / principal / HOD)
  var pfxM = typeof activeStudentDbPrefix === 'function' ? activeStudentDbPrefix() : 'adStu';
  var modal =
    document.getElementById(pfxM + 'ViewModal') ||
    document.getElementById('adStuViewModal') ||
    document.getElementById('priStuViewModal') ||
    document.getElementById('facStuViewModal');
  if (modal && (modal.style.display === 'flex' || modal.style.display === 'block')) {
    var match = (window._adminStudentList || []).find(function (s) {
      return String(s.reg_no || '') === String(regNo);
    });
    if (match) viewAdminStudent(studentListKey(match));
  }
  // Re-paint Student Data list + modal so HOD/ACM/Exam see lock flip immediately
  try {
    if (typeof window.filterStudentDataList === 'function' && (window._studentDataList || []).length) {
      window.filterStudentDataList();
    }
    if (typeof window.viewStudentDataRow === 'function') {
      var openSd = false;
      ;['adSd_modal', 'facSd_modal', 'priSd_modal'].forEach(function (id) {
        var m = document.getElementById(id);
        if (m && m.style.display === 'flex') openSd = true;
      });
      if (openSd) {
        var sdMatch = (window._studentDataList || []).find(function (s) {
          return String(s.reg_no || '') === String(regNo);
        });
        if (sdMatch && sdMatch.key != null) window.viewStudentDataRow(String(sdMatch.key));
      }
    }
  } catch (eSd) { /* ignore */ }
  return res;
}
window.setStudentProfileEditLock = setStudentProfileEditLock;

/** Selected reg numbers from the *active* Student Database panel checkboxes. */
function getSelectedStudentRegNos() {
  var pfx = typeof activeStudentDbPrefix === 'function' ? activeStudentDbPrefix() : 'adStu';
  var root = typeof studentDbRootForPrefix === 'function'
    ? studentDbRootForPrefix(pfx)
    : (document.getElementById('adStudents') || document);
  var regs = [];
  var seen = {};
  // Prefer checkboxes inside the active panel; fall back to any visible student-db checkboxes
  var cbs = root.querySelectorAll('.stu-select-cb:checked');
  if (!cbs.length) {
    cbs = document.querySelectorAll(
      '#adStudents .stu-select-cb:checked, #priStudentsDesk .stu-select-cb:checked, #facBranchStudents .stu-select-cb:checked'
    );
  }
  cbs.forEach(function (cb) {
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

// Refresh notifications while a session is active (skip background tabs)
setInterval(function () {
  if (document.hidden) return;
  if (window.currentUser && typeof window.renderLiveNotifications === 'function') {
    window.renderLiveNotifications();
  }
}, 45000);
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

  function accountsRoot() {
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
    return root;
  }

  /** selectedIds(scope): "active" (default) or "trash" */
  function selectedIds(scope) {
    scope = scope || "active";
    var root = accountsRoot();
    var ids = [];
    var seen = {};
    root.querySelectorAll(".acc-select-cb:checked").forEach(function (cb) {
      var mode = cb.getAttribute("data-mode") || "active";
      if (scope === "trash") {
        if (mode !== "trash") return;
      } else {
        if (mode === "trash") return;
      }
      var n = Number(cb.getAttribute("data-acc-id"));
      if (Number.isFinite(n) && n > 0 && !seen[n]) {
        seen[n] = true;
        ids.push(n);
      }
    });
    return ids;
  }

  function updateScopeCounts(root) {
    root = root || accountsRoot();
    var activeN = 0, trashN = 0;
    var seenA = {}, seenT = {};
    root.querySelectorAll(".acc-select-cb:checked").forEach(function (cb) {
      var id = cb.getAttribute("data-acc-id");
      if (!id) return;
      if (cb.getAttribute("data-mode") === "trash") {
        if (!seenT[id]) { seenT[id] = true; trashN++; }
      } else {
        if (!seenA[id]) { seenA[id] = true; activeN++; }
      }
    });
    root.querySelectorAll('.acc-selected-count[data-bulk-scope="active"]').forEach(function (el) {
      el.textContent = activeN + " selected";
    });
    root.querySelectorAll('.acc-selected-count[data-bulk-scope="trash"]').forEach(function (el) {
      el.textContent = trashN + " selected";
    });
    // Fallback for any count without scope attribute
    root.querySelectorAll(".acc-selected-count:not([data-bulk-scope])").forEach(function (el) {
      el.textContent = activeN + " selected";
    });
  }

  window.getSelectedAccountIds = function () { return selectedIds("active"); };
  window.getSelectedTrashIds = function () { return selectedIds("trash"); };

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
    if (action === "bulk_restore") {
      var rIds = selectedIds("trash");
      if (!rIds.length) {
        showAccToast("Select one or more trash accounts first (left checkboxes).", true);
        return;
      }
      var r11 = await usersMutate({ action: "bulk_restore", ids: rIds });
      console.log("[acc-action] bulk_restore result", r11);
      if (r11.ok) {
        showAccToast("↩ Restored " + (r11.restored != null ? r11.restored : rIds.length) + " account(s).");
        refreshAccounts();
      } else {
        showAccToast("Bulk restore failed: " + (r11.error || JSON.stringify(r11)), true);
      }
      return;
    }
    if (action === "bulk_purge") {
      var pIds = selectedIds("trash");
      if (!pIds.length) {
        showAccToast("Select one or more trash accounts first (left checkboxes).", true);
        return;
      }
      if (!window.confirm(
        "PERMANENTLY delete " + pIds.length + " account(s) from trash?\n\nThis cannot be undone."
      )) return;
      var r12 = await usersMutate({ action: "bulk_hard_delete", ids: pIds });
      console.log("[acc-action] bulk_purge result", r12);
      if (r12.ok) {
        showAccToast("☠ Permanently deleted " + (r12.purged != null ? r12.purged : pIds.length) + " account(s).");
        refreshAccounts();
      } else {
        showAccToast("Bulk purge failed: " + (r12.error || JSON.stringify(r12)), true);
      }
      return;
    }
  }

  // Global handlers used by bulk bar / legacy names
  window.bridgeBulkDeleteAccounts = function () { return runAction("bulk_trash"); };
  window.bridgeBulkDeleteDemoAccounts = function () { return runAction("bulk_demo"); };
  window.bridgeBulkRestoreAccounts = function () { return runAction("bulk_restore"); };
  window.bridgeBulkPurgeAccounts = function () { return runAction("bulk_purge"); };
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
      if (t.closest(".acc-bulk-restore-btn")) {
        e.preventDefault();
        e.stopPropagation();
        runAction("bulk_restore");
        return;
      }
      if (t.closest(".acc-bulk-purge-btn")) {
        e.preventDefault();
        e.stopPropagation();
        runAction("bulk_purge");
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
        var scope = t.getAttribute("data-bulk-scope") || "active";
        var root = t.closest("#bridgeAccountApprovals, #bridgeUserManagement") || document;
        root.querySelectorAll(".acc-select-cb").forEach(function (cb) {
          var mode = cb.getAttribute("data-mode") || "active";
          if (scope === "trash") {
            if (mode === "trash") cb.checked = on;
          } else {
            if (mode !== "trash") cb.checked = on;
          }
        });
        updateScopeCounts(root);
      } else if (t.classList && t.classList.contains("acc-select-cb")) {
        var root2 = t.closest("#bridgeAccountApprovals, #bridgeUserManagement") || document;
        updateScopeCounts(root2);
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
        if (action === "goto-approvals") {
          // Jump to Approvals desk with this reg pre-filled in search
          try {
            var role = (window.currentUser && window.currentUser.role) || '';
            var sec =
              role === 'principal' ? 'priProfileApprovals' :
              role === 'hod' ? 'facApprovals' :
              'adApprovals';
            var q = reg || '';
            if (typeof writeApprovalUrlFilters === 'function') {
              writeApprovalUrlFilters({ section: sec, ap_q: q, ap_type: 'student' });
            } else {
              try {
                var u = new URL(window.location.href);
                u.searchParams.set('section', sec);
                u.searchParams.set('ap_q', q);
                u.searchParams.set('ap_type', 'student');
                history.replaceState(null, '', u.toString());
              } catch (e0) { /* ignore */ }
            }
            if (typeof window.showSec === 'function') {
              var nav =
                document.getElementById(role === 'principal' ? 'priProfileApprovalsNav' : '') ||
                document.querySelector('[onclick*="' + sec + '"]') ||
                document.querySelector('[data-fac="approvals"]');
              window.showSec(sec, nav || null);
            }
            if (typeof window.renderProfileRequestApprovals === 'function') {
              setTimeout(function () { window.renderProfileRequestApprovals(); }, 80);
            }
          } catch (e1) {
            console.warn('[stu-action] goto-approvals', e1);
            alert('Open Approvals from the sidebar to review raised edit requests.');
          }
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
        if (action && action.indexOf("acad-") === 0) {
          if (typeof window.runStudentAcademicAction === "function") {
            window.runStudentAcademicAction(action, reg);
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
      if (
        t.id === "adStuSelectAll" ||
        t.id === "priStuSelectAll" ||
        t.id === "facStuSelectAll" ||
        (t.classList && t.classList.contains("stu-select-all-cb"))
      ) {
        var on = !!t.checked;
        // Scope select-all to the panel that owns this checkbox (HOD / Principal / Admin)
        var root =
          t.closest("#adStudents, #priStudentsDesk, #facBranchStudents") ||
          (typeof studentDbRootForPrefix === "function"
            ? studentDbRootForPrefix(
                typeof activeStudentDbPrefix === "function" ? activeStudentDbPrefix() : "adStu"
              )
            : null) ||
          document.getElementById("adStudents") ||
          document;
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
      (s.current_study_year === 1 ? '1st Year' : '') ||
      (s.current_study_year === 2 ? '2nd Year' : '') ||
      (s.current_study_year === 3 ? '3rd Year' : '') ||
      sdPick(extra, ['Current Year', 'Year', 'Academic Year']) ||
      ''
    );
  }

  function sdAdmissionYear(s) {
    if (s.admission_academic_year) return String(s.admission_academic_year).trim();
    var extra = s.extra || {};
    return (
      sdPick(extra, [
        'Admission Academic Year',
        'Year of Admission',
        'Year Of Admission',
        'Admission Year',
      ]) || ''
    );
  }

  function sdNormalizeRow(s) {
    var extra = s.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    var st = String(s.academic_status || (s.academic && s.academic.academic_status) || 'active').toLowerCase();
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
      current_study_year: s.current_study_year != null ? Number(s.current_study_year) : null,
      academic_status: st,
      progress_locked: !!s.progress_locked,
      entry_type: s.entry_type === 'lateral' ? 'lateral' : 'regular',
      entry_study_year: s.entry_study_year != null ? Number(s.entry_study_year) : 1,
      is_alumni: st === 'passed_out' || !!s.is_alumni,
      admission_year: sdAdmissionYear(Object.assign({}, s, { extra: extra })),
      admission_academic_year: s.admission_academic_year || sdAdmissionYear(Object.assign({}, s, { extra: extra })),
      pass_out_academic_year: s.pass_out_academic_year || null,
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
      profile_edit_locked:
        s.profile_edit_locked === true ||
        s.profile_edit_locked === 'true' ||
        extra.profile_edit_locked === true ||
        extra.profile_edit_locked === 'true',
      extra: extra,
      raw: s,
    };
  }

  /** Inject status filter + modern year options into Student Data toolbars. */
  function upgradeStudentDataFilters() {
    ;['adSd', 'facSd', 'priSd'].forEach(function (p) {
      var yearSel = document.getElementById(p + '_year');
      if (yearSel) {
        var prev = yearSel.value || '';
        yearSel.innerHTML =
          '<option value="">All Study Years</option>' +
          '<option value="1">1st Year</option>' +
          '<option value="2">2nd Year</option>' +
          '<option value="3">3rd Year</option>' +
          '<option value="alumni">Alumni</option>';
        if (prev === '1st' || prev === '1st Year') prev = '1';
        if (prev === '2nd' || prev === '2nd Year') prev = '2';
        if (prev === '3rd' || prev === '3rd Year') prev = '3';
        if (prev === '1' || prev === '2' || prev === '3' || prev === 'alumni') yearSel.value = prev;
      }
      if (!document.getElementById(p + '_status') && yearSel && yearSel.parentNode && yearSel.parentNode.parentNode) {
        var wrap = document.createElement('div');
        wrap.className = 'fg';
        wrap.style.margin = '0';
        wrap.innerHTML =
          '<label style="font-size:0.72rem;font-weight:700;">Status</label>' +
          '<select id="' + p + '_status" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" ' +
          'onchange="window.filterStudentDataList&&window.filterStudentDataList()">' +
          '<option value="active_like">Active (default)</option>' +
          '<option value="active">Active only</option>' +
          '<option value="detained">Detained</option>' +
          '<option value="year_back">Year Back</option>' +
          '<option value="passed_out">Passed Out</option>' +
          '<option value="all">All</option></select>';
        var grid = yearSel.parentNode.parentNode;
        grid.appendChild(wrap);
        // Widen grid if possible
        try {
          grid.style.gridTemplateColumns = '2fr 1.2fr 1fr 1fr 1fr 1fr';
        } catch (e) { /* ignore */ }
      }
      var admLab = document.querySelector('label[for="' + p + '_adm"]');
      // Update admission label text via sibling
      var admSel = document.getElementById(p + '_adm');
      if (admSel && admSel.previousElementSibling && /Admission/i.test(admSel.previousElementSibling.textContent || '')) {
        admSel.previousElementSibling.textContent = 'Batch (Adm. Year)';
      }
    });
  }
  window.upgradeStudentDataFilters = upgradeStudentDataFilters;

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
    var p = prefix === 'fac' ? 'facSd' : prefix === 'pri' ? 'priSd' : 'adSd';
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
      '<div class="info-box" style="background:#eff6ff;border-color:#93c5fd;">💡 Student roster is also under main <strong>Student Management</strong> → <strong>Roster</strong>. This menu stays for a while.</div>' +
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
      '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
      '<thead style="position:sticky;top:0;background:var(--surface);z-index:1;"><tr>' +
      '<th style="padding:10px 8px;text-align:left;">Reg. No</th>' +
      '<th style="padding:10px 8px;text-align:left;">Name of the student</th>' +
      '<th style="padding:10px 8px;text-align:left;">Father name</th>' +
      '<th style="padding:10px 8px;text-align:left;">Branch</th>' +
      '<th style="padding:10px 8px;text-align:left;width:90px;">View</th>' +
      '</tr></thead>' +
      '<tbody id="' + p + '_tbody"><tr><td colspan="5" style="padding:24px;text-align:center;opacity:.7;">Open this menu to load students.</td></tr></tbody>' +
      '</table></div></div>' +
      // Modal
      '<div id="' + p + '_modal" class="sd-view-modal" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99990;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;" ' +
      'onclick="if(event.target===this){window.closeStudentDataView&&window.closeStudentDataView();}">' +
      '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 60px rgba(0,0,0,.28);display:flex;flex-direction:column;" onclick="event.stopPropagation();">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:#fff;z-index:1;flex-shrink:0;">' +
      '<h3 style="margin:0;font-size:1.05rem;color:var(--navy);">Student Profile</h3>' +
      '<button type="button" class="btn ol sd-modal-close" style="min-width:44px;min-height:40px;font-weight:700;" ' +
      'onclick="window.closeStudentDataView&&window.closeStudentDataView();return false;">✕ Close</button>' +
      '</div>' +
      '<div id="' + p + '_modalBody" style="padding:16px 18px 20px;"></div>' +
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
    var year = ((document.getElementById(p + '_year') || {}).value || '').trim().toLowerCase();
    var statusF = ((document.getElementById(p + '_status') || {}).value || 'active_like').trim();
    var adm = ((document.getElementById(p + '_adm') || {}).value || '').trim();
    return (window._studentDataList || []).filter(function (s) {
      if (!branchMatch(s.dept, branch)) return false;
      var st = String(s.academic_status || 'active').toLowerCase();
      if (statusF === 'active_like') {
        if (st === 'passed_out') return false;
      } else if (statusF === 'active') {
        if (st !== 'active') return false;
      } else if (statusF === 'detained' || statusF === 'year_back' || statusF === 'passed_out') {
        if (st !== statusF) return false;
      }
      if (year === 'alumni' || year === 'completed') {
        if (st !== 'passed_out') return false;
      } else if (year === '1' || year === '2' || year === '3') {
        if (st === 'passed_out') return false;
        var n = s.current_study_year != null ? Number(s.current_study_year) : null;
        if (n == null) {
          if (!yearMatch(s.year, year === '1' ? '1st' : year === '2' ? '2nd' : '3rd')) return false;
        } else if (n !== Number(year)) return false;
      } else if (year) {
        if (!yearMatch(s.year, year)) return false;
      }
      if (adm) {
        var ay = String(s.admission_academic_year || s.admission_year || '');
        if (ay.indexOf(adm) === -1) return false;
      }
      if (q) {
        var hay = [s.reg_no, s.name, s.father, s.mother, s.dept, s.year, s.phone, s.email, s.admission_year, st]
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
        ' student(s) · Branch / Study year / Status / Batch';
    }
  }

  function paintTable(p) {
    var tbody = document.getElementById(p + '_tbody');
    if (!tbody) return;
    var all = window._studentDataList || [];
    var filtered = getFilteredList(p);
    paintStats(p, filtered, all);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:28px;text-align:center;opacity:.7;">No students match these filters.</td></tr>';
      return;
    }
    // Sort: branch → name
    filtered = filtered.slice().sort(function (a, b) {
      var c = String(a.dept || '').localeCompare(String(b.dept || ''));
      if (c) return c;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var cuPaint = window.currentUser;
    var canLockPaint = !!(
      cuPaint &&
      (cuPaint.role === 'admin' ||
        cuPaint.role === 'principal' ||
        cuPaint.role === 'hod' ||
        cuPaint.role === 'acm' ||
        cuPaint.role === 'exam')
    );
    tbody.innerHTML = filtered.map(function (s) {
      var keyJs = JSON.stringify(String(s.key));
      var st = String(s.academic_status || 'active');
      var stBadge = st === 'passed_out'
        ? ' <span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:0.65rem;">Alumni</span>'
        : st === 'detained'
          ? ' <span class="badge" style="background:#fee2e2;color:#991b1b;font-size:0.65rem;">Detained</span>'
          : st === 'year_back'
            ? ' <span class="badge" style="background:#ffedd5;color:#9a3412;font-size:0.65rem;">Year Back</span>'
            : '';
      var latBadge = s.entry_type === 'lateral'
        ? ' <span class="badge" style="background:#fef3c7;color:#92400e;font-size:0.65rem;">Lateral</span>'
        : '';
      var lockIcon = s.profile_edit_locked ? ' 🔒' : ' 🔓';
      var regAttrSd = s.reg_no ? sdEsc(String(s.reg_no)) : '';
      var nameAttrSd = sdEsc(String(s.name || s.reg_no || ''));
      var lockBtnSd = '';
      if (canLockPaint && s.reg_no) {
        lockBtnSd = s.profile_edit_locked
          ? '<button class="btn gr stu-act-btn" type="button" style="padding:6px 10px;font-size:0.75rem;font-weight:700;" ' +
            'data-stu-action="unlock" data-stu-reg="' + regAttrSd + '" data-stu-label="' + nameAttrSd +
            '">🔓 Unlock</button>'
          : '<button class="btn stu-act-btn" type="button" style="padding:6px 10px;font-size:0.75rem;font-weight:700;background:#b45309;color:#fff;" ' +
            'data-stu-action="lock" data-stu-reg="' + regAttrSd + '" data-stu-label="' + nameAttrSd +
            '">🔒 Lock</button>';
      }
      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:10px 8px;font-family:JetBrains Mono,monospace;font-size:0.78rem;white-space:nowrap;">' + sdEsc(s.reg_no || '—') + lockIcon + '</td>' +
        '<td style="padding:10px 8px;"><strong>' + sdEsc(s.name) + '</strong>' + latBadge + '</td>' +
        '<td style="padding:10px 8px;">' + sdEsc(s.father || '—') + '</td>' +
        '<td style="padding:10px 8px;font-size:0.82rem;">' + sdEsc(s.dept || '—') +
        '<div style="font-size:0.68rem;opacity:.7;">' + sdEsc(s.year || '—') + stBadge +
        (s.admission_academic_year || s.admission_year
          ? ' · Batch ' + sdEsc(s.admission_academic_year || s.admission_year)
          : '') +
        '</div></td>' +
        '<td style="padding:10px 8px;"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
        '<button type="button" class="btn pr" style="padding:6px 12px;font-size:0.78rem;font-weight:700;" ' +
        "onclick='window.viewStudentDataRow&&window.viewStudentDataRow(" + keyJs + ")'>View</button>" +
        lockBtnSd +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  window.filterStudentDataList = function () {
    // Only paint the visible panel (painting all three froze UI on large lists)
    paintTable(activePrefix());
  };

  window.renderStudentDataBrowser = async function (secId) {
    ensureStudentDataMenu();
    try { upgradeStudentDataFilters(); } catch (e) { /* ignore */ }
    var p = prefixFromSec(secId);
    var tbody = document.getElementById(p + '_tbody');
    var cu = window.currentUser;
    if (!cu) {
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;opacity:.75;">Sign in as Admin / Principal / HOD to view student data.</td></tr>';
      }
      return;
    }
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;opacity:.7;">Loading students…</td></tr>';
    }
    var data = null;
    try {
      // lite=1: no profile photos / no N+1 pending counts (was freezing browser 10+ min)
      var r = await fetch('/api/students?include_alumni=1&lite=1&_ts=' + Date.now(), {
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
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#991b1b;">Failed to load students. Session may have expired — please log in again.</td></tr>';
      }
      return;
    }
    var list = data.students.map(sdNormalizeRow);
    window._studentDataList = list;
    window._studentDataByKey = {};
    list.forEach(function (s) { window._studentDataByKey[s.key] = s; });

    // Populate admission batch filter — only canonical YYYY-YY labels (no bare 2019 / 2025)
    var years = {};
    list.forEach(function (s) {
      var ay = String(s.admission_academic_year || s.admission_year || '').trim();
      if (!ay) return;
      // Normalize bare year → YYYY-YY
      var bare = ay.match(/^(20\d{2})$/);
      if (bare) {
        var st = Number(bare[1]);
        ay = st + '-' + String((st + 1) % 100).padStart(2, '0');
      }
      if (/^20\d{2}-\d{2}$/.test(ay)) years[ay] = true;
    });
    try { upgradeStudentDataFilters(); } catch (e) { /* ignore */ }
    ;['adSd', 'facSd', 'priSd'].forEach(function (px) {
      var sel = document.getElementById(px + '_adm');
      if (!sel) return;
      var prev = sel.value || '';
      var opts = '<option value="">All Batches</option>';
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

    // Paint only panels that exist; prefer active first for speed
    var activeP = activePrefix();
    paintTable(activeP);
    ;['adSd', 'facSd', 'priSd'].forEach(function (px) {
      if (px !== activeP && document.getElementById(px + '_tbody')) paintTable(px);
    });
  };

  window.viewStudentDataRow = function (key) {
    var s = window._studentDataByKey && window._studentDataByKey[key];
    if (!s) {
      alert('Student not found.');
      return;
    }
    var p = activePrefix();
    // Fallback: find any open modal body if prefix mismatch
    var body = document.getElementById(p + '_modalBody');
    var modal = document.getElementById(p + '_modal');
    if (!body || !modal) {
      ;['adSd', 'facSd', 'priSd'].forEach(function (px) {
        if (!body && document.getElementById(px + '_modalBody')) {
          body = document.getElementById(px + '_modalBody');
          modal = document.getElementById(px + '_modal');
        }
      });
    }
    if (!body || !modal) return;

    function row(label, val) {
      return '<div style="display:grid;grid-template-columns:minmax(140px,38%) 1fr;gap:10px 14px;padding:9px 0;border-bottom:1px solid #e8eef5;font-size:0.86rem;">' +
        '<div style="font-weight:700;color:#1e3a5f;letter-spacing:.01em;">' + sdEsc(label) + '</div>' +
        '<div style="word-break:break-word;color:#0f172a;font-weight:500;">' + sdEsc(val == null || val === '' ? '—' : val) + '</div></div>';
    }

    var extra = s.extra || {};
    var photo = extra['Profile Photo'] || extra.profile_photo || extra.photo;
    var photoHtml = '';
    if (photo && typeof photo === 'string' && photo.indexOf('data:image/') === 0) {
      photoHtml = '<img src="' + photo + '" alt="Photo" style="width:96px;height:114px;object-fit:cover;border-radius:10px;border:2px solid #cbd5e1;background:#f8fafc;flex-shrink:0;" />';
    } else {
      photoHtml = '<div style="width:96px;height:114px;border-radius:10px;border:2px dashed #cbd5e1;background:#f8fafc;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:#94a3b8;flex-shrink:0;">No photo</div>';
    }

    var html =
      '<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px;padding-bottom:14px;border-bottom:2px solid #0f2d5c;">' +
      photoHtml +
      '<div style="flex:1;min-width:0;">' +
      '<div style="font-size:1.15rem;font-weight:800;color:#0f2d5c;line-height:1.3;">' + sdEsc(s.name || '—') + '</div>' +
      '<div style="margin-top:6px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:0.85rem;color:#334155;">' +
      sdEsc(s.reg_no || '—') + '</div>' +
      '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">' +
      '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#e8f0fe;color:#1a4fa0;font-size:0.72rem;font-weight:700;">' +
      sdEsc(s.dept || '—') + '</span>' +
      (s.year ? '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:0.72rem;font-weight:700;">' +
        sdEsc(s.year) + '</span>' : '') +
      '</div></div></div>';

    html += '<div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1a4fa0;margin:4px 0 6px;background:#e8f0fe;padding:5px 8px;border-radius:6px;">Core details (DTE)</div>';
    html += row('Register Number', s.reg_no);
    html += row('Name of the student', s.name);
    html += row('Father name', s.father);
    html += row('Mother name', s.mother);
    html += row('Branch', s.dept);
    html += row('Year of Study', s.year);
    html += row('Admission batch', s.admission_academic_year || s.admission_year);
    html += row('Academic status', s.academic_status || 'active');
    html += row('Progress locked', s.progress_locked ? 'Yes' : 'No');
    html += row('Pass-out year', s.pass_out_academic_year);
    html += row('Date of Birth', s.dob);
    html += row('Gender', s.gender);
    html += row('Category', s.category);
    html += row('Religion', s.religion);
    html += row('Caste', s.caste);
    html += row('Phone / WhatsApp', s.phone);
    html += row('Parents Mobile', s.parent_phone);
    html += row('Email', s.email);

    var cuSd = window.currentUser;
    // Profile My Profile edit lock / unlock — Admin, Principal, HOD, ACM, Exam
    if (
      s.reg_no &&
      cuSd &&
      (cuSd.role === 'admin' ||
        cuSd.role === 'principal' ||
        cuSd.role === 'hod' ||
        cuSd.role === 'acm' ||
        cuSd.role === 'exam')
    ) {
      var regProf = sdEsc(String(s.reg_no));
      var nameProf = sdEsc(String(s.name || s.reg_no));
      var lockedProf = !!s.profile_edit_locked;
      html += '<div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1a4fa0;margin:16px 0 8px;background:#e8f0fe;padding:5px 8px;border-radius:6px;">Profile edit access</div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">';
      if (lockedProf) {
        html += '<span class="badge" style="background:#fef3c7;color:#92400e;">Edit Locked</span>';
        html += '<button class="btn gr stu-act-btn" type="button" data-stu-action="unlock" data-stu-reg="' +
          regProf + '" data-stu-label="' + nameProf + '">🔓 Unlock Profile Edit</button>';
        html += '<span style="font-size:0.75rem;opacity:.75;">Student can request My Profile changes after unlock.</span>';
      } else {
        html += '<span class="badge active">Edit Open</span>';
        html += '<button class="btn stu-act-btn" type="button" style="background:#b45309;color:#fff;" data-stu-action="lock" data-stu-reg="' +
          regProf + '" data-stu-label="' + nameProf + '">🔒 Lock Profile Edit</button>';
        html += '<span style="font-size:0.75rem;opacity:.75;">Student can currently submit profile edit requests.</span>';
      }
      html += '</div>';
    }
    if (s.reg_no && cuSd && (cuSd.role === 'admin' || cuSd.role === 'principal' || cuSd.role === 'hod' || cuSd.role === 'exam')) {
      var regSd = sdEsc(String(s.reg_no));
      html += '<div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1a4fa0;margin:16px 0 8px;background:#e8f0fe;padding:5px 8px;border-radius:6px;">Academic actions</div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">';
      if (cuSd.role !== 'exam') {
        html += '<button class="btn stu-act-btn" type="button" style="background:#991b1b;color:#fff;" data-stu-action="acad-detain" data-stu-reg="' + regSd + '">Detain</button>';
        html += '<button class="btn stu-act-btn" type="button" style="background:#c2410c;color:#fff;" data-stu-action="acad-yearback" data-stu-reg="' + regSd + '">Year Back</button>';
        html += '<button class="btn gr stu-act-btn" type="button" data-stu-action="acad-unlock" data-stu-reg="' + regSd + '">Unlock progress</button>';
      }
      html += '<button class="btn stu-act-btn" type="button" style="background:#3730a3;color:#fff;" data-stu-action="acad-passout" data-stu-reg="' + regSd + '">Pass-out</button>';
      html += '<button class="btn ol stu-act-btn" type="button" data-stu-action="acad-set-admission" data-stu-reg="' + regSd + '">Set admission year</button>';
      html += '</div>';
    }

    var skip = {
      profile_edit_locked: 1, imported_from_excel: 1, imported_at: 1, imported_missing_ece: 1,
      email_source: 1, 'Profile Photo': 1, profile_photo: 1, photo: 1, Photo: 1,
    };
    var keys = Object.keys(extra).filter(function (k) { return !skip[k]; }).sort();
    if (keys.length) {
      html += '<div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1a4fa0;margin:16px 0 6px;background:#e8f0fe;padding:5px 8px;border-radius:6px;">Full profile (' + keys.length + ' fields)</div>';
      keys.forEach(function (k) {
        var v = extra[k];
        if (typeof v === 'string' && v.indexOf('data:image/') === 0) return;
        if (v == null || String(v).trim() === '') return;
        html += row(k, v);
      });
    }

    html +=
      '<div style="margin-top:18px;display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:linear-gradient(transparent,#fff 30%);padding-top:12px;">' +
      '<button type="button" class="btn ol sd-modal-close" style="min-height:42px;padding:8px 18px;font-weight:700;" ' +
      'onclick="window.closeStudentDataView&&window.closeStudentDataView();return false;">Close</button></div>';

    body.innerHTML = html;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.closeStudentDataView = function () {
    ;['adSd_modal', 'facSd_modal', 'priSd_modal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m) m.style.display = 'none';
    });
    document.querySelectorAll('.sd-view-modal').forEach(function (m) {
      m.style.display = 'none';
    });
    document.body.style.overflow = '';
  };

  // Escape key closes student data modal
  if (!window._sdEscapeBound) {
    window._sdEscapeBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') window.closeStudentDataView && window.closeStudentDataView();
    });
  }

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

  /* ============================================================
   * ATTENDANCE MANAGEMENT — live, HOD branch-scoped
   * Replaces prototype demoAtt roster + fake submit.
   * ============================================================ */
  var OFFICIAL_ATT_BRANCHES = [
    'Civil Engineering',
    'Computer Science and Engineering',
    'Electronics and Communication Engineering',
    'Mechanical Engineering',
  ];

  function attEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attNormalizeBranch(input) {
    if (!input) return '';
    var raw = String(input).replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    var lower = raw.toLowerCase();
    if (OFFICIAL_ATT_BRANCHES.indexOf(raw) >= 0) return raw;
    if (lower.indexOf('civil') >= 0) return 'Civil Engineering';
    if (lower.indexOf('electron') >= 0 || lower.indexOf('ece') >= 0 || lower.indexOf('e&c') >= 0) {
      return 'Electronics and Communication Engineering';
    }
    if (lower.indexOf('computer') >= 0 || lower === 'cse' || lower.indexOf('cs and') >= 0) {
      return 'Computer Science and Engineering';
    }
    if (lower.indexOf('mech') >= 0) return 'Mechanical Engineering';
    return raw;
  }

  function attHodBranch(user) {
    if (!user) return '';
    var b = attNormalizeBranch(user.branch);
    if (b && OFFICIAL_ATT_BRANCHES.indexOf(b) >= 0) return b;
    var key = String(user.reg_no || user.display_name || user.email || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (key.indexOf('HODCE') >= 0 || key.indexOf('HODCIVIL') >= 0) return 'Civil Engineering';
    if (key.indexOf('HODCS') >= 0 || key.indexOf('HODCSE') >= 0) return 'Computer Science and Engineering';
    if (key.indexOf('HODEC') >= 0 || key.indexOf('HODECE') >= 0) return 'Electronics and Communication Engineering';
    if (key.indexOf('HODME') >= 0 || key.indexOf('HODMECH') >= 0) return 'Mechanical Engineering';
    return b || '';
  }

  function attBranchesMatch(a, b) {
    var na = attNormalizeBranch(a);
    var nb = attNormalizeBranch(b);
    if (!na || !nb) return false;
    return na.toLowerCase() === nb.toLowerCase();
  }

  function ensureAttYearSelect() {
    var existing = document.getElementById('attYear');
    if (existing) {
      ensureAttFormFieldOrder();
      return existing;
    }
    var branchEl = document.getElementById('attBranch');
    var dateEl = document.getElementById('attDate');
    var anchor = branchEl || dateEl;
    if (!anchor) return null;
    var row = anchor.closest('.form-row');
    if (!row) return null;
    var fg = document.createElement('div');
    fg.className = 'fg';
    fg.id = 'attYearFg';
    fg.innerHTML =
      '<label>Year / Class</label>' +
      '<select id="attYear">' +
      '<option value="">Select year</option>' +
      '<option value="I">I Year</option>' +
      '<option value="II">II Year</option>' +
      '<option value="III">III Year</option>' +
      '</select>';
    // Prefer next to Branch (Year first, then Subject)
    var branchFg = branchEl && branchEl.closest('.fg');
    if (branchFg && branchFg.parentNode === row) {
      if (branchFg.nextSibling) row.insertBefore(fg, branchFg.nextSibling);
      else row.appendChild(fg);
    } else {
      var dateParent = dateEl && dateEl.closest('.fg');
      if (dateParent && dateParent.parentNode === row) {
        if (dateParent.nextSibling) row.insertBefore(fg, dateParent.nextSibling);
        else row.appendChild(fg);
      } else {
        row.appendChild(fg);
      }
    }
    ensureAttFormFieldOrder();
    return document.getElementById('attYear');
  }

  /** Layout: Branch | Year  ·  Date | Subject (type) — Year before Subject. */
  function ensureAttFormFieldOrder() {
    var branchEl = document.getElementById('attBranch');
    var yearEl = document.getElementById('attYear');
    var dateEl = document.getElementById('attDate');
    var subjEl = document.getElementById('attSubject');
    if (!branchEl || !yearEl || !dateEl || !subjEl) return;
    var branchFg = branchEl.closest('.fg');
    var yearFg = yearEl.closest('.fg') || document.getElementById('attYearFg');
    var dateFg = dateEl.closest('.fg');
    var subjFg = subjEl.closest('.fg');
    if (!branchFg || !yearFg || !dateFg || !subjFg) return;
    var row1 = branchFg.parentNode;
    var row2 = dateFg.parentNode;
    if (!row1 || !row2) return;
    // Row 1: Branch, Year
    if (yearFg.parentNode !== row1 || branchFg.nextElementSibling !== yearFg) {
      row1.insertBefore(yearFg, branchFg.nextSibling);
    }
    // Row 2: Date, Subject
    if (subjFg.parentNode !== row2 || dateFg.nextElementSibling !== subjFg) {
      row2.insertBefore(subjFg, dateFg.nextSibling);
    }
  }

  function ensureAttHistoryHost() {
    var step1 = document.getElementById('attStep1');
    if (!step1) return null;
    var host = document.getElementById('attHistoryHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'attHistoryHost';
    host.style.marginTop = '14px';
    step1.appendChild(host);
    return host;
  }

  /**
   * Live DTE attendance dashboard: subject-wise + semester-wise %.
   * ≥75% eligible · <75% HOD decides · ≤65% critical (still HOD).
   */
  function ensureAttDashboard() {
    var step1 = document.getElementById('attStep1');
    if (!step1) return null;
    var dash = document.getElementById('attDashHost');
    if (dash) return dash;
    dash = document.createElement('div');
    dash.id = 'attDashHost';
    dash.style.marginTop = '16px';
    dash.innerHTML =
      '<div class="card" style="padding:0;overflow:hidden;border:1px solid var(--border);border-radius:12px;">' +
      '<div class="card-hd" style="padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">' +
      '<div><h3 style="margin:0;font-size:0.95rem;">📊 Attendance dashboard (DTE)</h3>' +
      '<p style="margin:4px 0 0;font-size:0.75rem;opacity:.78;">' +
      'Subject-wise &amp; semester-wise. <strong>≥75% Eligible</strong> · ' +
      '<strong>&lt;75% HOD decides</strong> · <strong>≤65% Critical</strong> (HOD still decides).</p></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;">' +
      '<div><label style="font-size:0.68rem;font-weight:700;">Mode</label><br>' +
      '<select id="attDashMode" style="padding:7px 10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.82rem;">' +
      '<option value="dashboard">Current term</option>' +
      '<option value="weekly">This week</option>' +
      '<option value="monthly">This month</option></select></div>' +
      '<div><label style="font-size:0.68rem;font-weight:700;">View</label><br>' +
      '<select id="attDashView" style="padding:7px 10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.82rem;">' +
      '<option value="overall">Overall %</option>' +
      '<option value="subject">Subject-wise</option>' +
      '<option value="semester">Semester-wise</option></select></div>' +
      '<div><label style="font-size:0.68rem;font-weight:700;">From</label><br>' +
      '<input type="date" id="attDashFrom" style="padding:6px 8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.68rem;font-weight:700;">To</label><br>' +
      '<input type="date" id="attDashTo" style="padding:6px 8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<button type="button" class="btn ol" id="attDashReload" style="padding:8px 12px;">↻ Load</button>' +
      '<button type="button" class="btn go" id="attDashCsv" style="padding:8px 12px;">⬇ CSV</button>' +
      '</div></div>' +
      '<div id="attDashKpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;padding:12px 16px;background:#f8fafc;border-bottom:1px solid var(--border);"></div>' +
      '<div id="attDashMeta" style="padding:8px 16px;font-size:0.78rem;opacity:.8;"></div>' +
      '<div id="attDashTable" style="padding:0 12px 16px;overflow-x:auto;max-height:480px;"></div>' +
      '</div>';
    // Insert dashboard above history register
    var hist = document.getElementById('attHistoryHost');
    if (hist && hist.parentNode === step1) step1.insertBefore(dash, hist);
    else step1.appendChild(dash);

    var reload = function () {
      window.loadAttDashboard && window.loadAttDashboard();
    };
    var modeEl = document.getElementById('attDashMode');
    var viewEl = document.getElementById('attDashView');
    var btn = document.getElementById('attDashReload');
    var csv = document.getElementById('attDashCsv');
    if (modeEl && !modeEl.__bound) {
      modeEl.__bound = true;
      modeEl.addEventListener('change', reload);
    }
    if (viewEl && !viewEl.__bound) {
      viewEl.__bound = true;
      viewEl.addEventListener('change', reload);
    }
    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', reload);
    }
    if (csv && !csv.__bound) {
      csv.__bound = true;
      csv.addEventListener('click', function () {
        window.exportAttDashboardCsv && window.exportAttDashboardCsv();
      });
    }
    setTimeout(reload, 200);
    return dash;
  }

  function attDashBandBadge(band, pct) {
    var p = pct != null ? pct + '%' : '—';
    if (band === 'eligible') {
      return '<span class="badge active" title="Auto eligible">✓ ' + p + ' Eligible</span>';
    }
    if (band === 'critical') {
      return (
        '<span class="badge" style="background:#fee2e2;color:#991b1b;" title="≤65% critical — HOD decides">⚠ ' +
        p +
        ' Critical</span>'
      );
    }
    return (
      '<span class="badge pending" title="Below 75% — HOD decides">⚡ ' + p + ' HOD</span>'
    );
  }

  function attDashHodActions(row, scope) {
    // scope: overall | subject | semester
    var reg = row.reg || '';
    var canDecide = row.band !== 'eligible';
    if (!canDecide) {
      return '<span style="font-size:0.72rem;opacity:.6;">Auto eligible</span>';
    }
    var cur = row.hod_decision || 'pending';
    var subj = scope === 'subject' ? row.subject || '' : '';
    var sem = scope === 'semester' && row.semester != null ? row.semester : '';
    return (
      '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">' +
      '<select class="att-hod-dec" data-reg="' +
      attEsc(reg) +
      '" data-subject="' +
      attEsc(subj) +
      '" data-sem="' +
      attEsc(String(sem)) +
      '" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border);font-size:0.72rem;max-width:120px;">' +
      '<option value="pending"' +
      (cur === 'pending' ? ' selected' : '') +
      '>Pending</option>' +
      '<option value="eligible"' +
      (cur === 'eligible' ? ' selected' : '') +
      '>Eligible</option>' +
      '<option value="not_eligible"' +
      (cur === 'not_eligible' ? ' selected' : '') +
      '>Not eligible</option>' +
      '</select>' +
      '<button type="button" class="btn pr att-hod-save" data-reg="' +
      attEsc(reg) +
      '" data-subject="' +
      attEsc(subj) +
      '" data-sem="' +
      attEsc(String(sem)) +
      '" style="padding:3px 8px;font-size:0.7rem;">Save</button>' +
      '</div>'
    );
  }

  window.loadAttDashboard = async function loadAttDashboard() {
    var kpis = document.getElementById('attDashKpis');
    var meta = document.getElementById('attDashMeta');
    var table = document.getElementById('attDashTable');
    if (!table) return;

    var branch =
      (document.getElementById('attBranch') && document.getElementById('attBranch').value) ||
      (window.currentUser && window.currentUser.role === 'hod' ? attHodBranch(window.currentUser) : '') ||
      '';
    var year = (document.getElementById('attYear') && document.getElementById('attYear').value) || '';
    var mode = (document.getElementById('attDashMode') && document.getElementById('attDashMode').value) || 'dashboard';
    var view = (document.getElementById('attDashView') && document.getElementById('attDashView').value) || 'overall';
    var from = (document.getElementById('attDashFrom') && document.getElementById('attDashFrom').value) || '';
    var to = (document.getElementById('attDashTo') && document.getElementById('attDashTo').value) || '';

    table.innerHTML = '<p style="opacity:.7;padding:12px;">Loading attendance report…</p>';
    if (kpis) kpis.innerHTML = '';

    try {
      var qs =
        'mode=' +
        encodeURIComponent(mode) +
        (branch ? '&branch=' + encodeURIComponent(branch) : '') +
        (year ? '&year=' + encodeURIComponent(year) : '') +
        (from ? '&from=' + encodeURIComponent(from) : '') +
        (to ? '&to=' + encodeURIComponent(to) : '') +
        '&_ts=' +
        Date.now();
      var apiClient = window.api;
      if (!apiClient || !apiClient.get) throw new Error('API not ready');
      var data = await apiClient.get('/api/attendance/report?' + qs);
      if (!data || data.ok === false) {
        table.innerHTML =
          '<p style="color:#991b1b;padding:12px;">' +
          attEsc((data && data.error) || 'Could not load report') +
          '</p>';
        return;
      }
      window._attDashData = data;
      var f = data.filters || {};
      if (document.getElementById('attDashFrom') && f.from && !from) {
        document.getElementById('attDashFrom').value = f.from;
      }
      if (document.getElementById('attDashTo') && f.to && !to) {
        document.getElementById('attDashTo').value = f.to;
      }

      var k = data.kpis || {};
      if (kpis) {
        kpis.innerHTML =
          kpiCard('Sessions', k.sessions != null ? k.sessions : '—', '#1a4fa0') +
          kpiCard('Students', k.students != null ? k.students : '—', '#0f172a') +
          kpiCard('Avg %', k.avg_percent != null ? k.avg_percent + '%' : '—', '#0369a1') +
          kpiCard('Eligible ≥75%', k.eligible != null ? k.eligible : '—', '#065f46') +
          kpiCard('HOD decide', k.hod_decision != null ? k.hod_decision : '—', '#b45309') +
          kpiCard('Critical ≤65%', k.critical != null ? k.critical : '—', '#991b1b');
      }
      if (meta) {
        meta.innerHTML =
          'Branch: <strong>' +
          attEsc(f.branch || 'all') +
          '</strong> · AY <strong>' +
          attEsc(f.academic_year || '—') +
          '</strong> · ' +
          attEsc(f.from || '') +
          ' → ' +
          attEsc(f.to || '') +
          (data.rules && data.rules.note
            ? '<div style="margin-top:4px;font-size:0.72rem;">' + attEsc(data.rules.note) + '</div>'
            : '');
      }

      var students = data.students || [];
      if (!students.length) {
        table.innerHTML =
          '<p style="opacity:.7;padding:12px;">No attendance units in this range. Mark sessions first, then reload.</p>';
        return;
      }

      var html = '';
      if (view === 'subject') {
        html =
          '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr style="background:#f8fafc;text-align:left;">' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Reg</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Name</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Subject</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Sem</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Held</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">P</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">A</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">%</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">HOD decision</th>' +
          '</tr></thead><tbody>';
        students.forEach(function (s) {
          (s.by_subject || []).forEach(function (sub) {
            html +=
              '<tr style="border-bottom:1px solid var(--border);' +
              (sub.band === 'critical' ? 'background:#fef2f2;' : sub.band === 'hod_decision' ? 'background:#fffbeb;' : '') +
              '">' +
              '<td style="padding:7px;font-family:monospace;font-size:0.72rem;">' +
              attEsc(s.reg) +
              '</td>' +
              '<td style="padding:7px;">' +
              attEsc(s.name) +
              '</td>' +
              '<td style="padding:7px;">' +
              attEsc(sub.subject) +
              '</td>' +
              '<td style="padding:7px;">' +
              (sub.semester != null ? sub.semester : '—') +
              '</td>' +
              '<td style="padding:7px;">' +
              sub.held +
              '</td>' +
              '<td style="padding:7px;color:#065f46;font-weight:700;">' +
              sub.present +
              '</td>' +
              '<td style="padding:7px;color:#991b1b;">' +
              sub.absent +
              '</td>' +
              '<td style="padding:7px;">' +
              attDashBandBadge(sub.band, sub.percent) +
              '</td>' +
              '<td style="padding:7px;">' +
              attDashHodActions(sub, 'subject') +
              '</td></tr>';
          });
        });
        html += '</tbody></table>';
      } else if (view === 'semester') {
        html =
          '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr style="background:#f8fafc;text-align:left;">' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Reg</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Name</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Semester</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Held</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">P</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">A</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">%</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">HOD decision</th>' +
          '</tr></thead><tbody>';
        students.forEach(function (s) {
          (s.by_semester || []).forEach(function (sm) {
            html +=
              '<tr style="border-bottom:1px solid var(--border);' +
              (sm.band === 'critical' ? 'background:#fef2f2;' : sm.band === 'hod_decision' ? 'background:#fffbeb;' : '') +
              '">' +
              '<td style="padding:7px;font-family:monospace;font-size:0.72rem;">' +
              attEsc(s.reg) +
              '</td>' +
              '<td style="padding:7px;">' +
              attEsc(s.name) +
              '</td>' +
              '<td style="padding:7px;font-weight:700;">Sem ' +
              (sm.semester != null ? sm.semester : '—') +
              '</td>' +
              '<td style="padding:7px;">' +
              sm.held +
              '</td>' +
              '<td style="padding:7px;color:#065f46;font-weight:700;">' +
              sm.present +
              '</td>' +
              '<td style="padding:7px;color:#991b1b;">' +
              sm.absent +
              '</td>' +
              '<td style="padding:7px;">' +
              attDashBandBadge(sm.band, sm.percent) +
              '</td>' +
              '<td style="padding:7px;">' +
              attDashHodActions(sm, 'semester') +
              '</td></tr>';
          });
        });
        html += '</tbody></table>';
      } else {
        html =
          '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr style="background:#f8fafc;text-align:left;">' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">#</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Reg</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Name</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Year</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Held</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">P</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">A</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Overall %</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">Subjects</th>' +
          '<th style="padding:8px;border-bottom:1px solid var(--border);">HOD decision</th>' +
          '</tr></thead><tbody>';
        students.forEach(function (s, i) {
          var subHint = (s.by_subject || [])
            .slice(0, 3)
            .map(function (x) {
              return attEsc(x.subject) + ' ' + (x.percent != null ? x.percent + '%' : '—');
            })
            .join(' · ');
          if ((s.by_subject || []).length > 3) subHint += '…';
          html +=
            '<tr style="border-bottom:1px solid var(--border);' +
            (s.band === 'critical' ? 'background:#fef2f2;' : s.band === 'hod_decision' ? 'background:#fffbeb;' : '') +
            '">' +
            '<td style="padding:7px;opacity:.65;">' +
            (i + 1) +
            '</td>' +
            '<td style="padding:7px;font-family:monospace;font-size:0.72rem;">' +
            attEsc(s.reg) +
            '</td>' +
            '<td style="padding:7px;font-weight:600;">' +
            attEsc(s.name) +
            '</td>' +
            '<td style="padding:7px;">' +
            attEsc(s.year_label || '—') +
            '</td>' +
            '<td style="padding:7px;">' +
            s.held +
            '</td>' +
            '<td style="padding:7px;color:#065f46;font-weight:700;">' +
            s.present +
            '</td>' +
            '<td style="padding:7px;color:#991b1b;">' +
            s.absent +
            '</td>' +
            '<td style="padding:7px;">' +
            attDashBandBadge(s.band, s.percent) +
            '</td>' +
            '<td style="padding:7px;font-size:0.72rem;opacity:.85;max-width:220px;">' +
            (subHint || '—') +
            '</td>' +
            '<td style="padding:7px;">' +
            attDashHodActions(s, 'overall') +
            '</td></tr>';
        });
        html += '</tbody></table>';
      }
      table.innerHTML = html;

      // Bind HOD decision saves
      table.querySelectorAll('.att-hod-save').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var reg = btn.getAttribute('data-reg') || '';
          var subject = btn.getAttribute('data-subject') || '';
          var sem = btn.getAttribute('data-sem') || '';
          var sel = table.querySelector(
            '.att-hod-dec[data-reg="' +
              CSS.escape(reg) +
              '"][data-subject="' +
              CSS.escape(subject) +
              '"][data-sem="' +
              CSS.escape(sem) +
              '"]',
          );
          if (!sel) {
            // fallback without CSS.escape
            sel = btn.previousElementSibling;
          }
          var decision = sel && sel.value ? sel.value : 'pending';
          window.saveAttHodDecision &&
            window.saveAttHodDecision({
              reg_no: reg,
              subject: subject,
              semester: sem ? Number(sem) : null,
              decision: decision,
              branch: branch,
              academic_year: (data.filters && data.filters.academic_year) || '',
            });
        });
      });
    } catch (e) {
      table.innerHTML =
        '<p style="color:#991b1b;padding:12px;">' + attEsc(e.message || String(e)) + '</p>';
    }

    function kpiCard(label, value, color) {
      return (
        '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 12px;">' +
        '<div style="font-size:0.68rem;opacity:.7;font-weight:700;">' +
        attEsc(label) +
        '</div>' +
        '<div style="font-size:1.25rem;font-weight:800;color:' +
        color +
        ';">' +
        attEsc(String(value)) +
        '</div></div>'
      );
    }
  };

  window.saveAttHodDecision = async function saveAttHodDecision(payload) {
    try {
      var apiClient = window.api;
      if (!apiClient || !apiClient.post) throw new Error('API not ready');
      var res = await apiClient.post('/api/attendance/report', payload || {});
      if (!res || res.ok === false) {
        alert((res && res.error) || 'Could not save HOD decision');
        return;
      }
      alert(
        'Saved: ' +
          (payload.reg_no || '') +
          ' → ' +
          (payload.decision || '') +
          (payload.subject ? ' · ' + payload.subject : '') +
          (payload.semester != null ? ' · Sem ' + payload.semester : ''),
      );
      window.loadAttDashboard && window.loadAttDashboard();
    } catch (e) {
      alert(e.message || String(e));
    }
  };

  window.exportAttDashboardCsv = function exportAttDashboardCsv() {
    var data = window._attDashData;
    if (!data || !data.students || !data.students.length) {
      alert('Load the dashboard first.');
      return;
    }
    var view = (document.getElementById('attDashView') && document.getElementById('attDashView').value) || 'overall';
    var rows = [];
    if (view === 'subject') {
      rows.push(['Reg', 'Name', 'Subject', 'Semester', 'Held', 'Present', 'Absent', 'Percent', 'Band', 'HOD decision']);
      data.students.forEach(function (s) {
        (s.by_subject || []).forEach(function (sub) {
          rows.push([
            s.reg,
            s.name,
            sub.subject,
            sub.semester != null ? sub.semester : '',
            sub.held,
            sub.present,
            sub.absent,
            sub.percent != null ? sub.percent : '',
            sub.band,
            sub.hod_decision || '',
          ]);
        });
      });
    } else if (view === 'semester') {
      rows.push(['Reg', 'Name', 'Semester', 'Held', 'Present', 'Absent', 'Percent', 'Band', 'HOD decision']);
      data.students.forEach(function (s) {
        (s.by_semester || []).forEach(function (sm) {
          rows.push([
            s.reg,
            s.name,
            sm.semester != null ? sm.semester : '',
            sm.held,
            sm.present,
            sm.absent,
            sm.percent != null ? sm.percent : '',
            sm.band,
            sm.hod_decision || '',
          ]);
        });
      });
    } else {
      rows.push(['Reg', 'Name', 'Year', 'Held', 'Present', 'Absent', 'Percent', 'Band', 'HOD decision']);
      data.students.forEach(function (s) {
        rows.push([
          s.reg,
          s.name,
          s.year_label || '',
          s.held,
          s.present,
          s.absent,
          s.percent != null ? s.percent : '',
          s.band,
          s.hod_decision || '',
        ]);
      });
    }
    var csv = rows
      .map(function (r) {
        return r
          .map(function (c) {
            var t = String(c == null ? '' : c);
            if (/[",\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
            return t;
          })
          .join(',');
      })
      .join('\n');
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance-' + view + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 400);
  };

  /** Map full branch name → C-20 code for curriculum API. */
  function attBranchCode(branchName) {
    var n = attNormalizeBranch(branchName || '').toLowerCase();
    if (n.indexOf('civil') >= 0) return 'CE';
    if (n.indexOf('computer') >= 0 || n.indexOf('cse') >= 0) return 'CSE';
    if (n.indexOf('electron') >= 0 || n.indexOf('ece') >= 0) return 'ECE';
    if (n.indexOf('mech') >= 0) return 'ME';
    return '';
  }

  /**
   * DTE term parity from calendar date (auto forever — no hard-coded year).
   * June–December → odd (Sem 1/3/5); January–May → even (Sem 2/4/6).
   * Academic year flips every June (e.g. Jun 2027 → AY 2027-28 odd).
   */
  function attParseLocalDate(input) {
    if (input instanceof Date && !isNaN(input.getTime())) return input;
    var s = String(input || '').trim();
    if (s) {
      var p = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (p) return new Date(Number(p[1]), Number(p[2]) - 1, Number(p[3]));
    }
    return new Date();
  }

  function attCalendarTermInfo(dateInput) {
    var d = attParseLocalDate(dateInput);
    var y = d.getFullYear();
    var m = d.getMonth() + 1; // 1–12
    var odd = m >= 6;
    var start = odd ? y : y - 1;
    var ay = start + '-' + String((start + 1) % 100).padStart(2, '0');
    return {
      parity: odd ? 'odd' : 'even',
      academic_year: ay,
      label: odd ? 'Odd semester (Jun–Dec)' : 'Even semester (Jan–May)',
      short: odd ? 'Odd' : 'Even',
    };
  }

  /** Year I/II/III (or 1/2/3) → study year number. */
  function attStudyYearNum(year) {
    var y = String(year || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!y || y === 'ALL' || y === 'ALL YEARS') return null;
    if (y === 'III' || y === '3' || y === 'III YEAR' || y.indexOf('III') === 0) return 3;
    if (y === 'II' || y === '2' || y === 'II YEAR' || y.indexOf('II') === 0) return 2;
    if (y === 'I' || y === '1' || y === 'I YEAR' || y.indexOf('I') === 0) return 1;
    var n = Number(y);
    if (n === 1 || n === 2 || n === 3) return n;
    return null;
  }

  /** Study year + term parity → single running semester (1–6). */
  function attSemesterFromYearAndParity(studyYear, parity) {
    var yn = typeof studyYear === 'number' ? studyYear : attStudyYearNum(studyYear);
    if (yn !== 1 && yn !== 2 && yn !== 3) return null;
    return parity === 'odd' ? 2 * yn - 1 : 2 * yn;
  }

  /**
   * Subjects to offer for attendance:
   * - Year selected → only that year's running semester for the session date
   * - No year → all three years' running semesters for current term only (1/3/5 or 2/4/6)
   */
  function attSemestersForYear(year, dateInput) {
    var dateEl = document.getElementById('attDate');
    var d = dateInput || (dateEl && dateEl.value) || new Date();
    var term = attCalendarTermInfo(d);
    var yn = attStudyYearNum(year);
    if (yn) {
      var sem = attSemesterFromYearAndParity(yn, term.parity);
      return sem != null ? [sem] : [];
    }
    return term.parity === 'odd' ? [1, 3, 5] : [2, 4, 6];
  }

  /** 12-hour period label: 9 → "9:00–10:00 AM", 12 → "12:00–1:00 PM", 17 → "5:00–6:00 PM". */
  function attHour12(h) {
    var n = Number(h);
    if (!Number.isFinite(n)) return '';
    var ap = n >= 12 ? 'PM' : 'AM';
    var h12 = n % 12;
    if (h12 === 0) h12 = 12;
    return { h12: h12, ap: ap };
  }

  function attPeriodLabel12(startHour) {
    var s = Number(startHour);
    var e = s + 1;
    var a = attHour12(s);
    var b = attHour12(e);
    if (!a || !b) return String(startHour);
    if (a.ap === b.ap) return a.h12 + ':00–' + b.h12 + ':00 ' + b.ap;
    return a.h12 + ':00 ' + a.ap + ' – ' + b.h12 + ':00 ' + b.ap;
  }

  function attFormatClock12(hhmm) {
    var m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return String(hhmm || '');
    var h = Number(m[1]);
    var min = m[2];
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + min + ' ' + ap;
  }

  /**
   * Ensure Subject field is a dropdown (not free-type). Rebuilds the control once
   * so Year / Branch / Date changes can repopulate real curriculum options.
   */
  function ensureAttSubjectInput() {
    var el = document.getElementById('attSubject');
    if (!el) return null;
    // Already a proper select dropdown
    if (el.tagName === 'SELECT' && el.getAttribute('data-curr') === '1') {
      ensureAttFormFieldOrder();
      attBindSubjectReloaders();
      return el;
    }
    var fg = el.closest ? el.closest('.fg') : el.parentNode;
    var prev =
      el.tagName === 'SELECT'
        ? el.value === '__other__'
          ? (document.getElementById('attSubjectOther') && document.getElementById('attSubjectOther').value) || ''
          : el.value || ''
        : el.value || '';
    var wrap = document.createElement('div');
    wrap.id = 'attSubjectWrap';
    wrap.innerHTML =
      '<select id="attSubject" data-curr="1" ' +
      'style="width:100%;padding:9px;border-radius:8px;border:1.5px solid var(--border);font-size:0.88rem;background:#fff;">' +
      '<option value="">— Select subject —</option>' +
      '<option value="__other__">Other (type yourself)</option>' +
      '</select>' +
      '<input id="attSubjectOther" type="text" placeholder="Type subject code & name" ' +
      'style="display:none;width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1.5px solid var(--border);font-size:0.88rem;" />' +
      '<div id="attSemHint" style="margin-top:6px;font-size:0.75rem;opacity:.8;line-height:1.35;">' +
      'Select <strong>Year / Class</strong> and <strong>Branch</strong> to load official subjects for the running semester.' +
      '</div>';
    if (fg) {
      fg.innerHTML = '<label id="attSubjectLabel">Subject</label>';
      fg.appendChild(wrap);
    } else if (el.parentNode) {
      el.parentNode.replaceChild(wrap, el);
    }
    var sel = document.getElementById('attSubject');
    if (sel && prev && prev !== '__other__') {
      // keep previous value if still present after load
      sel.setAttribute('data-prev', prev);
    }
    attBindOtherToggle(sel);
    ensureAttFormFieldOrder();
    attBindSubjectReloaders();
    return document.getElementById('attSubject');
  }

  function attEnsureSemHint(sel) {
    if (!sel || document.getElementById('attSemHint')) return;
    var wrap = document.getElementById('attSubjectWrap') || sel.parentNode;
    if (!wrap) return;
    var lab = wrap.parentNode && wrap.parentNode.querySelector('label');
    if (lab && !lab.id) lab.id = 'attSubjectLabel';
    var hint = document.createElement('div');
    hint.id = 'attSemHint';
    hint.style.cssText = 'margin-top:6px;font-size:0.75rem;opacity:.8;line-height:1.35;';
    if (sel.nextSibling) wrap.insertBefore(hint, sel.nextSibling);
    else wrap.appendChild(hint);
  }

  function attBindSubjectReloaders() {
    function reload() {
      window.loadAttCurriculumSubjects && window.loadAttCurriculumSubjects();
    }
    var yearEl = document.getElementById('attYear');
    var branchEl = document.getElementById('attBranch');
    var dateEl = document.getElementById('attDate');
    if (yearEl && !yearEl.__attSubjBound) {
      yearEl.__attSubjBound = true;
      yearEl.addEventListener('change', reload);
    }
    if (branchEl && !branchEl.__attSubjBound) {
      branchEl.__attSubjBound = true;
      branchEl.addEventListener('change', reload);
    }
    if (dateEl && !dateEl.__attSubjBound) {
      dateEl.__attSubjBound = true;
      dateEl.addEventListener('change', reload);
    }
  }

  /**
   * Syllabus scheme for a class year on a date.
   * Admission 2020-21…2024-25 → C-20; 2025-26+ → C-25.
   * AY 2026-27: I & II Year → C-25; III Year → C-20.
   */
  function attSchemeForStudyYear(studyYear, dateInput) {
    var yn = typeof studyYear === 'number' ? studyYear : attStudyYearNum(studyYear);
    if (yn !== 1 && yn !== 2 && yn !== 3) return null;
    var term = attCalendarTermInfo(dateInput || new Date());
    var start = Number(String(term.academic_year || '').split('-')[0]);
    if (!Number.isFinite(start)) return null;
    var admStart = start - (yn - 1);
    if (admStart >= 2025) return 'C-25';
    if (admStart >= 2020 && admStart <= 2024) return 'C-20';
    return null;
  }

  function attBindOtherToggle(sel) {
    if (!sel || sel.__otherBound) return;
    sel.__otherBound = true;
    sel.addEventListener('change', function () {
      var o = document.getElementById('attSubjectOther');
      if (!o) return;
      if (sel.value === '__other__') {
        o.style.display = '';
        o.focus();
      } else {
        o.style.display = 'none';
        o.value = '';
      }
    });
  }

  function attSubjectOptionValue(sub) {
    if (!sub) return '';
    var code = String(sub.code || '').trim();
    var name = String(sub.name || '').trim();
    if (code && name) return code + ' — ' + name;
    return code || name || '';
  }

  /**
   * Load official C-20 / C-25 subjects into the attendance Subject dropdown
   * for the selected Branch + Year and the running semester (from date).
   */
  window.loadAttCurriculumSubjects = async function loadAttCurriculumSubjects() {
    ensureAttSubjectInput();
    ensureAttFormFieldOrder();
    var year = (document.getElementById('attYear') && document.getElementById('attYear').value) || '';
    var branch =
      (document.getElementById('attBranch') && document.getElementById('attBranch').value) || '';
    var dateVal =
      (document.getElementById('attDate') && document.getElementById('attDate').value) || '';
    var term = attCalendarTermInfo(dateVal || new Date());
    var studyY = attStudyYearNum(year);
    var scheme = attSchemeForStudyYear(studyY, dateVal);
    var runningSem = studyY ? attSemesterFromYearAndParity(studyY, term.parity) : null;
    var branchCode = attBranchCode(branch);
    var lab = document.getElementById('attSubjectLabel');
    if (lab) lab.textContent = 'Subject';
    var sel = document.getElementById('attSubject');
    var hint = document.getElementById('attSemHint');
    var prev =
      (sel && sel.getAttribute('data-prev')) ||
      (sel && sel.value && sel.value !== '__other__' ? sel.value : '') ||
      '';

    function paintHint(msg, isWarn) {
      if (!hint) return;
      hint.style.color = isWarn ? '#b45309' : '';
      hint.innerHTML = msg;
    }

    if (!sel) return;

    if (!studyY) {
      sel.innerHTML =
        '<option value="">— Select Year / Class first —</option>' +
        '<option value="__other__">Other (type yourself)</option>';
      attBindOtherToggle(sel);
      paintHint('Select <strong>Year / Class</strong> to load subjects for the running semester (odd/even from date).');
      return;
    }
    if (!branchCode) {
      sel.innerHTML =
        '<option value="">— Select Branch first —</option>' +
        '<option value="__other__">Other (type yourself)</option>';
      attBindOtherToggle(sel);
      paintHint('Select <strong>Branch</strong> to load official subjects.');
      return;
    }
    if (!scheme) {
      sel.innerHTML =
        '<option value="">— Scheme unknown —</option>' +
        '<option value="__other__">Other (type yourself)</option>';
      attBindOtherToggle(sel);
      paintHint('Could not resolve syllabus scheme for this year. Use Other to type the subject.', true);
      return;
    }

    sel.innerHTML = '<option value="">Loading subjects…</option>';
    paintHint(
      'Year ' +
        studyY +
        ' · <strong>' +
        attEsc(scheme) +
        '</strong>' +
        (runningSem != null ? ' · Sem ' + runningSem : '') +
        ' · ' +
        attEsc(term.short || '') +
        ' term — loading…',
    );

    var list = [];
    try {
      var api = window.api;
      var url =
        '/api/curriculum?scheme=' +
        encodeURIComponent(scheme) +
        '&branch=' +
        encodeURIComponent(branchCode);
      var res = api && typeof api.get === 'function' ? await api.get(url) : null;
      if (!res && typeof fetch === 'function') {
        var fr = await fetch(url, { credentials: 'same-origin' });
        res = fr.ok ? await fr.json() : null;
      }
      if (res && Array.isArray(res.subjects)) list = res.subjects;
      else if (res && res.by_semester && typeof res.by_semester === 'object') {
        Object.keys(res.by_semester).forEach(function (k) {
          var arr = res.by_semester[k];
          if (Array.isArray(arr)) list = list.concat(arr);
        });
      }
    } catch (eLoad) {
      list = [];
    }

    // Prefer running semester; if empty (e.g. C-25 Sem 3+ not listed yet), fall back to year band then all
    var filtered = list.slice();
    var filterNote = '';
    if (runningSem != null) {
      var bySem = list.filter(function (s) {
        return Number(s.semester) === Number(runningSem);
      });
      if (bySem.length) {
        filtered = bySem;
        filterNote = 'Showing Sem ' + runningSem + ' subjects only.';
      } else {
        // Year band: Y1→1-2, Y2→3-4, Y3→5-6
        var lo = 2 * studyY - 1;
        var hi = 2 * studyY;
        var byYear = list.filter(function (s) {
          var sm = Number(s.semester);
          return sm >= lo && sm <= hi;
        });
        if (byYear.length) {
          filtered = byYear;
          filterNote =
            'No subjects listed yet for Sem ' +
            runningSem +
            ' — showing Year ' +
            studyY +
            ' list (Sem ' +
            lo +
            '–' +
            hi +
            ').';
        } else if (list.length) {
          filtered = list;
          filterNote =
            'Sem ' +
            runningSem +
            ' not in syllabus yet — showing all loaded ' +
            scheme +
            ' subjects for this branch.';
        } else {
          filtered = [];
          filterNote =
            'No official ' +
            scheme +
            ' subjects loaded for this branch/year yet. Use Other to type.';
        }
      }
    }

    // Sort by semester then code
    filtered.sort(function (a, b) {
      var sa = Number(a.semester) || 0;
      var sb = Number(b.semester) || 0;
      if (sa !== sb) return sa - sb;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });

    var opts = ['<option value="">— Select subject —</option>'];
    var lastSem = null;
    filtered.forEach(function (s) {
      var sm = Number(s.semester);
      if (sm && sm !== lastSem && (runningSem == null || filtered.length > 8)) {
        opts.push(
          '<option disabled value="">—— Semester ' + sm + ' ——</option>',
        );
        lastSem = sm;
      }
      var val = attSubjectOptionValue(s);
      if (!val) return;
      var label = val + (s.is_audit ? ' (audit)' : '');
      opts.push('<option value="' + attEsc(val) + '">' + attEsc(label) + '</option>');
    });
    opts.push('<option value="__other__">Other (type yourself)</option>');
    sel.innerHTML = opts.join('');
    attBindOtherToggle(sel);

    // Restore previous selection when still in list
    if (prev) {
      var found = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) {
          sel.value = prev;
          found = true;
          break;
        }
      }
      if (!found) {
        // Try match by code prefix
        var codeOnly = String(prev).split(/[—–-]/)[0].trim();
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].value.indexOf(codeOnly) === 0) {
            sel.value = sel.options[j].value;
            found = true;
            break;
          }
        }
      }
      sel.removeAttribute('data-prev');
    }

    paintHint(
      'Year ' +
        studyY +
        ' · <strong>' +
        attEsc(scheme) +
        '</strong> · ' +
        attEsc(branchCode) +
        (runningSem != null ? ' · Sem ' + runningSem : '') +
        ' · ' +
        attEsc(term.label || term.short || '') +
        (filtered.length ? ' · <strong>' + filtered.length + ' subjects</strong>' : '') +
        (filterNote ? '<br/>' + filterNote : '') +
        (filtered.length
          ? ''
          : '<br/>Pick <strong>Other</strong> to type a subject until the syllabus list is complete.'),
      !filtered.length,
    );
  };

  function attResolveSubjectValue() {
    var el = document.getElementById('attSubject');
    if (!el) return '';
    if (el.tagName === 'SELECT' && el.value === '__other__') {
      var other = document.getElementById('attSubjectOther');
      return other ? String(other.value || '').trim() : '';
    }
    return String(el.value || '').trim();
  }

  /** 9 AM–6 PM hourly period chips in 12-hour format (continuous multi-select). */
  function ensureAttPeriodSlots() {
    var timeEl = document.getElementById('attTime');
    if (!timeEl) return;
    ensureAttClockTime12h();
    var host = document.getElementById('attPeriodHost');
    if (host && host.getAttribute('data-fmt') === '12h') return host;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    var fg = timeEl.closest('.fg') || timeEl.parentNode;
    host = document.createElement('div');
    host.id = 'attPeriodHost';
    host.className = 'fg';
    host.setAttribute('data-fmt', '12h');
    host.style.gridColumn = '1 / -1';
    var hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    var chips = hours
      .map(function (h) {
        var lab = attPeriodLabel12(h);
        return (
          '<label class="att-period-chip" style="display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.8rem;user-select:none;background:#fff;">' +
          '<input type="checkbox" class="att-period-cb" value="' +
          h +
          '" style="width:16px;height:16px;" />' +
          '<span>' +
          lab +
          '</span></label>'
        );
      })
      .join('');
    host.innerHTML =
      '<label style="display:block;margin-bottom:6px;font-weight:700;">Period slots (9:00 AM – 6:00 PM)</label>' +
      '<p style="margin:0 0 8px;font-size:0.78rem;opacity:.8;line-height:1.4;">' +
      'Select <strong>every hour</strong> taught. Continuous class (e.g. 9 AM–12 PM) = check 3 slots → students get <strong>3 attendance units</strong> (not just 1).</p>' +
      '<div id="attPeriodChips" style="display:flex;flex-wrap:wrap;gap:8px;">' +
      chips +
      '</div>' +
      '<div id="attPeriodSummary" style="margin-top:8px;font-size:0.82rem;font-weight:700;color:var(--navy);"></div>';
    if (fg && fg.parentNode) {
      if (fg.nextSibling) fg.parentNode.insertBefore(host, fg.nextSibling);
      else fg.parentNode.appendChild(host);
    }
    // Hide raw single time or keep as secondary
    if (timeEl.closest('.fg')) {
      var lab = timeEl.closest('.fg').querySelector('label');
      if (lab) lab.textContent = 'Clock time (optional note, 12-hour)';
    }
    host.querySelectorAll('.att-period-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        // auto-fill consecutive range when picking ends
        window.attUpdatePeriodSummary && window.attUpdatePeriodSummary();
      });
    });
    window.attUpdatePeriodSummary();
    return host;
  }

  /** Convert #attTime from 24h browser control to 12-hour text (stores HH:MM 24h in data-24h). */
  function ensureAttClockTime12h() {
    var timeEl = document.getElementById('attTime');
    if (!timeEl || timeEl.getAttribute('data-12h') === '1') return timeEl;
    var prev24 = '';
    if (timeEl.type === 'time' && timeEl.value) {
      prev24 = timeEl.value;
    } else if (timeEl.value) {
      prev24 = attParseClockTo24(timeEl.value) || '';
    }
    if (!prev24) {
      var now = new Date();
      prev24 =
        String(now.getHours()).padStart(2, '0') +
        ':' +
        String(now.getMinutes()).padStart(2, '0');
    }
    timeEl.type = 'text';
    timeEl.setAttribute('data-12h', '1');
    timeEl.setAttribute('data-24h', prev24);
    timeEl.setAttribute('placeholder', 'e.g. 10:30 AM');
    timeEl.setAttribute('inputmode', 'text');
    timeEl.value = attFormatClock12(prev24);
    timeEl.style.maxWidth = '160px';
    if (!timeEl.__att12Bound) {
      timeEl.__att12Bound = true;
      timeEl.addEventListener('blur', function () {
        var as24 = attParseClockTo24(timeEl.value);
        if (as24) {
          timeEl.setAttribute('data-24h', as24);
          timeEl.value = attFormatClock12(as24);
        }
      });
    }
    return timeEl;
  }

  function attParseClockTo24(s) {
    var t = String(s || '').trim();
    if (!t) return null;
    var m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      var h = Number(m12[1]);
      var min = m12[2];
      var ap = m12[3].toUpperCase();
      if (h < 1 || h > 12) return null;
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return String(h).padStart(2, '0') + ':' + min;
    }
    var m24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) {
      var h2 = Number(m24[1]);
      if (h2 > 23) return null;
      return String(h2).padStart(2, '0') + ':' + m24[2];
    }
    return null;
  }

  function attGetClockTime24() {
    var timeEl = document.getElementById('attTime');
    if (!timeEl) return null;
    if (timeEl.getAttribute('data-24h')) {
      var fromData = attParseClockTo24(timeEl.getAttribute('data-24h')) || timeEl.getAttribute('data-24h');
      if (fromData) return fromData;
    }
    return attParseClockTo24(timeEl.value) || String(timeEl.value || '').trim() || null;
  }

  window.attGetSelectedPeriods = function () {
    var boxes = document.querySelectorAll('#attPeriodHost .att-period-cb:checked');
    var hours = [];
    boxes.forEach(function (cb) {
      hours.push(Number(cb.value));
    });
    hours.sort(function (a, b) { return a - b; });
    return hours;
  };

  window.attUpdatePeriodSummary = function () {
    var el = document.getElementById('attPeriodSummary');
    if (!el) return;
    var hours = window.attGetSelectedPeriods();
    if (!hours.length) {
      el.innerHTML = '<span style="color:#b45309;">⚠ Select at least one period (counts as 1 unit if none chosen at submit).</span>';
      return;
    }
    var labels = hours.map(function (h) {
      return attPeriodLabel12(h);
    });
    el.innerHTML =
      '✅ <strong>' +
      hours.length +
      '</strong> period unit(s): ' +
      labels.join(', ') +
      (hours.length > 1
        ? ' — continuous class will give each Present student <strong>' + hours.length + '</strong> attendance counts.'
        : '');
    // Highlight selected chips
    document.querySelectorAll('#attPeriodHost .att-period-chip').forEach(function (lab) {
      var cb = lab.querySelector('.att-period-cb');
      if (cb && cb.checked) {
        lab.style.background = '#fff7ed';
        lab.style.borderColor = '#ea580c';
        lab.style.fontWeight = '700';
      } else {
        lab.style.background = '#fff';
        lab.style.borderColor = 'var(--border)';
        lab.style.fontWeight = '500';
      }
    });
  };

  function ensureAttBatchSelectId() {
    var batchField = document.getElementById('batchField');
    if (!batchField) return null;
    var sel = batchField.querySelector('select');
    if (sel && !sel.id) sel.id = 'attBatch';
    sel = document.getElementById('attBatch') || sel;
    if (sel) {
      // Batch 1–2 primary; 3–4 optional for extra practical groups
      var prev = sel.value || '';
      sel.innerHTML =
        '<option value="Batch 1">Batch 1</option>' +
        '<option value="Batch 2">Batch 2</option>' +
        '<option value="Batch 3">Batch 3 (optional)</option>' +
        '<option value="Batch 4">Batch 4 (optional)</option>';
      if (prev) {
        // map old values
        if (/3/.test(prev)) sel.value = 'Batch 3';
        else if (/4/.test(prev)) sel.value = 'Batch 4';
        else if (/2/.test(prev)) sel.value = 'Batch 2';
        else sel.value = 'Batch 1';
      }
    }
    return document.getElementById('attBatch');
  }

  function attBatchNumber(batchLabel) {
    var m = String(batchLabel || '').match(/([1-4])/);
    return m ? Number(m[1]) : null;
  }

  function attTodayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  window.setupAttendancePanel = function setupAttendancePanel() {
    var root = document.getElementById('facAttendance');
    if (!root) return;

    // NOTE: this IIFE is outside __initGptBridge — never use bare currentUser (strict ReferenceError)
    var user = window.currentUser;
    var role = user && user.role ? user.role : '';
    var hodBranch = role === 'hod' ? attHodBranch(user) : '';

    // Banner text
    var warn = root.querySelector('.warn-box');
    if (warn && !warn.getAttribute('data-att-live')) {
      warn.setAttribute('data-att-live', '1');
    }
    if (warn) {
      if (role === 'hod') {
        warn.innerHTML =
          '🎓 <strong>HOD Attendance</strong> — You can mark and review attendance only for your branch' +
          (hodBranch ? ' (<strong>' + attEsc(hodBranch) + '</strong>)' : '') +
          '. Roster is loaded from live student accounts.';
      } else {
        warn.innerHTML =
          '🗓️ <strong>Attendance Management</strong> — Select branch, subject and date, then mark Present / Absent / Wait. ' +
          'Saved sessions update student attendance %. HOD is notified of department sessions.';
      }
    }

    // Branch select — official names; HOD locked to own branch only
    var branchSel = document.getElementById('attBranch');
    if (branchSel) {
      if (role === 'hod') {
        if (!hodBranch) {
          branchSel.innerHTML =
            '<option value="">No branch on your HOD account — contact Root Admin</option>';
          branchSel.disabled = true;
        } else {
          branchSel.innerHTML =
            '<option value="' + attEsc(hodBranch) + '" selected>' + attEsc(hodBranch) + '</option>';
          branchSel.disabled = true;
          // Keep value even if form reset
          branchSel.value = hodBranch;
        }
      } else {
        var prev = branchSel.value || '';
        var html = '<option value="">Select Branch</option>';
        OFFICIAL_ATT_BRANCHES.forEach(function (b) {
          html +=
            '<option value="' +
            attEsc(b) +
            '"' +
            (prev === b ? ' selected' : '') +
            '>' +
            attEsc(b) +
            '</option>';
        });
        branchSel.innerHTML = html;
        branchSel.disabled = false;
      }
    }

    ensureAttYearSelect();
    ensureAttSubjectInput();
    ensureAttBatchSelectId();
    ensureAttPeriodSlots();
    attBindSubjectReloaders();
    ensureAttDashboard();

    var dateEl = document.getElementById('attDate');
    if (dateEl && !dateEl.value) dateEl.value = attTodayISO();
    ensureAttClockTime12h();
    // Default-select current hour slot if none checked
    try {
      var curH = new Date().getHours();
      if (curH >= 9 && curH <= 17) {
        var any = document.querySelector('#attPeriodHost .att-period-cb:checked');
        if (!any) {
          var def = document.querySelector('#attPeriodHost .att-period-cb[value="' + curH + '"]');
          if (def) {
            def.checked = true;
            window.attUpdatePeriodSummary && window.attUpdatePeriodSummary();
          }
        }
      }
    } catch (e0) { /* ignore */ }
    window.loadAttCurriculumSubjects && window.loadAttCurriculumSubjects();

    // Hide prototype-only end semester button spam or rewire lightly
    root.querySelectorAll('button').forEach(function (btn) {
      var t = (btn.textContent || '').trim();
      if (t.indexOf('End Semester') >= 0) {
        btn.onclick = function () {
          alert('Semester archive will lock this subject roster. Contact Exam Cell / Admin if you need a formal close.');
        };
      }
    });

    // Load recent sessions for this branch
    loadAttendanceHistory();
    ensureBatchAssignPanel();
  };

  /** Staff: assign practical Batch 1–4 only (parent contact is not managed here). */
  function ensureBatchAssignPanel() {
    var step1 = document.getElementById('attStep1');
    if (!step1) return;
    var host = document.getElementById('attBatchAssignHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'attBatchAssignHost';
      host.style.marginTop = '14px';
      step1.appendChild(host);
    }
    host.innerHTML =
      '<div class="card" style="padding:16px;">' +
      '<h3 style="margin:0 0 8px;font-size:0.95rem;color:var(--navy);">👥 Assign Practical Batch</h3>' +
      '<p style="font-size:0.8rem;opacity:.8;margin:0 0 12px;">Batch 1 &amp; 2 for normal lab splits. <strong>Batch 3 &amp; 4 are optional</strong> extra groups. ' +
      'Only batch assignment — parent contact is not collected here.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<button type="button" class="btn pr" id="attBatchLoadBtn">Load branch students</button>' +
      '<button type="button" class="btn go" id="attBatchSaveBtn">💾 Save batches</button>' +
      '</div>' +
      '<div id="attBatchAssignMeta" style="font-size:0.78rem;opacity:.75;margin-bottom:8px;"></div>' +
      '<div style="overflow:auto;max-height:320px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px;">Reg No</th>' +
      '<th style="text-align:left;padding:6px;">Name</th>' +
      '<th style="text-align:left;padding:6px;">Batch</th>' +
      '</tr></thead>' +
      '<tbody id="attBatchAssignBody"><tr><td colspan="3" style="padding:16px;opacity:.7;">Click “Load branch students”.</td></tr></tbody>' +
      '</table></div></div>';

    var loadBtn = document.getElementById('attBatchLoadBtn');
    var saveBtn = document.getElementById('attBatchSaveBtn');
    if (loadBtn && !loadBtn.__bound) {
      loadBtn.__bound = true;
      loadBtn.onclick = function () { window.loadAttendanceBatchAssign && window.loadAttendanceBatchAssign(); };
    }
    if (saveBtn && !saveBtn.__bound) {
      saveBtn.__bound = true;
      saveBtn.onclick = function () { window.saveAttendanceBatchAssign && window.saveAttendanceBatchAssign(); };
    }
  }

  window.loadAttendanceBatchAssign = async function loadAttendanceBatchAssign() {
    var user = window.currentUser;
    var branch =
      (document.getElementById('attBranch') && document.getElementById('attBranch').value) ||
      (user && user.role === 'hod' ? attHodBranch(user) : '') ||
      '';
    branch = attNormalizeBranch(branch);
    var body = document.getElementById('attBatchAssignBody');
    var meta = document.getElementById('attBatchAssignMeta');
    if (!branch) {
      alert('Branch is required');
      return;
    }
    if (body) body.innerHTML = '<tr><td colspan="3" style="padding:16px;">Loading…</td></tr>';
    try {
      var r = await fetch(
        '/api/students/batch?branch=' + encodeURIComponent(branch) + '&_ts=' + Date.now(),
        { credentials: 'same-origin', cache: 'no-store' },
      );
      var data = await r.json().catch(function () { return null; });
      if (!r.ok || !data || !Array.isArray(data.students)) {
        if (body) body.innerHTML = '<tr><td colspan="3" style="padding:16px;color:#991b1b;">Failed to load.</td></tr>';
        return;
      }
      window._attBatchAssignList = data.students;
      if (meta) meta.textContent = data.students.length + ' active students · ' + branch;
      if (!data.students.length) {
        if (body) body.innerHTML = '<tr><td colspan="3" style="padding:16px;">No active students.</td></tr>';
        return;
      }
      body.innerHTML = data.students
        .map(function (s, i) {
          var b = s.attendance_batch;
          var opts = [1, 2, 3, 4]
            .map(function (n) {
              return (
                '<option value="' +
                n +
                '"' +
                (Number(b) === n ? ' selected' : '') +
                '>Batch ' +
                n +
                (n >= 3 ? ' (opt.)' : '') +
                '</option>'
              );
            })
            .join('');
          return (
            '<tr data-batch-i="' +
            i +
            '">' +
            '<td style="padding:6px;font-family:monospace;font-size:0.75rem;">' +
            attEsc(s.reg_no) +
            '</td>' +
            '<td style="padding:6px;">' +
            attEsc(s.name) +
            '</td>' +
            '<td style="padding:6px;"><select class="att-batch-sel" data-reg="' +
            attEsc(s.reg_no) +
            '" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);">' +
            '<option value="">—</option>' +
            opts +
            '</select></td>' +
            '</tr>'
          );
        })
        .join('');
    } catch (e) {
      if (body) body.innerHTML = '<tr><td colspan="3" style="padding:16px;color:#991b1b;">Network error.</td></tr>';
    }
  };

  window.saveAttendanceBatchAssign = async function saveAttendanceBatchAssign() {
    var root = document.getElementById('attBatchAssignHost');
    if (!root) return;
    var updates = [];
    root.querySelectorAll('.att-batch-sel').forEach(function (sel) {
      var reg = sel.getAttribute('data-reg');
      if (!reg) return;
      var batchVal = sel.value ? Number(sel.value) : null;
      updates.push({
        reg_no: reg,
        attendance_batch: batchVal,
      });
    });
    if (!updates.length) {
      alert('Load students first.');
      return;
    }
    try {
      var r = await fetch('/api/students/batch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: updates }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Save failed');
        return;
      }
      alert('Saved practical batch for ' + (data.updated || 0) + ' student(s).');
    } catch (e) {
      alert('Network error');
    }
  };

  async function loadAttendanceHistory() {
    var host = ensureAttHistoryHost();
    if (!host) return;
    var user = window.currentUser;
    if (!user) {
      host.innerHTML = '';
      return;
    }
    var branchSel = document.getElementById('attBranch');
    var branch =
      (branchSel && branchSel.value) ||
      (user.role === 'hod' ? attHodBranch(user) : '') ||
      '';
    host.innerHTML =
      '<div class="card" style="padding:14px 16px;"><div style="font-size:0.85rem;color:var(--text-muted);">Loading recent sessions…</div></div>';
    var q = '/api/attendance?limit=12&_ts=' + Date.now();
    if (branch) q += '&branch=' + encodeURIComponent(branch);
    var data = await attFetchJson(q, 10000);
    if (!data) {
      host.innerHTML =
        '<div class="info-box">Could not load attendance history. Check your login session.</div>';
      return;
    }
    var sessions = data.sessions || data.attendance || [];
    if (!sessions.length) {
      host.innerHTML =
        '<div class="card" style="padding:16px;">' +
        '<h3 style="font-family:\'Libre Baskerville\',serif;font-size:0.92rem;color:var(--navy);margin:0 0 8px;">📋 Recent sessions</h3>' +
        '<div class="info-box" style="margin:0;">No attendance marked yet' +
        (branch ? ' for <strong>' + attEsc(branch) + '</strong>' : '') +
        '. Start a session above.</div></div>';
      return;
    }
    var rows = sessions
      .map(function (s) {
        var st = s.stats || {};
        var d = s.att_date
          ? String(s.att_date).slice(0, 10)
          : '—';
        var cancelled = s.session_status === 'cancelled' || s.cancelled;
        var statusBadge = cancelled
          ? '<span class="badge" style="background:#fef3c7;color:#92400e;">Cancelled</span>'
          : '<span class="badge active">Active</span>';
        var rowStyle = cancelled ? ' style="opacity:0.72;background:#fffbeb;"' : '';
        var openBtn = cancelled
          ? ''
          : '<button type="button" class="btn ol" style="padding:4px 10px;font-size:0.72rem;" data-att-reload="' +
            attEsc(s.class_id) +
            '" data-att-date="' +
            attEsc(d) +
            '">Open</button>';
        var cancelBtn = cancelled
          ? '<button type="button" class="btn ol" style="padding:4px 10px;font-size:0.72rem;" data-att-restore="' +
            attEsc(String(s.id)) +
            '">Restore</button>'
          : '<button type="button" class="btn" style="padding:4px 10px;font-size:0.72rem;background:#f59e0b;color:#fff;" data-att-cancel="' +
            attEsc(String(s.id)) +
            '" title="Cancel this class (kept in register, not counted in %)">Cancel class</button>';
        var delBtn =
          '<button type="button" class="btn re" style="padding:4px 10px;font-size:0.72rem;" data-att-delete="' +
          attEsc(String(s.id)) +
          '" title="Permanently delete if created by mistake">Delete</button>';
        var exportBtn =
          '<button type="button" class="btn go" style="padding:4px 10px;font-size:0.72rem;" data-att-export="' +
          attEsc(String(s.id)) +
          '" title="Download Excel/CSV for this session">📊 Excel</button>';
        var periodLabel =
          s.att_time ||
          (s.period_count
            ? s.period_count + ' period(s)'
            : '—');
        return (
          '<tr' +
          rowStyle +
          '>' +
          '<td style="font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;">' +
          attEsc(d) +
          '</td>' +
          '<td>' +
          attEsc(s.subject || '—') +
          '<div style="font-size:0.7rem;opacity:.75;margin-top:2px;">' +
          attEsc(periodLabel) +
          '</div></td>' +
          '<td>' +
          attEsc(s.year || 'All') +
          '</td>' +
          '<td>' +
          attEsc(s.batch || '—') +
          '</td>' +
          '<td><span class="badge active">' +
          (st.present != null ? st.present : '—') +
          ' P</span> ' +
          '<span class="badge" style="background:#fee2e2;color:#991b1b;">' +
          (st.absent != null ? st.absent : '—') +
          ' A</span>' +
          (s.period_count
            ? '<div style="font-size:0.68rem;margin-top:3px;opacity:.8;">×' +
              s.period_count +
              ' units</div>'
            : '') +
          '</td>' +
          '<td>' +
          statusBadge +
          '</td>' +
          '<td style="white-space:nowrap;">' +
          '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
          openBtn +
          exportBtn +
          cancelBtn +
          delBtn +
          '</div></td>' +
          '</tr>'
        );
      })
      .join('');
    host.innerHTML =
      '<div class="card" style="padding:0;overflow:hidden;">' +
      '<div class="card-hd" style="padding:12px 16px;">' +
      '<h3 style="margin:0;font-size:0.92rem;">📋 Attendance register' +
      (branch ? ' · ' + attEsc(branch) : '') +
      '</h3>' +
      '<p style="margin:6px 0 0;font-size:0.75rem;opacity:.75;">Continuous multi-period classes count each hour. Export Excel downloads one session\'s roll. Cancel keeps the row (not in %).</p>' +
      '</div>' +
      '<div style="overflow:auto;"><table class="data-table" style="width:100%;font-size:0.82rem;">' +
      '<thead><tr><th>Date</th><th>Subject / Periods</th><th>Year</th><th>Batch</th><th>Summary</th><th>Status</th><th>Actions</th></tr></thead>' +
      '<tbody>' +
      rows +
      '</tbody></table></div></div>';

    host.querySelectorAll('[data-att-reload]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var classId = btn.getAttribute('data-att-reload');
        var date = btn.getAttribute('data-att-date');
        // Prefill form from session row if possible
        var match = sessions.find(function (x) {
          return String(x.class_id) === String(classId) && String(x.att_date).slice(0, 10) === String(date).slice(0, 10);
        });
        if (match) {
          var subjEl = document.getElementById('attSubject');
          if (subjEl) subjEl.value = match.subject || '';
          var yearEl = document.getElementById('attYear');
          if (yearEl && match.year) yearEl.value = match.year;
          var dateEl2 = document.getElementById('attDate');
          if (dateEl2) dateEl2.value = String(match.att_date).slice(0, 10);
          var br = document.getElementById('attBranch');
          if (br && match.branch && !br.disabled) br.value = match.branch;
          if (match.batch) {
            var ct = document.getElementById('attClassType');
            if (ct) {
              ct.value = 'Batch-wise Class';
              if (typeof window.toggleBatch === 'function') window.toggleBatch();
            }
            var bat = document.getElementById('attBatch');
            if (bat) bat.value = match.batch;
          }
          window._attPrefillEntries = match.entries || [];
        }
        window.startAttendance();
      });
    });

    host.querySelectorAll('[data-att-export]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-att-export');
        var match = sessions.find(function (x) {
          return String(x.id) === String(id);
        });
        if (match) window.exportAttendanceSessionExcel(match);
      });
    });

    host.querySelectorAll('[data-att-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-att-cancel');
        window.cancelAttendanceSession && window.cancelAttendanceSession(id);
      });
    });
    host.querySelectorAll('[data-att-restore]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-att-restore');
        window.restoreAttendanceSession && window.restoreAttendanceSession(id);
      });
    });
    host.querySelectorAll('[data-att-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-att-delete');
        window.deleteAttendanceSession && window.deleteAttendanceSession(id);
      });
    });
  }

  window.cancelAttendanceSession = async function cancelAttendanceSession(id) {
    if (!id) return;
    if (!confirm('Cancel this class?\n\nThe session stays in the attendance register but will NOT count toward student attendance %.')) return;
    try {
      var r = await fetch('/api/attendance', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(id), action: 'cancel' }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Could not cancel session');
        return;
      }
      alert('Class cancelled. It remains in the register but is excluded from attendance %.');
      loadAttendanceHistory();
    } catch (e) {
      alert('Network error');
    }
  };

  window.restoreAttendanceSession = async function restoreAttendanceSession(id) {
    if (!id) return;
    if (!confirm('Restore this cancelled class so it counts in attendance % again?')) return;
    try {
      var r = await fetch('/api/attendance', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(id), action: 'restore' }),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Could not restore session');
        return;
      }
      alert('Class restored.');
      loadAttendanceHistory();
    } catch (e) {
      alert('Network error');
    }
  };

  window.deleteAttendanceSession = async function deleteAttendanceSession(id) {
    if (!id) return;
    if (!confirm('Permanently DELETE this attendance session?\n\nUse this only if the session was created by mistake. This cannot be undone.')) return;
    try {
      var r = await fetch('/api/attendance?id=' + encodeURIComponent(String(id)), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        alert(data.error || 'Could not delete session');
        return;
      }
      alert('Session deleted from the register.');
      loadAttendanceHistory();
    } catch (e) {
      alert('Network error');
    }
  };

  function attYearMatch(studentYear, filterYear) {
    if (!filterYear) return true;
    var y = String(studentYear || '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
    var f = String(filterYear).toUpperCase();
    if (!y || y === '—' || y === '-') return true; // include unknown years when filtering
    // Normalize roman / digit / word forms — check longest first so III ≠ I
    function yearBucket(v) {
      var s = String(v || '').toUpperCase();
      if (/\bIII\b/.test(s) || s === 'III' || s.indexOf('3') >= 0 || s.indexOf('THIRD') >= 0) return 'III';
      if (/\bII\b/.test(s) || s === 'II' || s.indexOf('2') >= 0 || s.indexOf('SECOND') >= 0) return 'II';
      if (/\bI\b/.test(s) || s === 'I' || s.indexOf('1') >= 0 || s.indexOf('FIRST') >= 0) return 'I';
      if (s.indexOf('III') >= 0) return 'III';
      if (s.indexOf('II') >= 0) return 'II';
      if (s.indexOf('I') >= 0) return 'I';
      return '';
    }
    var sy = yearBucket(y);
    var fy = yearBucket(f);
    if (!sy || !fy) return sy === fy;
    return sy === fy;
  }

  /** Fetch with timeout so Attendance never spins forever. */
  async function attFetchJson(url, timeoutMs) {
    var ms = timeoutMs || 20000;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    try {
      if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* ignore */ } }, ms);
      var res = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[attendance] fetch failed', url, e);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function startAttendanceLive() {
    try {
      return await startAttendanceLiveInner();
    } catch (err) {
      console.error('[attendance] start failed', err);
      var gridE = document.getElementById('attGrid');
      if (gridE) {
        gridE.innerHTML =
          '<div class="warn-box">Attendance error: ' +
          attEsc(err && err.message ? err.message : String(err)) +
          '</div>' +
          '<div style="margin:12px;"><button type="button" class="btn pr" onclick="window.__gpthStartAttendance&&window.__gpthStartAttendance()">Retry</button></div>';
      } else {
        alert('Attendance failed: ' + (err && err.message ? err.message : String(err)));
      }
    }
  }

  async function startAttendanceLiveInner() {
    // Must use window.currentUser — bare currentUser is not in this IIFE scope
    var user = window.currentUser;
    if (!user) {
      alert('Please log in to mark attendance.');
      return;
    }

    // Do NOT re-run full setupAttendancePanel here (it reloads history and can race).
    // Only ensure branch lock + subject input exist.
    try {
      var branchSel0 = document.getElementById('attBranch');
      if (user.role === 'hod' && branchSel0) {
        var hb = attHodBranch(user);
        if (hb) {
          branchSel0.innerHTML = '<option value="' + attEsc(hb) + '" selected>' + attEsc(hb) + '</option>';
          branchSel0.disabled = true;
          branchSel0.value = hb;
        }
      }
      ensureAttSubjectInput();
      ensureAttYearSelect();
      ensureAttBatchSelectId();
    } catch (e) { /* ignore */ }

    var branchSel = document.getElementById('attBranch');
    var subjEl = document.getElementById('attSubject');
    var yearEl = document.getElementById('attYear');
    var dateEl = document.getElementById('attDate');
    var classTypeEl = document.getElementById('attClassType');
    var batchEl = document.getElementById('attBatch') || document.querySelector('#batchField select');

    var branch = branchSel ? String(branchSel.value || '').trim() : '';
    if (user.role === 'hod') {
      branch = attHodBranch(user) || branch;
    }
    branch = attNormalizeBranch(branch);
    var subj = typeof attResolveSubjectValue === 'function' ? attResolveSubjectValue() : (subjEl ? String(subjEl.value || '').trim() : '');
    if (subj === '__other__') subj = '';
    var year = yearEl ? String(yearEl.value || '').trim() : '';
    var attDate = dateEl && dateEl.value ? dateEl.value : attTodayISO();
    var classType = classTypeEl ? classTypeEl.value : 'Regular Class';
    var batch =
      classType && String(classType).toLowerCase().indexOf('batch') >= 0 && batchEl
        ? String(batchEl.value || '').trim()
        : '';
    var periods = (window.attGetSelectedPeriods && window.attGetSelectedPeriods()) || [];
    if (!periods.length) {
      var th = new Date().getHours();
      if (th >= 9 && th <= 17) periods = [th];
      else periods = [9];
    }

    if (!branch) {
      alert(
        user.role === 'hod'
          ? 'Your HOD account has no branch assigned. Contact Root Admin.'
          : 'Please select Branch first.',
      );
      return;
    }
    if (!subj) {
      alert('Please select a subject from the list (or choose Other and type the subject).');
      return;
    }

    var grid = document.getElementById('attGrid');
    var step1 = document.getElementById('attStep1');
    var markUI = document.getElementById('attMarkUI');
    if (grid) {
      grid.innerHTML =
        '<div style="padding:24px;text-align:center;color:var(--text-muted);">Loading students for ' +
        attEsc(branch) +
        '…</div>';
    }
    if (step1) step1.style.display = 'none';
    if (markUI) markUI.style.display = 'block';

    var label = document.getElementById('attSessionLabel');
    if (label) {
      label.textContent =
        'Attendance — ' +
        subj +
        ' · ' +
        branch +
        (year ? ' · ' + year + ' Yr' : '') +
        (batch ? ' · ' + batch : '') +
        ' · ' +
        attDate +
        ' · ' +
        periods.length +
        ' period(s)';
    }

    // Fast dedicated roster API (no photos, no heavy student list)
    var yearQ = '';
    if (year === 'I' || year === '1') yearQ = '&year=1';
    else if (year === 'II' || year === '2') yearQ = '&year=2';
    else if (year === 'III' || year === '3') yearQ = '&year=3';

    var batchQ = '';
    if (classType && String(classType).toLowerCase().indexOf('batch') >= 0) {
      var bn = attBatchNumber(batch);
      if (bn) batchQ = '&batch=' + bn;
    }

    var rosterUrl =
      '/api/attendance/roster?branch=' +
      encodeURIComponent(branch) +
      yearQ +
      batchQ +
      '&_ts=' +
      Date.now();

    var data = await attFetchJson(rosterUrl, 20000);
    // Fallback once to lite students list if roster route not deployed yet
    if (!data || !Array.isArray(data.students)) {
      data = await attFetchJson('/api/students?lite=1&_ts=' + Date.now(), 20000);
    }
    if (!data || !Array.isArray(data.students)) {
      if (grid) {
        grid.innerHTML =
          '<div class="warn-box">Could not load student roster (timeout or session expired). ' +
          'Please hard-refresh (Ctrl+F5) and try again. If it keeps failing, log out and log in.</div>' +
          '<div style="margin:12px;"><button type="button" class="btn pr" onclick="window.startAttendance&&window.startAttendance()">Retry</button> ' +
          '<button type="button" class="btn ol" onclick="document.getElementById(\'attMarkUI\').style.display=\'none\';document.getElementById(\'attStep1\').style.display=\'block\';">← Back</button></div>';
      }
      return;
    }

    var roster = data.students
      .filter(function (s) {
        var st = String(s.academic_status || (s.academic && s.academic.academic_status) || 'active').toLowerCase();
        if (st === 'passed_out' || s.is_alumni) return false;
        var dept = attNormalizeBranch(s.dept || s.user_branch || '');
        if (dept && !attBranchesMatch(dept, branch)) return false;
        if (!attYearMatch(s.year, year)) return false;
        if (year === 'I' || year === 'II' || year === 'III') {
          var map = { I: 1, II: 2, III: 3 };
          if (s.current_study_year != null && Number(s.current_study_year) !== map[year]) {
            if (s.current_study_year === 1 || s.current_study_year === 2 || s.current_study_year === 3) {
              return false;
            }
          }
        }
        var reg = String(s.reg_no || '').trim();
        if (!reg) return false;
        return true;
      })
      .map(function (s) {
        return {
          reg: String(s.reg_no).trim().toUpperCase(),
          name: s.name || s.display_name || '—',
          year: s.year || '',
          dept: attNormalizeBranch(s.dept) || branch,
        };
      })
      .sort(function (a, b) {
        return a.reg.localeCompare(b.reg);
      });

    // Prefill previous marks (non-blocking: 8s max)
    var existingEntries = window._attPrefillEntries || null;
    window._attPrefillEntries = null;
    if (!existingEntries) {
      try {
        var hist = await attFetchJson(
          '/api/attendance?branch=' +
            encodeURIComponent(branch) +
            '&date=' +
            encodeURIComponent(attDate) +
            '&limit=20&_ts=' +
            Date.now(),
          8000,
        );
        var sessions = (hist && (hist.sessions || hist.attendance)) || [];
        var subjLower = subj.toLowerCase();
        var hit = sessions.find(function (x) {
          return (
            String(x.subject || '').toLowerCase() === subjLower &&
            String(x.year || '') === String(year || '') &&
            String(x.batch || '') === String(batch || '')
          );
        });
        if (hit && Array.isArray(hit.entries)) existingEntries = hit.entries;
      } catch (e) {
        /* ignore */
      }
    }

    try {
      if (typeof demoAtt !== 'undefined') {
        demoAtt.length = 0;
        roster.forEach(function (s) {
          demoAtt.push({ reg: s.reg, name: s.name });
        });
      }
    } catch (e) {
      /* ignore */
    }
    window._attRoster = roster;
    var attTimeVal = attGetClockTime24() || new Date().toTimeString().slice(0, 5);
    window._attSessionMeta = {
      branch: branch,
      subject: subj,
      year: year || null,
      date: attDate,
      time: attTimeVal,
      class_type: classType,
      batch: batch || null,
      periods: periods,
      period_count: periods.length,
    };

    try {
      Object.keys(attState).forEach(function (k) {
        delete attState[k];
      });
    } catch (e) {
      /* ignore */
    }

    if (!roster.length) {
      if (grid) {
        grid.innerHTML =
          '<div class="warn-box" style="margin:16px;">No <strong>active</strong> students found for <strong>' +
          attEsc(branch) +
          '</strong>' +
          (year ? ' · Year ' + attEsc(year) : '') +
          '. Alumni are excluded. Clear year filter or check Student Data.</div>' +
          '<div style="margin:12px;"><button type="button" class="btn ol" onclick="document.getElementById(\'attMarkUI\').style.display=\'none\';document.getElementById(\'attStep1\').style.display=\'block\';">← Back</button></div>';
      }
      return;
    }

    var prefillMap = {};
    if (Array.isArray(existingEntries)) {
      existingEntries.forEach(function (e) {
        var r = String(e.reg || '').toUpperCase();
        if (r) prefillMap[r] = e.status || (e.present ? 'P' : 'A');
      });
    }

    if (!grid) return;

    // Fast DOM: one HTML string instead of hundreds of appendChild calls
    var cards = [];
    roster.forEach(function (s) {
      attState[s.reg] = prefillMap[s.reg] || null;
      var regSafe = s.reg.replace(/'/g, '');
      var selP = prefillMap[s.reg] === 'P' ? ' sel' : '';
      var selA = prefillMap[s.reg] === 'A' ? ' sel' : '';
      var selW = prefillMap[s.reg] === 'W' ? ' sel' : '';
      cards.push(
        '<div class="att-card">' +
          '<div class="reg">' +
          attEsc(s.reg) +
          '</div><div class="sname">' +
          attEsc(s.name) +
          (s.year && s.year !== '—'
            ? ' <span style="font-size:0.68rem;color:var(--text-muted);">(' + attEsc(s.year) + ')</span>'
            : '') +
          '</div>' +
          '<div class="att-btns">' +
          '<button class="att-btn pres' +
          selP +
          '" id="p_' +
          attEsc(s.reg) +
          '" onclick="markAtt(\'' +
          regSafe +
          '\',\'P\')">✓ Present</button>' +
          '<button class="att-btn abs' +
          selA +
          '" id="a_' +
          attEsc(s.reg) +
          '" onclick="markAtt(\'' +
          regSafe +
          '\',\'A\')">✗ Absent</button>' +
          '<button class="att-btn wait' +
          selW +
          '" id="w_' +
          attEsc(s.reg) +
          '" onclick="markAtt(\'' +
          regSafe +
          '\',\'W\')" title="Wait">⏳ Wait</button>' +
          '</div>' +
          '<div id="wt_' +
          attEsc(s.reg) +
          '" style="font-size:0.65rem;color:var(--accent);font-family:\'JetBrains Mono\',monospace;margin-top:4px;display:' +
          (prefillMap[s.reg] === 'W' ? 'block' : 'none') +
          ';">⏳ Wait — auto-absent if not updated by 6:00 PM</div></div>',
      );
    });
    grid.innerHTML =
      '<div style="padding:8px 14px;font-size:0.8rem;color:var(--text-muted);">' +
      roster.length +
      ' students · ' +
      attEsc(branch) +
      (year ? ' · ' + attEsc(year) : '') +
      '</div>' +
      cards.join('');

    var acts = document.querySelector('#attMarkUI .card-acts');
    if (acts && !document.getElementById('attMarkAllPresent')) {
      var allP = document.createElement('button');
      allP.className = 'btn ol';
      allP.id = 'attMarkAllPresent';
      allP.type = 'button';
      allP.textContent = 'All Present';
      allP.onclick = function () {
        roster.forEach(function (s) {
          if (typeof window.markAtt === 'function') window.markAtt(s.reg, 'P');
        });
      };
      acts.insertBefore(allP, acts.firstChild);
    }
  };

  async function submitAttLive() {
    var meta = window._attSessionMeta;
    var roster = window._attRoster || [];
    if (!meta || !roster.length) {
      alert('No active attendance session. Start attendance first.');
      return;
    }

    // Wait → Absent on submit (same as prototype)
    try {
      Object.keys(attState).forEach(function (r) {
        if (attState[r] === 'W') attState[r] = 'A';
      });
    } catch (e) {
      /* ignore */
    }

    var unmarked = roster.filter(function (s) {
      return !attState[s.reg];
    });
    if (unmarked.length) {
      if (
        !confirm(
          unmarked.length +
            ' student(s) not marked. Mark them Absent and submit?',
        )
      ) {
        return;
      }
      unmarked.forEach(function (s) {
        attState[s.reg] = 'A';
        if (typeof window.markAtt === 'function') window.markAtt(s.reg, 'A');
      });
    }

    var entries = roster.map(function (s) {
      var status = attState[s.reg] || 'A';
      return {
        reg: s.reg,
        name: s.name,
        status: status,
        present: status === 'P',
      };
    });

    var present = entries.filter(function (e) {
      return e.status === 'P';
    }).length;
    var absent = entries.filter(function (e) {
      return e.status === 'A';
    }).length;

    var periodList =
      (meta.periods && meta.periods.length
        ? meta.periods
        : (window.attGetSelectedPeriods && window.attGetSelectedPeriods()) || []) || [];
    var res = await api.post('/api/attendance', {
      branch: meta.branch,
      subject: meta.subject,
      year: meta.year,
      date: meta.date,
      time: meta.time || attGetClockTime24() || null,
      class_type: meta.class_type,
      batch: meta.batch,
      periods: periodList,
      period_count: periodList.length || 1,
      entries: entries,
    });
    if (!res || !res.ok) return;

    var absList = entries
      .filter(function (e) {
        return e.status === 'A';
      })
      .map(function (e) {
        return e.reg;
      });
    var pc = (res.attendance && res.attendance.period_count) || periodList.length || 1;
    var msg =
      '✅ Attendance saved for ' +
      entries.length +
      ' students.\n' +
      'Present: ' +
      present +
      ' · Absent: ' +
      absent +
      '\nPeriod units: ' +
      pc +
      ' (each Present counts as ' +
      pc +
      ')\n' +
      meta.subject +
      ' · ' +
      meta.branch +
      ' · ' +
      meta.date +
      (meta.time ? ' · ' + attFormatClock12(meta.time) : '');
    if (absList.length) {
      msg +=
        '\n\nAbsent: ' +
        absList.slice(0, 12).join(', ') +
        (absList.length > 12 ? '…' : '') +
        '\n\n📲 In-app notifications sent to Student & Parent app views' +
        (res.absent_notified != null ? ' (' + res.absent_notified + ').' : '.') +
        '\n(No WhatsApp messages are sent.)';
    } else {
      msg += '\n\nAll present — no absent notifications.';
    }
    alert(msg);

    var markUI = document.getElementById('attMarkUI');
    var step1 = document.getElementById('attStep1');
    if (markUI) markUI.style.display = 'none';
    if (step1) step1.style.display = 'block';
    window._attRoster = [];
    window._attSessionMeta = null;
    try {
      if (typeof demoAtt !== 'undefined') demoAtt.length = 0;
    } catch (e) {
      /* ignore */
    }
    loadAttendanceHistory();
  }

  /** Excel-friendly CSV export for one attendance session. */
  window.exportAttendanceSessionExcel = function exportAttendanceSessionExcel(session) {
    if (!session) {
      alert('Session not found');
      return;
    }
    var entries = session.entries || [];
    var date = session.att_date ? String(session.att_date).slice(0, 10) : '';
    var pc = session.period_count || 1;
    var periods = session.att_time || '';
    var lines = [];
    lines.push(
      [
        'Reg No',
        'Name',
        'Status',
        'Present',
        'Period Units',
        'Subject',
        'Date',
        'Periods',
        'Branch',
        'Year',
        'Batch',
        'Class Type',
        'Session Status',
      ]
        .map(csvCell)
        .join(','),
    );
    function csvCell(v) {
      var s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    entries.forEach(function (e) {
      var st = e.status || (e.present ? 'P' : 'A');
      lines.push(
        [
          e.reg || e.reg_no || '',
          e.name || '',
          st === 'P' ? 'Present' : st === 'A' ? 'Absent' : st,
          st === 'P' ? 'Yes' : 'No',
          pc,
          session.subject || '',
          date,
          periods,
          session.branch || '',
          session.year || '',
          session.batch || '',
          session.class_type || '',
          session.session_status || 'active',
        ]
          .map(csvCell)
          .join(','),
      );
    });
    // Summary rows
    lines.push('');
    lines.push(csvCell('Total students') + ',' + csvCell(entries.length));
    lines.push(
      csvCell('Present') +
        ',' +
        csvCell(entries.filter(function (e) { return (e.status || (e.present ? 'P' : 'A')) === 'P'; }).length),
    );
    lines.push(
      csvCell('Absent') +
        ',' +
        csvCell(entries.filter(function (e) { return (e.status || (e.present ? 'P' : 'A')) === 'A'; }).length),
    );
    lines.push(csvCell('Period units (each present multiplies)') + ',' + csvCell(pc));
    var bom = '\uFEFF';
    var blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    var safeSub = String(session.subject || 'session')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 40);
    a.href = URL.createObjectURL(blob);
    a.download = 'attendance_' + date + '_' + safeSub + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  };

  // Expose for onclick + legacy-app proxy (must not rely on bare currentUser)
  window.__gpthStartAttendance = startAttendanceLive;
  window.startAttendance = startAttendanceLive;
  window.__gpthSubmitAtt = submitAttLive;
  window.submitAtt = submitAttLive;
  window.setupAttendancePanel = window.setupAttendancePanel;
  console.log('[bridge] attendance live handlers installed');
})();

/* ============================================================
 * TIMETABLE UPLOAD — live, branch-scoped (HOD/faculty own branch)
 * Separate from Attendance Management. Students see own branch only.
 * ============================================================ */
;(function () {
  'use strict';

  var TT_BRANCHES = [
    'Civil Engineering',
    'Computer Science and Engineering',
    'Electronics and Communication Engineering',
    'Mechanical Engineering',
  ];
  var TT_YEARS = [1, 2, 3];
  var TT_SHORT = {
    'Civil Engineering': 'Civil Engg.',
    'Computer Science and Engineering': 'CSE',
    'Electronics and Communication Engineering': 'ECE',
    'Mechanical Engineering': 'Mechanical',
  };
  var TT_PANEL_ID = {
    'Civil Engineering': 'ftCivil',
    'Computer Science and Engineering': 'ftCSE',
    'Electronics and Communication Engineering': 'ftECE',
    'Mechanical Engineering': 'ftMech',
  };

  function ttEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ttNormBranch(input) {
    if (!input) return '';
    var raw = String(input).replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    var lower = raw.toLowerCase();
    if (TT_BRANCHES.indexOf(raw) >= 0) return raw;
    if (lower.indexOf('civil') >= 0) return 'Civil Engineering';
    if (lower.indexOf('electron') >= 0 || lower.indexOf('ece') >= 0 || lower.indexOf('e&c') >= 0) {
      return 'Electronics and Communication Engineering';
    }
    if (lower.indexOf('computer') >= 0 || lower === 'cse' || lower.indexOf('cs and') >= 0) {
      return 'Computer Science and Engineering';
    }
    if (lower.indexOf('mech') >= 0) return 'Mechanical Engineering';
    return raw;
  }

  function ttUserBranch(user) {
    if (!user) return '';
    var role = String(user.role || '').toLowerCase();
    if (role === 'admin' || role === 'principal') return ''; // all
    var b = ttNormBranch(user.branch);
    if (b && TT_BRANCHES.indexOf(b) >= 0) return b;
    var key = String(user.reg_no || user.display_name || user.email || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (key.indexOf('HODCE') >= 0 || key.indexOf('HODCIVIL') >= 0) return 'Civil Engineering';
    if (key.indexOf('HODCS') >= 0 || key.indexOf('HODCSE') >= 0) return 'Computer Science and Engineering';
    if (key.indexOf('HODEC') >= 0 || key.indexOf('HODECE') >= 0) {
      return 'Electronics and Communication Engineering';
    }
    if (key.indexOf('HODME') >= 0 || key.indexOf('HODMECH') >= 0) return 'Mechanical Engineering';
    return b || '';
  }

  function ttFmtDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 10);
      var day = String(d.getDate()).padStart(2, '0');
      var mon = d.toLocaleString('en-GB', { month: 'short' });
      var yr = d.getFullYear();
      return day + ' ' + mon + ' ' + yr;
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }

  function ttYearLabel(y) {
    if (y === 1) return '1st Year';
    if (y === 2) return '2nd Year';
    if (y === 3) return '3rd Year';
    return 'Year ' + y;
  }

  function ttFileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  function ttOpenFile(dataUrl, mime, fileName) {
    try {
      var raw = String(dataUrl || '');
      var m = raw.match(/^data:([^;]+);base64,(.+)$/i);
      var b64 = m ? m[2] : raw;
      var mt = (m && m[1]) || mime || 'application/pdf';
      var bin = atob(b64);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var blob = new Blob([arr], { type: mt });
      var url = URL.createObjectURL(blob);
      var w = window.open(url, '_blank');
      if (!w) {
        // popup blocked — force download link
        var a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'timetable';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }, 120000);
    } catch (e) {
      console.warn('[tt] open file', e);
      alert('Could not open file. Try downloading again.');
    }
  }

  function ttFindRow(list, branch, year) {
    if (!Array.isArray(list)) return null;
    var nb = ttNormBranch(branch);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (ttNormBranch(r.branch) === nb && Number(r.study_year) === Number(year)) return r;
    }
    return null;
  }

  function ttCardHtml(branch, year, row, canWrite) {
    var has = !!row;
    var status = has
      ? '<div class="tt-status" style="color:var(--green);">✅ Uploaded — ' +
        ttEsc(ttFmtDate(row.updated_at || row.created_at)) +
        (row.uploaded_by_name ? ' · ' + ttEsc(row.uploaded_by_name) : '') +
        '</div>'
      : '<div class="tt-status" style="color:var(--orange);">⚠ Not Uploaded</div>';
    var zoneLabel = has ? 'Upload / Replace' : 'Upload';
    var viewBtn = has
      ? '<button type="button" class="btn pr" style="width:100%;margin-top:8px;" data-tt-view="' +
        ttEsc(branch) +
        '" data-tt-year="' +
        year +
        '" data-tt-id="' +
        ttEsc(row.id) +
        '">👁️ View Current</button>'
      : '<button type="button" class="btn ol" style="width:100%;margin-top:8px;" disabled>👁️ Not Yet Uploaded</button>';
    var delBtn =
      has && canWrite
        ? '<button type="button" class="btn re" style="width:100%;margin-top:6px;font-size:0.78rem;" data-tt-del="' +
          ttEsc(branch) +
          '" data-tt-year="' +
          year +
          '">🗑 Remove</button>'
        : '';
    var uploadZone = canWrite
      ? '<div class="upload-zone" data-tt-upload="' +
        ttEsc(branch) +
        '" data-tt-year="' +
        year +
        '" style="cursor:pointer;">' +
        '<div class="uzi">📄</div>' +
        '<p><strong>' +
        zoneLabel +
        '</strong></p>' +
        '<p>PDF, JPG, PNG accepted (max ~3.5 MB)</p></div>'
      : '<div class="upload-zone" style="opacity:.7;cursor:default;"><div class="uzi">📄</div><p>View only</p></div>';

    return (
      '<div class="tt-card" data-tt-branch="' +
      ttEsc(branch) +
      '" data-tt-year="' +
      year +
      '">' +
      '<h4>📅 ' +
      ttEsc(ttYearLabel(year)) +
      ' Timetable</h4>' +
      status +
      uploadZone +
      viewBtn +
      delBtn +
      '</div>'
    );
  }

  function ttBindPanel(root, list, branches, canWrite) {
    if (!root) return;
    root.querySelectorAll('[data-tt-upload]').forEach(function (zone) {
      zone.onclick = function () {
        var branch = zone.getAttribute('data-tt-upload');
        var year = Number(zone.getAttribute('data-tt-year'));
        var input = document.getElementById('ttFileInput');
        if (!input) {
          input = document.createElement('input');
          input.type = 'file';
          input.id = 'ttFileInput';
          input.accept = '.pdf,image/png,image/jpeg,image/jpg,image/webp,application/pdf';
          input.style.display = 'none';
          document.body.appendChild(input);
        }
        input.value = '';
        input.onchange = async function () {
          var file = input.files && input.files[0];
          if (!file) return;
          if (file.size > 3.5 * 1024 * 1024) {
            alert('File too large (max ~3.5 MB). Compress the PDF or use a smaller image.');
            return;
          }
          try {
            zone.style.opacity = '0.55';
            var dataUrl = await ttFileToDataUrl(file);
            var res = await fetch('/api/timetables', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                branch: branch,
                year: year,
                file_name: file.name,
                mime_type: file.type || '',
                file_data: dataUrl,
              }),
            });
            var data = await res.json().catch(function () { return null; });
            if (!res.ok) {
              alert((data && data.error) || 'Upload failed');
              zone.style.opacity = '1';
              return;
            }
            alert('✅ ' + ttYearLabel(year) + ' timetable uploaded for ' + (TT_SHORT[branch] || branch));
            window.setupTimetableUploadPanel();
          } catch (e) {
            console.warn('[tt] upload', e);
            alert('Upload failed. Check connection and try again.');
            zone.style.opacity = '1';
          }
        };
        input.click();
      };
    });

    root.querySelectorAll('[data-tt-view]').forEach(function (btn) {
      btn.onclick = async function () {
        var id = btn.getAttribute('data-tt-id');
        var branch = btn.getAttribute('data-tt-view');
        var year = btn.getAttribute('data-tt-year');
        btn.disabled = true;
        try {
          var q = id
            ? '/api/timetables?id=' + encodeURIComponent(id) + '&include_data=1'
            : '/api/timetables?branch=' +
              encodeURIComponent(branch) +
              '&year=' +
              encodeURIComponent(year) +
              '&include_data=1';
          var res = await fetch(q, { credentials: 'same-origin', cache: 'no-store' });
          var data = await res.json().catch(function () { return null; });
          if (!res.ok) {
            alert((data && data.error) || 'Could not open timetable');
            return;
          }
          var row = data.timetable || (data.timetables && data.timetables[0]);
          if (!row || !row.file_data) {
            alert('No file found for this year.');
            return;
          }
          ttOpenFile(row.file_data, row.mime_type, row.file_name);
        } catch (e) {
          alert('Could not open timetable');
        } finally {
          btn.disabled = false;
        }
      };
    });

    root.querySelectorAll('[data-tt-del]').forEach(function (btn) {
      btn.onclick = async function () {
        var branch = btn.getAttribute('data-tt-del');
        var year = btn.getAttribute('data-tt-year');
        if (!confirm('Remove ' + ttYearLabel(Number(year)) + ' timetable for ' + (TT_SHORT[branch] || branch) + '?')) {
          return;
        }
        try {
          var res = await fetch(
            '/api/timetables?branch=' +
              encodeURIComponent(branch) +
              '&year=' +
              encodeURIComponent(year),
            { method: 'DELETE', credentials: 'same-origin' },
          );
          var data = await res.json().catch(function () { return null; });
          if (!res.ok) {
            alert((data && data.error) || 'Delete failed');
            return;
          }
          window.setupTimetableUploadPanel();
        } catch (e) {
          alert('Delete failed');
        }
      };
    });
  }

  window.showFacTTBranch = function showFacTTBranch(tabId, btn) {
    TT_BRANCHES.forEach(function (b) {
      var id = TT_PANEL_ID[b];
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var el = document.getElementById(tabId);
    if (el) el.style.display = 'block';
    if (btn && btn.closest) {
      var tabs = btn.closest('.tabs');
      if (tabs) {
        tabs.querySelectorAll('.tab').forEach(function (t) {
          t.classList.remove('act');
        });
        btn.classList.add('act');
      }
    }
  };

  window.setupTimetableUploadPanel = async function setupTimetableUploadPanel() {
    var root = document.getElementById('facTimetable');
    if (!root) return;

    var user = window.currentUser;
    var role = user && user.role ? String(user.role).toLowerCase() : '';
    var canWrite = role === 'admin' || role === 'principal' || role === 'hod' || role === 'faculty';
    var myBranch = ttUserBranch(user); // empty for admin/principal = all branches

    root.innerHTML =
      '<div class="info-box">📅 <strong>Timetable Upload</strong> — Upload year-wise timetables for your department. ' +
      'Students only see their branch timetable. This is separate from Attendance Management.</div>' +
      '<div class="warn-box" id="ttWarnBox">Loading…</div>' +
      '<div id="ttUploadHost"><div style="padding:18px;opacity:.7;">Loading timetables…</div></div>' +
      '<input type="file" id="ttFileInput" accept=".pdf,image/png,image/jpeg,image/jpg,image/webp,application/pdf" style="display:none" />';

    var warn = document.getElementById('ttWarnBox');
    var host = document.getElementById('ttUploadHost');

    try {
      var q = '/api/timetables';
      if (myBranch) q += '?branch=' + encodeURIComponent(myBranch);
      var res = await fetch(q + (q.indexOf('?') >= 0 ? '&' : '?') + '_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data) {
        if (warn) {
          warn.innerHTML =
            '⚠️ Could not load timetables. ' + ((data && data.error) || 'Please refresh and try again.');
        }
        if (host) host.innerHTML = '';
        return;
      }

      var list = Array.isArray(data.timetables) ? data.timetables : [];
      var branches =
        myBranch
          ? [myBranch]
          : Array.isArray(data.branches) && data.branches.length
            ? data.branches.map(ttNormBranch).filter(Boolean)
            : TT_BRANCHES.slice();

      // Deduplicate + keep official order
      branches = TT_BRANCHES.filter(function (b) {
        return branches.some(function (x) {
          return ttNormBranch(x) === b;
        });
      });
      if (!branches.length && myBranch) branches = [myBranch];
      if (!branches.length) branches = TT_BRANCHES.slice();

      if (warn) {
        if (myBranch) {
          warn.innerHTML =
            '🎓 <strong>' +
            (role === 'hod' ? 'HOD' : 'Faculty') +
            ' — ' +
            ttEsc(myBranch) +
            '</strong> — You can upload / replace timetables only for your branch. ' +
            'Students of other branches will not see these files.';
        } else {
          warn.innerHTML =
            '⚠️ <strong>All branches</strong> — As Admin/Principal you can manage every department timetable. ' +
            'Students only see their own branch.';
        }
      }

      var html = '';
      if (branches.length > 1) {
        html += '<div class="tabs" style="margin-bottom:18px;" id="ttBranchTabs">';
        branches.forEach(function (b, i) {
          var pid = TT_PANEL_ID[b] || 'ft_' + i;
          html +=
            '<button type="button" class="tab' +
            (i === 0 ? ' act' : '') +
            '" data-tt-tab="' +
            ttEsc(pid) +
            '">' +
            ttEsc(TT_SHORT[b] || b) +
            '</button>';
        });
        html += '</div>';
      } else if (branches.length === 1) {
        html +=
          '<div style="margin-bottom:14px;font-weight:600;color:var(--navy);font-size:0.95rem;">' +
          '📁 ' +
          ttEsc(branches[0]) +
          '</div>';
      }

      branches.forEach(function (b, i) {
        var pid = TT_PANEL_ID[b] || 'ft_' + i;
        html +=
          '<div id="' +
          ttEsc(pid) +
          '" class="tt-branch-panel" style="' +
          (i === 0 ? '' : 'display:none;') +
          '">' +
          '<div class="tt-upload-grid">';
        TT_YEARS.forEach(function (y) {
          html += ttCardHtml(b, y, ttFindRow(list, b, y), canWrite);
        });
        html += '</div></div>';
      });

      if (host) host.innerHTML = html;

      // Tab clicks
      var tabs = document.getElementById('ttBranchTabs');
      if (tabs) {
        tabs.querySelectorAll('[data-tt-tab]').forEach(function (btn) {
          btn.onclick = function () {
            window.showFacTTBranch(btn.getAttribute('data-tt-tab'), btn);
          };
        });
      }

      ttBindPanel(root, list, branches, canWrite);
    } catch (e) {
      console.warn('[tt] setup', e);
      if (warn) warn.innerHTML = '⚠️ Failed to load timetable panel.';
    }
  };

  function ttParseStudyYear(v) {
    if (v === 1 || v === 2 || v === 3) return Number(v);
    var n = Number(v);
    if (n === 1 || n === 2 || n === 3) return n;
    var s = String(v == null ? '' : v).toLowerCase();
    if (!s) return null;
    if (/alumni|pass/.test(s)) return null;
    if (/\b3\b|iii|third|3rd/.test(s)) return 3;
    if (/\b2\b|ii|second|2nd/.test(s)) return 2;
    if (/\b1\b|\bi\b|first|1st/.test(s)) return 1;
    return null;
  }

  /** Resolve logged-in student's study year (1/2/3) from session + live student row. */
  async function ttResolveStudentStudyYear(user) {
    var y = null;
    try {
      if (user && user.academic) {
        y = ttParseStudyYear(user.academic.current_study_year);
        if (!y) y = ttParseStudyYear(user.academic.year_label);
      }
    } catch (e) { /* ignore */ }
    if (y) return y;

    // Live students API (has current_study_year / year)
    try {
      var res = await fetch('/api/students?_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await res.json().catch(function () { return null; });
      var list = data && Array.isArray(data.students) ? data.students : [];
      var mine = list[0] || null;
      if (mine) {
        y = ttParseStudyYear(mine.current_study_year);
        if (!y) y = ttParseStudyYear(mine.year);
        if (!y && mine.academic) {
          y = ttParseStudyYear(mine.academic.current_study_year || mine.academic.year_label);
        }
      }
    } catch (e) { /* ignore */ }
    return y;
  }

  window.setupStudentTimetablePanel = async function setupStudentTimetablePanel() {
    var root = document.getElementById('stuTimetable');
    if (!root) return;
    var user = window.currentUser;
    var branch = ttUserBranch(user) || ttNormBranch(user && user.branch);

    try {
      if (!branch && typeof window.STU_BRANCH !== 'undefined') branch = ttNormBranch(window.STU_BRANCH);
    } catch (e) { /* ignore */ }

    root.innerHTML =
      '<div class="info-box">📅 <strong>Time Table</strong> — You only see the timetable for <strong>your branch and study year</strong> ' +
      '(1st year students see 1st year only, 2nd year see 2nd year only, etc.).</div>' +
      '<div id="stuTtHost"><div style="padding:16px;opacity:.7;">Loading…</div></div>';

    var host = document.getElementById('stuTtHost');
    try {
      var myYear = await ttResolveStudentStudyYear(user);

      // API also enforces branch + year for students
      var url = '/api/timetables?_ts=' + Date.now();
      if (branch) url += '&branch=' + encodeURIComponent(branch);
      if (myYear) url += '&year=' + encodeURIComponent(myYear);
      var res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data) {
        if (host) {
          host.innerHTML =
            '<div class="warn-box">Could not load timetable. ' +
            ((data && data.error) || 'Please try again.') +
            '</div>';
        }
        return;
      }
      branch = ttNormBranch(data.branch || branch) || branch;
      var list = Array.isArray(data.timetables) ? data.timetables : [];

      // Server study year wins (enforced for students)
      var studyYear = ttParseStudyYear(data.study_year) || myYear;
      if (!studyYear && list.length === 1) {
        studyYear = ttParseStudyYear(list[0].study_year);
      }

      if (!studyYear) {
        if (host) {
          host.innerHTML =
            '<div class="warn-box">⚠ Your study year is not set on your student record yet. ' +
            'Contact HOD / Admin so your year (1st / 2nd / 3rd) is assigned — then your timetable will appear here.</div>';
        }
        return;
      }

      var row = ttFindRow(list, branch, studyYear) || (list.length === 1 ? list[0] : null);

      var html =
        '<div style="margin-bottom:12px;font-weight:600;color:var(--navy);">' +
        '📁 ' +
        ttEsc(branch || 'Your branch') +
        ' · ' +
        ttEsc(ttYearLabel(studyYear)) +
        ' only' +
        '</div>' +
        '<div class="card" style="padding:16px;">' +
        '<div class="card-hd" style="border:none;padding:0 0 10px 0;"><h3 style="margin:0;">📅 ' +
        ttEsc(TT_SHORT[branch] || branch || 'Branch') +
        ' — ' +
        ttEsc(ttYearLabel(studyYear)) +
        ' Timetable</h3></div>';

      if (row) {
        html +=
          '<p style="font-size:0.8rem;opacity:.75;margin:0 0 12px;">Last updated: ' +
          ttEsc(ttFmtDate(row.updated_at || row.created_at)) +
          (row.uploaded_by_name ? ' · ' + ttEsc(row.uploaded_by_name) : '') +
          '</p>' +
          '<button type="button" class="btn pr" data-stu-tt-view="' +
          ttEsc(row.id) +
          '">👁️ View / Download Timetable</button>';
      } else {
        html +=
          '<div class="warn-box" style="margin:0;">⚠ Your ' +
          ttEsc(ttYearLabel(studyYear)) +
          ' timetable has not been uploaded yet. Contact your department faculty / HOD.</div>';
      }
      html += '</div>';

      if (host) host.innerHTML = html;

      root.querySelectorAll('[data-stu-tt-view]').forEach(function (btn) {
        btn.onclick = async function () {
          var id = btn.getAttribute('data-stu-tt-view');
          btn.disabled = true;
          try {
            var r = await fetch(
              '/api/timetables?id=' + encodeURIComponent(id) + '&include_data=1',
              { credentials: 'same-origin', cache: 'no-store' },
            );
            var d = await r.json().catch(function () { return null; });
            var fileRow = d && d.timetable;
            if (!r.ok || !fileRow || !fileRow.file_data) {
              alert((d && d.error) || 'Could not open timetable');
              return;
            }
            ttOpenFile(fileRow.file_data, fileRow.mime_type, fileRow.file_name);
          } catch (e) {
            alert('Could not open timetable');
          } finally {
            btn.disabled = false;
          }
        };
      });
    } catch (e) {
      console.warn('[tt] student', e);
      if (host) host.innerHTML = '<div class="warn-box">Failed to load timetable.</div>';
    }
  };

  console.log('[bridge] timetable live handlers installed');
})();

/* ============================================================
 * LIVE FORMS / SURVEYS — Admin builder, student Submit Forms,
 * verifier inbox (ACM etc.), PDF for verified responses.
 * ============================================================ */
;(function () {
  'use strict';

  var VERIFY_ROLES = [
    { v: 'none', t: 'No verification (auto-accept)' },
    { v: 'admin', t: 'Root Admin' },
    { v: 'principal', t: 'Principal' },
    { v: 'hod', t: 'HOD' },
    { v: 'acm', t: 'ACM Section' },
    { v: 'exam', t: 'Exam Cell' },
    { v: 'registrar', t: 'Registrar' },
    { v: 'est', t: 'EST' },
  ];

  function fEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fFmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '—';
    }
  }

  function audienceLabel(a) {
    a = String(a || 'students').toLowerCase();
    if (a === 'staff') return 'Staff';
    if (a === 'both') return 'Students + Staff';
    return 'Students';
  }

  function verifyLabel(r) {
    r = String(r || 'admin').toLowerCase();
    for (var i = 0; i < VERIFY_ROLES.length; i++) {
      if (VERIFY_ROLES[i].v === r) return VERIFY_ROLES[i].t;
    }
    return r;
  }

  function statusBadge(st) {
    st = String(st || '').toLowerCase();
    if (st === 'open' || st === 'verified' || st === 'approved') return 'approved';
    if (st === 'pending') return 'pending';
    if (st === 'rejected' || st === 'closed') return 'rejected';
    if (st === 'draft') return 'info';
    return '';
  }

  /** Inject audience + verifier fields into form builder modal. */
  window.ensureFormBuilderMeta = function ensureFormBuilderMeta() {
    if (document.getElementById('fbAudience')) return;
    var titleEl = document.getElementById('fbFormTitle');
    if (!titleEl) return;
    var host = titleEl.parentNode;
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.id = 'fbLiveMeta';
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;';
    wrap.innerHTML =
      '<div><label style="font-size:0.72rem;font-weight:700;opacity:.85;display:block;margin-bottom:4px;">Audience</label>' +
      '<select id="fbAudience" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.15);color:#fff;font-size:0.82rem;">' +
      '<option value="students">Students</option>' +
      '<option value="staff">Staff</option>' +
      '<option value="both">Students + Staff</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;opacity:.85;display:block;margin-bottom:4px;">Verifier (approves submissions)</label>' +
      '<select id="fbVerifyRole" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.15);color:#fff;font-size:0.82rem;">' +
      VERIFY_ROLES.map(function (r) {
        return '<option value="' + r.v + '"' + (r.v === 'acm' ? ' selected' : '') + '>' + fEsc(r.t) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;opacity:.85;display:block;margin-bottom:4px;">Status</label>' +
      '<select id="fbFormStatus" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.15);color:#fff;font-size:0.82rem;">' +
      '<option value="open">Open (published)</option>' +
      '<option value="draft">Draft</option>' +
      '<option value="closed">Closed</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;opacity:.85;display:block;margin-bottom:4px;">Priority</label>' +
      '<select id="fbPriority" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:rgba(0,0,0,0.15);color:#fff;font-size:0.82rem;">' +
      '<option value="normal">Normal</option><option value="important">Important</option><option value="emergency">Emergency</option></select></div>' +
      '<input type="hidden" id="fbFormId" value="" />';
    host.appendChild(wrap);
  };

  window.ensureFormVerifyMenu = function ensureFormVerifyMenu(user) {
    if (!user) return;
    var role = String(user.role || '').toLowerCase();
    var shells = [];
    if (role === 'acm' || role === 'admin') {
      shells.push({ root: '#dbFaculty', sec: 'facFormVerify', label: 'Form verifications' });
      shells.push({ root: '#dbAdmin', sec: 'adFormVerify', label: 'Form verifications' });
    }
    if (role === 'exam' || role === 'hod' || role === 'principal' || role === 'registrar' || role === 'est') {
      shells.push({ root: '#dbFaculty', sec: 'facFormVerify', label: 'Form verifications' });
      if (role === 'principal' || role === 'admin') {
        shells.push({ root: '#dbPrincipal', sec: 'adFormVerify', label: 'Form verifications' });
      }
    }
    shells.forEach(function (cfg) {
      var menu = document.querySelector(cfg.root + ' .sb-menu');
      if (!menu) return;
      if (menu.querySelector('[data-form-verify-nav="1"]')) return;
      var item = document.createElement('div');
      item.className = 'sl';
      item.setAttribute('data-form-verify-nav', '1');
      item.setAttribute('onclick', "showSec('" + cfg.sec + "',this)");
      item.innerHTML =
        '<span class="sli">✅</span>Form verifications<span class="slb bridge-badge" id="formVerifyBadge" style="display:none;">0</span>';
      // Prefer after ACM / Approvals
      var after = null;
      menu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        if (oc.indexOf('facACM') >= 0 || oc.indexOf('adACM') >= 0 || oc.indexOf('Approvals') >= 0) after = sl;
      });
      if (after && after.nextSibling) after.parentNode.insertBefore(item, after.nextSibling);
      else menu.appendChild(item);

      // Panel host
      var main = document.querySelector(cfg.root + ' .db-content') || document.querySelector(cfg.root + ' .db-main');
      if (main && !document.getElementById(cfg.sec)) {
        var panel = document.createElement('div');
        panel.id = cfg.sec;
        panel.style.display = 'none';
        panel.innerHTML =
          '<div class="info-box">✅ <strong>Form verifications</strong> — Approve or reject survey submissions assigned to your desk.</div>' +
          '<div id="' + cfg.sec + 'Body"><div style="padding:16px;opacity:.7;">Loading…</div></div>';
        main.appendChild(panel);
      }
    });
    // Refresh badge
    if (typeof window.refreshFormVerifyBadge === 'function') window.refreshFormVerifyBadge();
  };

  window.refreshFormVerifyBadge = async function refreshFormVerifyBadge() {
    try {
      var res = await fetch('/api/forms?pending_verify=1&_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await res.json().catch(function () { return null; });
      var n = data && data.pending_count != null ? Number(data.pending_count) : 0;
      document.querySelectorAll('#formVerifyBadge, .form-verify-badge').forEach(function (b) {
        if (n > 0) {
          b.style.display = '';
          b.textContent = String(n);
        } else {
          b.style.display = 'none';
        }
      });
    } catch (e) { /* ignore */ }
  };

  window.renderLiveFormManager = async function renderLiveFormManager() {
    window.ensureFormBuilderMeta();
    // Prefer full #adForms rewrite so old static shell can never stick
    var adForms = document.getElementById('adForms');
    var listView = document.getElementById('formListView');
    if (adForms) {
      adForms.innerHTML =
        '<div id="gpthLiveFormsStamp" data-live-forms="1" style="display:none;"></div>' +
        '<div class="info-box">📝 <strong>Form Builder (live)</strong> — Create surveys, set <strong>who verifies</strong> (ACM / HOD / …), publish to students or staff. Delete removes all submissions.</div>' +
        '<div id="formListView">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">' +
        '<div><h3 style="font-family:Libre Baskerville,serif;font-size:0.95rem;color:var(--navy);margin:0;">My Forms</h3>' +
        '<div style="font-size:0.75rem;opacity:.75;margin-top:4px;">Verifier is required before publish. File fields support max size (MB).</div></div>' +
        '<button type="button" class="btn pr" id="liveCreateFormBtn">+ Create New Form</button></div>' +
        '<div class="card"><div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;"><thead><tr>' +
        '<th style="text-align:left;padding:10px;">Form</th>' +
        '<th style="text-align:left;padding:10px;">Audience / Verifier</th>' +
        '<th style="text-align:left;padding:10px;">Status</th>' +
        '<th style="text-align:left;padding:10px;">Actions</th></tr></thead>' +
        '<tbody id="formListBody"><tr><td colspan="4" style="padding:20px;opacity:.7;">Loading forms from server…</td></tr></tbody></table></div></div>' +
        '<div id="liveFormResponsesPanel" style="display:none;margin-top:16px;"></div></div>';
      listView = document.getElementById('formListView');
    } else if (listView) {
      listView.innerHTML =
        '<div id="gpthLiveFormsStamp" data-live-forms="1" style="display:none;"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">' +
        '<div><h3 style="margin:0;color:var(--navy);">My Forms (live)</h3></div>' +
        '<button type="button" class="btn pr" id="liveCreateFormBtn">+ Create New Form</button></div>' +
        '<div class="card"><table style="width:100%;"><thead><tr><th>Form</th><th>Audience / Verifier</th><th>Status</th><th>Actions</th></tr></thead>' +
        '<tbody id="formListBody"><tr><td colspan="4">Loading…</td></tr></tbody></table></div>' +
        '<div id="liveFormResponsesPanel" style="display:none;margin-top:16px;"></div>';
    }
    var createBtn = document.getElementById('liveCreateFormBtn');
    if (createBtn) {
      createBtn.onclick = function () {
        window.openLiveFormEditor(null);
      };
    }
    var tbody = document.getElementById('formListBody');
    if (!tbody) {
      console.warn('[forms] formListBody missing — cannot render manager');
      return;
    }
    try {
      var res = await fetch('/api/forms?_ts=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !Array.isArray(data.forms)) {
        tbody.innerHTML =
          '<tr><td colspan="4" style="padding:20px;color:#991b1b;">Could not load forms. ' +
          fEsc((data && data.error) || 'Hard-refresh and try again.') +
          '</td></tr>';
        return;
      }
      window._liveForms = data.forms;
      if (!data.forms.length) {
        tbody.innerHTML =
          '<tr id="formEmptyRow"><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px;font-size:0.82rem;">No forms yet. Click <strong>+ Create New Form</strong>.</td></tr>';
        return;
      }
      tbody.innerHTML = data.forms
        .map(function (f) {
          var st = String(f.status || 'open');
          var pending = f.pending_count != null ? f.pending_count : 0;
          return (
            '<tr data-form-id="' +
            f.id +
            '">' +
            '<td><strong>📋 ' +
            fEsc(f.title) +
            '</strong>' +
            (f.description
              ? '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:3px;">' + fEsc(f.description) + '</div>'
              : '') +
            '<div style="font-size:0.68rem;margin-top:4px;opacity:.75;">' +
            (f.response_count || 0) +
            ' response(s)' +
            (pending ? ' · <strong style="color:#b45309;">' + pending + ' pending</strong>' : '') +
            '</div></td>' +
            '<td style="font-size:0.78rem;">' +
            fEsc(audienceLabel(f.audience)) +
            '<br/><strong>Verifier:</strong> ' +
            fEsc(verifyLabel(f.verify_role)) +
            '</td>' +
            '<td><span class="badge ' +
            statusBadge(st) +
            '">' +
            fEsc(st) +
            '</span></td>' +
            '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">' +
            '<button type="button" class="btn pr" data-live-form-edit="' +
            f.id +
            '">✏️ Edit form</button>' +
            '<button type="button" class="btn go" data-live-form-responses="' +
            f.id +
            '">📥 Responses</button>' +
            (st === 'open'
              ? '<button type="button" class="btn ol" data-live-form-close="' + f.id + '">Close</button>'
              : '<button type="button" class="btn ol" data-live-form-open="' + f.id + '">Publish</button>') +
            '<button type="button" class="btn re" data-live-form-del="' +
            f.id +
            '">🗑 Delete all</button>' +
            '</div></td></tr>'
          );
        })
        .join('');

      tbody.querySelectorAll('[data-live-form-edit]').forEach(function (btn) {
        btn.onclick = function () {
          var id = Number(btn.getAttribute('data-live-form-edit'));
          var f = (window._liveForms || []).find(function (x) { return Number(x.id) === id; });
          if (f) window.openLiveFormEditor(f);
        };
      });
      tbody.querySelectorAll('[data-live-form-del]').forEach(function (btn) {
        btn.onclick = async function () {
          var id = btn.getAttribute('data-live-form-del');
          if (
            !confirm(
              'DELETE this form and ALL submissions from the database?\n\nStudents will no longer see this form. This cannot be undone.',
            )
          ) {
            return;
          }
          var r = await fetch('/api/forms?id=' + encodeURIComponent(id), {
            method: 'DELETE',
            credentials: 'same-origin',
          });
          var d = await r.json().catch(function () { return null; });
          if (!r.ok) {
            alert((d && d.error) || 'Delete failed');
            return;
          }
          alert(
            'Form deleted' +
              (d && d.deleted_responses != null ? ' (' + d.deleted_responses + ' response(s) erased)' : '') +
              '.',
          );
          window.renderLiveFormManager();
        };
      });
      tbody.querySelectorAll('[data-live-form-close]').forEach(function (btn) {
        btn.onclick = function () {
          window.setLiveFormStatus(Number(btn.getAttribute('data-live-form-close')), 'closed');
        };
      });
      tbody.querySelectorAll('[data-live-form-open]').forEach(function (btn) {
        btn.onclick = function () {
          window.setLiveFormStatus(Number(btn.getAttribute('data-live-form-open')), 'open');
        };
      });
      tbody.querySelectorAll('[data-live-form-responses]').forEach(function (btn) {
        btn.onclick = function () {
          window.viewLiveFormResponses(Number(btn.getAttribute('data-live-form-responses')));
        };
      });
    } catch (e) {
      console.warn('[forms] manager', e);
      tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;color:#991b1b;">Failed to load.</td></tr>';
    }
  };

  window.setLiveFormStatus = async function setLiveFormStatus(id, status) {
    var f = (window._liveForms || []).find(function (x) { return Number(x.id) === id; });
    if (!f) return;
    var res = await fetch('/api/forms', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: f.id,
        title: f.title,
        description: f.description,
        fields: f.fields,
        status: status,
        audience: f.audience,
        verify_role: f.verify_role,
        priority: f.priority,
      }),
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) {
      alert((data && data.error) || 'Update failed');
      return;
    }
    window.renderLiveFormManager();
  };

  window.openLiveFormEditor = function openLiveFormEditor(f) {
    window.ensureFormBuilderMeta();
    window._editingFormId = f ? f.id : null;
    // Clear modal via original opener when available
    if (typeof window.openCreateFormModal === 'function') {
      try {
        // Call original if we wrapped it — clear canvas
        var titleEl0 = document.getElementById('fbFormTitle');
        var canvas0 = document.getElementById('gfCanvas');
        var modal0 = document.getElementById('formBuilderModal');
        if (titleEl0) titleEl0.value = '';
        if (canvas0) {
          canvas0.innerHTML =
            '<div id="gfEmptyHint" style="text-align:center;color:#94a3b8;padding:32px;background:white;border-radius:10px;font-size:0.82rem;">Click a field type above to add questions</div>';
        }
        if (modal0) modal0.style.display = 'flex';
      } catch (e) { /* ignore */ }
    }
    window.ensureFormBuilderMeta();
    var titleEl = document.getElementById('fbFormTitle');
    var descEl = document.getElementById('fbFormDesc');
    var canvas = document.getElementById('gfCanvas');
    if (titleEl) titleEl.value = f ? f.title || '' : '';
    if (descEl) descEl.value = f ? f.description || '' : '';
    var idEl = document.getElementById('fbFormId');
    if (idEl) idEl.value = f && f.id ? String(f.id) : '';
    var aud = document.getElementById('fbAudience');
    if (aud) aud.value = (f && f.audience) || 'students';
    var vr = document.getElementById('fbVerifyRole');
    if (vr) vr.value = (f && f.verify_role) || 'acm';
    var st = document.getElementById('fbFormStatus');
    if (st) st.value = (f && f.status) || 'open';
    var pr = document.getElementById('fbPriority');
    if (pr) pr.value = (f && f.priority) || 'normal';

    if (f && canvas && typeof window.buildFieldCard === 'function') {
      canvas.innerHTML = '';
      var fields = Array.isArray(f.fields) ? f.fields : [];
      if (typeof f.fields === 'string') {
        try {
          fields = JSON.parse(f.fields);
        } catch (e) {
          fields = [];
        }
      }
      if (!fields.length) {
        canvas.innerHTML =
          '<div id="gfEmptyHint" style="text-align:center;color:#94a3b8;padding:32px;background:white;border-radius:10px;font-size:0.82rem;">Click a field type above to add questions</div>';
      } else {
        fields.forEach(function (fd) {
          window.buildFieldCard({
            id: fd.id || 'gff_' + Math.random().toString(36).slice(2, 8),
            type: fd.type || 'text',
            question: fd.question || fd.label || '',
            required: !!fd.required,
            options: fd.options || [],
            desc: fd.desc || '',
            max_mb: fd.max_mb,
          });
        });
      }
    }
    var modal = document.getElementById('formBuilderModal');
    if (modal) modal.style.display = 'flex';
  };

  // Override save to API
  window.saveGFForm = async function saveGFForm() {
    window.ensureFormBuilderMeta();
    var title = (document.getElementById('fbFormTitle') && document.getElementById('fbFormTitle').value || '').trim();
    if (!title) {
      alert('Please enter a form title.');
      return;
    }
    var desc = (document.getElementById('fbFormDesc') && document.getElementById('fbFormDesc').value || '').trim();
    var fields = typeof window.collectGFFields === 'function' ? window.collectGFFields() : [];
    // Normalize labels for API (question field)
    fields = fields.map(function (fd) {
      var out = {
        id: fd.id,
        type: fd.type,
        question: fd.question || fd.label || '',
        label: fd.question || fd.label || '',
        required: !!fd.required,
        options: fd.options || [],
      };
      if (String(fd.type || '').toLowerCase() === 'file') {
        var n = Number(fd.max_mb);
        out.max_mb = Number.isFinite(n) && n > 0 ? Math.min(15, Math.max(0.5, n)) : 2;
        out.accept = fd.accept || '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip';
      }
      return out;
    });
    var idEl = document.getElementById('fbFormId');
    var verifyRole =
      (document.getElementById('fbVerifyRole') && document.getElementById('fbVerifyRole').value) || '';
    var status =
      (document.getElementById('fbFormStatus') && document.getElementById('fbFormStatus').value) || 'open';
    if (status === 'open' && !verifyRole) {
      alert('Choose who verifies this form before publishing (Audience + Verifier).');
      return;
    }
    var body = {
      title: title,
      description: desc,
      fields: fields,
      audience: (document.getElementById('fbAudience') && document.getElementById('fbAudience').value) || 'students',
      verify_role: verifyRole || 'acm',
      status: status,
      priority: (document.getElementById('fbPriority') && document.getElementById('fbPriority').value) || 'normal',
    };
    if (idEl && idEl.value) body.id = Number(idEl.value);
    try {
      var res = await fetch('/api/forms', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        alert((data && data.error) || 'Save failed');
        return;
      }
      if (typeof window.closeFBModal === 'function') window.closeFBModal();
      alert(
        'Form saved (' +
          fields.length +
          ' questions).\nAudience: ' +
          audienceLabel(body.audience) +
          '\nVerifier: ' +
          verifyLabel(body.verify_role) +
          '\nStatus: ' +
          body.status,
      );
      window.renderLiveFormManager();
    } catch (e) {
      alert('Network error saving form');
    }
  };

  window.viewLiveFormResponses = async function viewLiveFormResponses(formId) {
    var panel = document.getElementById('liveFormResponsesPanel');
    if (!panel) {
      alert('Open Form Builder section first.');
      return;
    }
    panel.style.display = 'block';
    panel.innerHTML = '<div class="card" style="padding:16px;">Loading responses…</div>';
    try {
      var res = await fetch('/api/forms/' + formId + '/responses?_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        panel.innerHTML = '<div class="warn-box">' + fEsc((data && data.error) || 'Could not load') + '</div>';
        return;
      }
      var list = data.responses || [];
      var form = data.form || {};
      var html =
        '<div class="card" style="padding:16px;">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">' +
        '<h3 style="margin:0;color:var(--navy);">📥 Responses — ' +
        fEsc(form.title || '') +
        '</h3>' +
        '<button type="button" class="btn ol" id="liveRespClose">Close panel</button></div>';
      if (!list.length) {
        html += '<div class="info-box">No submissions yet.</div></div>';
        panel.innerHTML = html;
        document.getElementById('liveRespClose').onclick = function () {
          panel.style.display = 'none';
        };
        return;
      }
      list.forEach(function (r) {
        var answers = r.answers || {};
        if (typeof answers === 'string') {
          try {
            answers = JSON.parse(answers);
          } catch (e) {
            answers = {};
          }
        }
        var ansHtml = Object.keys(answers)
          .map(function (k) {
            var v = answers[k];
            var shown = v;
            if (v && typeof v === 'object' && (v.name || v.data)) {
              shown = '📎 ' + (v.name || 'file') + (v.size ? ' (' + Math.round(v.size / 1024) + ' KB)' : '');
            }
            return (
              '<div style="font-size:0.78rem;margin:3px 0;"><strong>' +
              fEsc(k) +
              ':</strong> ' +
              fEsc(shown) +
              '</div>'
            );
          })
          .join('');
        html +=
          '<div class="card" style="padding:12px;margin-bottom:10px;border:1px solid var(--border);border-radius:10px;" data-owner-resp="' +
          r.id +
          '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
          '<div><strong>' +
          fEsc(r.submitter_name || r.submitter_reg || 'User') +
          '</strong>' +
          '<div style="font-size:0.72rem;opacity:.75;">' +
          fEsc(r.submitter_reg || '') +
          ' · ' +
          fEsc(fFmtDate(r.submitted_at)) +
          ' · <span class="badge ' +
          statusBadge(r.status) +
          '">' +
          fEsc(r.status) +
          '</span></div>' +
          (r.edited_at
            ? '<div style="font-size:0.72rem;color:#1d4ed8;margin-top:3px;">Edited by ' +
              fEsc(r.edited_by_name || 'admin') +
              ' on ' +
              fEsc(fFmtDate(r.edited_at)) +
              (r.edit_note ? ' — ' + fEsc(r.edit_note) : '') +
              '</div>'
            : '') +
          '<div style="margin-top:8px;">' +
          ansHtml +
          '</div></div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">' +
          '<button type="button" class="btn pr" data-owner-edit="' +
          r.id +
          '">✏️ Edit answers</button>' +
          (String(r.status) === 'pending'
            ? '<button type="button" class="btn gr" data-owner-verify="' +
              r.id +
              '">✓ Verify</button>'
            : '') +
          '</div></div></div>';
      });
      html += '</div>';
      panel.innerHTML = html;
      document.getElementById('liveRespClose').onclick = function () {
        panel.style.display = 'none';
      };
      panel.querySelectorAll('[data-owner-edit]').forEach(function (btn) {
        btn.onclick = function () {
          var rid = Number(btn.getAttribute('data-owner-edit'));
          var r = list.find(function (x) {
            return Number(x.id) === rid;
          });
          if (r) window.openOwnerEditResponse(formId, r, form);
        };
      });
      panel.querySelectorAll('[data-owner-verify]').forEach(function (btn) {
        btn.onclick = async function () {
          await window.verifyFormResponse(formId, btn.getAttribute('data-owner-verify'), 'verify');
          window.viewLiveFormResponses(formId);
        };
      });
    } catch (e) {
      panel.innerHTML = '<div class="warn-box">Failed to load responses</div>';
    }
  };

  window.openOwnerEditResponse = function openOwnerEditResponse(formId, response, form) {
    var answers = response.answers || {};
    if (typeof answers === 'string') {
      try {
        answers = JSON.parse(answers);
      } catch (e) {
        answers = {};
      }
    }
    var keys = Object.keys(answers);
    if (!keys.length) {
      alert('No answers to edit');
      return;
    }
    var lines = keys
      .map(function (k) {
        var v = answers[k];
        if (v && typeof v === 'object') return k + ' = [file: ' + (v.name || 'attachment') + ']';
        return k + ' = ' + String(v == null ? '' : v);
      })
      .join('\n');
    var edited = prompt(
      'Edit answers as lines: Label = value\n(File fields keep as-is if you leave [file: …])\n\nCurrent:\n' +
        lines +
        '\n\nPaste full updated text:',
      lines,
    );
    if (edited == null) return;
    var next = {};
    edited.split('\n').forEach(function (line) {
      var i = line.indexOf('=');
      if (i < 0) return;
      var k = line.slice(0, i).trim();
      var v = line.slice(i + 1).trim();
      if (!k) return;
      if (/^\[file:/i.test(v) && answers[k] && typeof answers[k] === 'object') {
        next[k] = answers[k];
      } else {
        next[k] = v;
      }
    });
    var note = prompt('Edit note (shown to student, optional):', '') || '';
    fetch('/api/forms/' + formId + '/responses', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        response_id: response.id,
        action: 'edit',
        answers: next,
        edit_note: note,
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (x) {
        if (!x.ok) {
          alert((x.d && x.d.error) || 'Edit failed');
          return;
        }
        alert('Response updated. Student will see the new answers / PDF.');
        window.viewLiveFormResponses(formId);
      })
      .catch(function () {
        alert('Network error');
      });
  };

  // Hook Create button if present
  document.addEventListener(
    'click',
    function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest('button');
      if (!btn) return;
      var txt = (btn.textContent || '').trim();
      if (txt.indexOf('Create New Form') >= 0 || txt.indexOf('+ Create') >= 0) {
        // Let openCreateFormModal run, then clear id
        setTimeout(function () {
          window.ensureFormBuilderMeta();
          var idEl = document.getElementById('fbFormId');
          if (idEl) idEl.value = '';
          window._editingFormId = null;
        }, 50);
      }
    },
    true,
  );

  /** Student Submit Forms panel */
  window.renderStudentFormsPanel = async function renderStudentFormsPanel() {
    var root = document.getElementById('stuForms');
    if (!root) return;
    // Preserve structure: inject live host
    var host = document.getElementById('stuLiveFormsHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'stuLiveFormsHost';
      root.innerHTML = '';
      root.appendChild(host);
    }
    host.innerHTML = '<div style="padding:16px;opacity:.7;">Loading forms…</div>';
    try {
      var res = await fetch('/api/forms?_ts=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data) {
        host.innerHTML = '<div class="warn-box">Could not load forms.</div>';
        return;
      }
      var forms = Array.isArray(data.forms) ? data.forms : [];
      var open = forms.filter(function (f) {
        return String(f.status).toLowerCase() === 'open';
      });
      var mine = forms.filter(function (f) {
        return f.my_response;
      });

      var html =
        '<div class="info-box">📝 <strong>Submit Forms</strong> — Fill open surveys. Verified copies stay here for download/print.</div>';

      html += '<h3 style="margin:14px 0 8px;font-size:0.95rem;color:var(--navy);">Open forms</h3>';
      if (!open.length) {
        html += '<div class="info-box" style="opacity:.8;">No open forms right now.</div>';
      } else {
        open.forEach(function (f) {
          var my = f.my_response;
          var st = my ? String(my.status || '') : '';
          var canFill =
            !my || st === 'rejected' || (st !== 'pending' && st !== 'verified');
          // submitted_by_me blocks pending+verified
          if (f.submitted_by_me && st !== 'rejected') canFill = false;
          html +=
            '<div class="card" style="padding:14px 16px;margin-bottom:10px;border-left:4px solid #6d28d9;">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">' +
            '<div><strong>📋 ' +
            fEsc(f.title) +
            '</strong>' +
            (f.description
              ? '<div style="font-size:0.78rem;opacity:.75;margin-top:4px;">' + fEsc(f.description) + '</div>'
              : '') +
            '<div style="font-size:0.7rem;margin-top:6px;opacity:.7;">Verifier: ' +
            fEsc(verifyLabel(f.verify_role)) +
            '</div></div>';
          if (canFill) {
            html +=
              '<button type="button" class="btn pr" data-stu-fill-form="' +
              f.id +
              '">📝 Fill form</button>';
          } else if (st === 'pending') {
            html += '<span class="badge pending">Pending verification</span>';
          } else if (st === 'verified') {
            html += '<span class="badge approved">Verified</span>';
          }
          html += '</div></div>';
        });
      }

      html += '<h3 style="margin:18px 0 8px;font-size:0.95rem;color:var(--navy);">My submissions</h3>';
      if (!mine.length) {
        html += '<div class="info-box" style="opacity:.8;">No submissions yet.</div>';
      } else {
        mine.forEach(function (f) {
          var my = f.my_response || {};
          var st = String(my.status || '');
          html +=
            '<div class="card" style="padding:14px 16px;margin-bottom:10px;">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">' +
            '<div><strong>' +
            fEsc(f.title) +
            '</strong>' +
            '<div style="font-size:0.72rem;opacity:.75;margin-top:4px;">Submitted ' +
            fEsc(fFmtDate(my.submitted_at)) +
            (my.verified_at ? ' · Verified ' + fEsc(fFmtDate(my.verified_at)) : '') +
            (my.verified_by_name ? ' by ' + fEsc(my.verified_by_name) : '') +
            '</div>' +
            (my.verifier_note
              ? '<div style="font-size:0.75rem;margin-top:4px;color:#92400e;">Note: ' +
                fEsc(my.verifier_note) +
                '</div>'
              : '') +
            (my.edited_at
              ? '<div style="font-size:0.75rem;margin-top:4px;color:#1d4ed8;">Updated by ' +
                fEsc(my.edited_by_name || 'admin') +
                ' on ' +
                fEsc(fFmtDate(my.edited_at)) +
                (my.edit_note ? ' — ' + fEsc(my.edit_note) : '') +
                '</div>'
              : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
            '<span class="badge ' +
            statusBadge(st) +
            '">' +
            fEsc(st || '—') +
            '</span>' +
            (st === 'verified' || st === 'pending'
              ? '<button type="button" class="btn go" data-stu-form-pdf="' +
                f.id +
                '" data-resp-id="' +
                fEsc(my.id) +
                '">⬇ PDF</button>'
              : '') +
            (st === 'rejected'
              ? '<button type="button" class="btn pr" data-stu-fill-form="' + f.id + '">Resubmit</button>'
              : '') +
            '</div></div></div>';
        });
      }

      host.innerHTML = html;

      host.querySelectorAll('[data-stu-fill-form]').forEach(function (btn) {
        btn.onclick = function () {
          var id = Number(btn.getAttribute('data-stu-fill-form'));
          var f = forms.find(function (x) { return Number(x.id) === id; });
          if (f) window.openStudentFormFill(f);
        };
      });
      host.querySelectorAll('[data-stu-form-pdf]').forEach(function (btn) {
        btn.onclick = function () {
          window.downloadStudentFormPdf(
            Number(btn.getAttribute('data-stu-form-pdf')),
            Number(btn.getAttribute('data-resp-id')),
          );
        };
      });
    } catch (e) {
      console.warn('[forms] student', e);
      host.innerHTML = '<div class="warn-box">Failed to load forms.</div>';
    }
  };

  window.openStudentFormFill = function openStudentFormFill(form) {
    var fields = form.fields;
    if (typeof fields === 'string') {
      try { fields = JSON.parse(fields); } catch (e) { fields = []; }
    }
    if (!Array.isArray(fields)) fields = [];

    var overlay = document.getElementById('stuFormFillOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'stuFormFillOverlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:10050;background:rgba(15,23,42,0.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;';
      document.body.appendChild(overlay);
    }
    var html =
      '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;padding:20px 18px;margin-bottom:40px;box-shadow:0 20px 50px rgba(0,0,0,.25);">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:12px;">' +
      '<div><h2 style="margin:0;font-size:1.15rem;color:#0f2d5c;">' +
      fEsc(form.title) +
      '</h2>' +
      (form.description
        ? '<p style="margin:6px 0 0;font-size:0.82rem;color:#64748b;">' + fEsc(form.description) + '</p>'
        : '') +
      '</div>' +
      '<button type="button" id="stuFormFillClose" class="btn ol" style="padding:6px 10px;">✕</button></div>' +
      '<div id="stuFormFillErr" style="display:none;color:#991b1b;font-size:0.82rem;margin-bottom:10px;"></div>' +
      '<div id="stuFormFillBody"></div>' +
      '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button type="button" class="btn ol" id="stuFormFillCancel">Cancel</button>' +
      '<button type="button" class="btn pr" id="stuFormFillSubmit">Submit</button></div></div>';
    overlay.innerHTML = html;
    overlay.style.display = 'flex';

    var body = document.getElementById('stuFormFillBody');
    var answers = {};
    fields.forEach(function (fd, idx) {
      if (String(fd.type || '').toLowerCase() === 'section') {
        body.innerHTML +=
          '<div style="margin:14px 0 8px;padding:8px 10px;background:#e8f0fe;border-left:3px solid #1a4fa0;font-weight:800;color:#0f2d5c;">' +
          fEsc(fd.question || fd.label || 'Section') +
          '</div>';
        return;
      }
      var key = String(fd.question || fd.label || 'Q' + (idx + 1)).trim();
      var type = String(fd.type || 'text').toLowerCase();
      var req = fd.required ? ' <span style="color:#dc2626">*</span>' : '';
      var fid = 'sff_' + (fd.id || idx);
      var block = '<div style="margin-bottom:12px;"><label style="font-weight:700;font-size:0.82rem;display:block;margin-bottom:4px;">' + fEsc(key) + req + '</label>';
      if (type === 'paragraph' || type === 'textarea') {
        block +=
          '<textarea id="' +
          fid +
          '" data-fkey="' +
          fEsc(key) +
          '" rows="3" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;"></textarea>';
      } else if (type === 'dropdown' || type === 'select') {
        block += '<select id="' + fid + '" data-fkey="' + fEsc(key) + '" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;"><option value="">Choose…</option>';
        (fd.options || []).forEach(function (o) {
          block += '<option value="' + fEsc(o) + '">' + fEsc(o) + '</option>';
        });
        block += '</select>';
      } else if (type === 'radio') {
        block += '<div data-fkey="' + fEsc(key) + '" data-fradio="1">';
        (fd.options || []).forEach(function (o, oi) {
          block +=
            '<label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:0.84rem;"><input type="radio" name="' +
            fid +
            '" value="' +
            fEsc(o) +
            '" /> ' +
            fEsc(o) +
            '</label>';
        });
        block += '</div>';
      } else if (type === 'checkbox') {
        block += '<div data-fkey="' + fEsc(key) + '" data-fcheck="1">';
        (fd.options || []).forEach(function (o) {
          block +=
            '<label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:0.84rem;"><input type="checkbox" value="' +
            fEsc(o) +
            '" /> ' +
            fEsc(o) +
            '</label>';
        });
        block += '</div>';
      } else if (type === 'date') {
        block +=
          '<input type="date" id="' +
          fid +
          '" data-fkey="' +
          fEsc(key) +
          '" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;" />';
      } else if (type === 'number') {
        block +=
          '<input type="number" id="' +
          fid +
          '" data-fkey="' +
          fEsc(key) +
          '" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;" />';
      } else if (type === 'file') {
        var maxMb = Number(fd.max_mb) > 0 ? Number(fd.max_mb) : 2;
        block +=
          '<input type="file" id="' +
          fid +
          '" data-fkey="' +
          fEsc(key) +
          '" data-ffile="1" data-max-mb="' +
          maxMb +
          '" accept="' +
          fEsc(fd.accept || '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip') +
          '" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;" />' +
          '<div style="font-size:0.7rem;opacity:.7;margin-top:4px;">Max ' +
          maxMb +
          ' MB</div>';
      } else {
        block +=
          '<input type="text" id="' +
          fid +
          '" data-fkey="' +
          fEsc(key) +
          '" style="width:100%;padding:8px 10px;border:1.5px solid #e2e8f0;border-radius:8px;" />';
      }
      block += '</div>';
      body.innerHTML += block;
    });

    function close() {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
    document.getElementById('stuFormFillClose').onclick = close;
    document.getElementById('stuFormFillCancel').onclick = close;
    document.getElementById('stuFormFillSubmit').onclick = async function () {
      var err = document.getElementById('stuFormFillErr');
      answers = {};
      var fileInputs = [];
      body.querySelectorAll('[data-fkey]').forEach(function (el) {
        var key = el.getAttribute('data-fkey');
        if (el.getAttribute('data-fradio') === '1') {
          var sel = el.querySelector('input[type=radio]:checked');
          answers[key] = sel ? sel.value : '';
        } else if (el.getAttribute('data-fcheck') === '1') {
          var vals = [];
          el.querySelectorAll('input[type=checkbox]:checked').forEach(function (c) {
            vals.push(c.value);
          });
          answers[key] = vals.join(', ');
        } else if (el.getAttribute('data-ffile') === '1' || el.type === 'file') {
          fileInputs.push(el);
        } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          answers[key] = el.value;
        }
      });

      function readFileAsAnswer(input) {
        return new Promise(function (resolve, reject) {
          var key = input.getAttribute('data-fkey');
          var file = input.files && input.files[0];
          var maxMb = Number(input.getAttribute('data-max-mb')) || 2;
          if (!file) {
            resolve({ key: key, value: null });
            return;
          }
          if (file.size > maxMb * 1024 * 1024) {
            reject(new Error('File for "' + key + '" exceeds max ' + maxMb + ' MB'));
            return;
          }
          if (file.size > 4 * 1024 * 1024) {
            reject(new Error('File for "' + key + '" is too large (server max 4 MB)'));
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            resolve({
              key: key,
              value: {
                name: file.name,
                mime: file.type || 'application/octet-stream',
                size: file.size,
                data: String(reader.result || ''),
              },
            });
          };
          reader.onerror = function () {
            reject(new Error('Could not read file for ' + key));
          };
          reader.readAsDataURL(file);
        });
      }

      try {
        var fileResults = await Promise.all(fileInputs.map(readFileAsAnswer));
        fileResults.forEach(function (fr) {
          answers[fr.key] = fr.value || '';
        });
      } catch (fe) {
        err.style.display = 'block';
        err.textContent = fe.message || 'File error';
        return;
      }

      for (var i = 0; i < fields.length; i++) {
        var fd = fields[i];
        if (String(fd.type || '').toLowerCase() === 'section') continue;
        if (!fd.required) continue;
        var k = String(fd.question || fd.label || '').trim();
        var av = answers[k];
        if (av == null || av === '') {
          err.style.display = 'block';
          err.textContent = 'Please answer: ' + k;
          return;
        }
        if (String(fd.type || '').toLowerCase() === 'file' && typeof av === 'object' && !av.data) {
          err.style.display = 'block';
          err.textContent = 'Please upload a file for: ' + k;
          return;
        }
      }
      err.style.display = 'none';
      try {
        var res = await fetch('/api/forms/' + form.id + '/responses', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answers: answers }),
        });
        var data = await res.json().catch(function () { return null; });
        if (!res.ok) {
          err.style.display = 'block';
          err.textContent = (data && data.error) || 'Submit failed';
          return;
        }
        close();
        alert(
          data.response && data.response.status === 'verified'
            ? 'Submitted and auto-verified. You can download the PDF from My submissions.'
            : 'Submitted. Waiting for verification (' + verifyLabel(form.verify_role) + ').',
        );
        window.renderStudentFormsPanel();
      } catch (e) {
        err.style.display = 'block';
        err.textContent = 'Network error';
      }
    };
  };

  window.downloadStudentFormPdf = async function downloadStudentFormPdf(formId, responseId) {
    try {
      var res = await fetch(
        '/api/forms/' +
          formId +
          '/responses?response_id=' +
          encodeURIComponent(responseId) +
          '&_ts=' +
          Date.now(),
        { credentials: 'same-origin', cache: 'no-store' },
      );
      var data = await res.json().catch(function () { return null; });
      if (!res.ok || !data || !data.response) {
        alert((data && data.error) || 'Could not load response');
        return;
      }
      var r = data.response;
      if (String(r.status).toLowerCase() !== 'verified') {
        alert('PDF is available after verification.');
        return;
      }
      // Use same CDN jspdf path as profile if available, else open print HTML
      if (typeof window.buildAndDownloadFormPdf === 'function') {
        await window.buildAndDownloadFormPdf(r, data.form || {});
        return;
      }
      // Lightweight HTML print fallback
      var answers = r.answers || {};
      if (typeof answers === 'string') {
        try { answers = JSON.parse(answers); } catch (e) { answers = {}; }
      }
      var rows = Object.keys(answers)
        .map(function (k) {
          return '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f2d5c;">' + fEsc(k) + '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;">' + fEsc(answers[k]) + '</td></tr>';
        })
        .join('');
      var html =
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
        fEsc(r.form_title || 'Form') +
        '</title></head><body style="font-family:system-ui;padding:24px;">' +
        '<h1 style="color:#0f2d5c;">' +
        fEsc(r.form_title || 'Form response') +
        '</h1>' +
        '<p>Submitted: ' +
        fEsc(fFmtDate(r.submitted_at)) +
        ' · Verified by ' +
        fEsc(r.verified_by_name || '') +
        ' on ' +
        fEsc(fFmtDate(r.verified_at)) +
        '</p>' +
        '<table style="width:100%;border-collapse:collapse;">' +
        rows +
        '</table></body></html>';
      if (typeof window.gpthPrintHtml === 'function') {
        window.gpthPrintHtml(html, { title: r.form_title || 'Form', autoPrint: false });
      } else {
        var w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
        }
      }
    } catch (e) {
      alert('Could not download PDF');
    }
  };

  // jsPDF form download (CDN)
  window.buildAndDownloadFormPdf = async function buildAndDownloadFormPdf(response, form) {
    if (typeof window.loadJsPdfUmd !== 'function' && typeof loadJsPdfUmd !== 'function') {
      // reuse profile loader if present
    }
    var loadPdf =
      window.loadJsPdfUmd ||
      function () {
        return new Promise(function (resolve, reject) {
          if (window.jspdf && window.jspdf.jsPDF) {
            resolve(window.jspdf.jsPDF);
            return;
          }
          var s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
          s.onload = function () {
            if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
            else reject(new Error('jspdf'));
          };
          s.onerror = reject;
          document.head.appendChild(s);
        });
      };
    // Prefer server-less client build: fetch full print via dynamic import not available — use HTML print for reliability in legacy
    // Actually call student app style is hard; keep HTML open which works
    var answers = response.answers || {};
    if (typeof answers === 'string') {
      try { answers = JSON.parse(answers); } catch (e) { answers = {}; }
    }
    try {
      var jsPDF = await loadPdf();
      var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      var y = 16;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('Government Polytechnic, Hubballi', 105, y, { align: 'center' });
      y += 8;
      pdf.setFontSize(14);
      pdf.text(String(response.form_title || form.title || 'Form'), 14, y);
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(
        'Status: ' +
          (response.status || '') +
          ' · Submitted: ' +
          fFmtDate(response.submitted_at) +
          ' · Verified: ' +
          fFmtDate(response.verified_at) +
          ' by ' +
          (response.verified_by_name || '—'),
        14,
        y,
      );
      y += 10;
      Object.keys(answers).forEach(function (k) {
        if (y > 270) {
          pdf.addPage();
          y = 16;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(11, 61, 110);
        pdf.text(String(k), 14, y);
        y += 5;
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(15, 23, 42);
        var lines = pdf.splitTextToSize(String(answers[k] == null ? '—' : answers[k]), 180);
        pdf.text(lines, 14, y);
        y += lines.length * 4.5 + 4;
      });
      pdf.save('form-' + (response.id || 'response') + '.pdf');
    } catch (e) {
      console.warn('[forms] pdf', e);
      alert('Could not build PDF — try again.');
    }
  };

  window.renderFormVerifyInbox = async function renderFormVerifyInbox() {
    var body =
      document.getElementById('facFormVerifyBody') ||
      document.getElementById('adFormVerifyBody') ||
      document.querySelector('#facFormVerifyBody, #adFormVerifyBody');
    // Also inject into ACM modules if panel missing
    if (!body) {
      var acm = document.getElementById('facACM') || document.getElementById('adACM');
      if (acm && !document.getElementById('acmFormVerifyHost')) {
        var host = document.createElement('div');
        host.id = 'acmFormVerifyHost';
        host.style.marginTop = '16px';
        host.innerHTML =
          '<div class="card" style="padding:16px;"><h3 style="margin:0 0 10px;color:var(--navy);">✅ Form verifications</h3><div id="acmFormVerifyBody">Loading…</div></div>';
        acm.insertBefore(host, acm.firstChild);
        body = document.getElementById('acmFormVerifyBody');
      }
    }
    if (!body) {
      // create minimal panel if verify section open
      ;['facFormVerify', 'adFormVerify'].forEach(function (id) {
        var p = document.getElementById(id);
        if (p && !document.getElementById(id + 'Body')) {
          p.innerHTML =
            '<div class="info-box">✅ Form verifications</div><div id="' + id + 'Body"></div>';
        }
      });
      body =
        document.getElementById('facFormVerifyBody') || document.getElementById('adFormVerifyBody');
    }
    if (!body) return;
    body.innerHTML = '<div style="padding:12px;opacity:.7;">Loading pending…</div>';
    try {
      var res = await fetch('/api/forms?pending_verify=1&_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        body.innerHTML = '<div class="warn-box">' + fEsc((data && data.error) || 'Failed') + '</div>';
        return;
      }
      var list = data.responses || [];
      window.refreshFormVerifyBadge();
      if (!list.length) {
        body.innerHTML = '<div class="info-box">No pending form submissions for your desk.</div>';
        return;
      }
      body.innerHTML = list
        .map(function (r) {
          var answers = r.answers || {};
          if (typeof answers === 'string') {
            try { answers = JSON.parse(answers); } catch (e) { answers = {}; }
          }
          var ansHtml = Object.keys(answers)
            .slice(0, 8)
            .map(function (k) {
              return (
                '<div style="font-size:0.78rem;margin:2px 0;"><strong>' +
                fEsc(k) +
                ':</strong> ' +
                fEsc(answers[k]) +
                '</div>'
              );
            })
            .join('');
          return (
            '<div class="card" style="padding:14px;margin-bottom:10px;border-left:4px solid #f59e0b;" data-vr-id="' +
            r.id +
            '" data-vr-form="' +
            r.form_id +
            '">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
            '<div><strong>📋 ' +
            fEsc(r.form_title || 'Form') +
            '</strong>' +
            '<div style="font-size:0.78rem;opacity:.8;margin-top:4px;">' +
            fEsc(r.submitter_name || '') +
            (r.submitter_reg ? ' · ' + fEsc(r.submitter_reg) : '') +
            ' · ' +
            fEsc(fFmtDate(r.submitted_at)) +
            '</div>' +
            '<div style="margin-top:8px;">' +
            ansHtml +
            '</div></div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' +
            '<button type="button" class="btn gr" data-vr-approve="1">✓ Approve</button>' +
            '<button type="button" class="btn re" data-vr-reject="1">✕ Reject</button>' +
            '</div></div></div>'
          );
        })
        .join('');

      body.querySelectorAll('[data-vr-id]').forEach(function (card) {
        var rid = card.getAttribute('data-vr-id');
        var fid = card.getAttribute('data-vr-form');
        var ap = card.querySelector('[data-vr-approve]');
        var rj = card.querySelector('[data-vr-reject]');
        if (ap) {
          ap.onclick = async function () {
            await window.verifyFormResponse(fid, rid, 'verify');
          };
        }
        if (rj) {
          rj.onclick = async function () {
            var note = prompt('Rejection reason (optional):') || '';
            await window.verifyFormResponse(fid, rid, 'reject', note);
          };
        }
      });
    } catch (e) {
      body.innerHTML = '<div class="warn-box">Failed to load inbox.</div>';
    }
  };

  window.verifyFormResponse = async function verifyFormResponse(formId, responseId, action, note) {
    try {
      var res = await fetch('/api/forms/' + formId + '/responses', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response_id: Number(responseId), action: action, note: note || '' }),
      });
      var data = await res.json().catch(function () { return null; });
      if (!res.ok) {
        alert((data && data.error) || 'Action failed');
        return;
      }
      alert(action === 'reject' ? 'Rejected.' : 'Verified and saved.');
      window.renderFormVerifyInbox();
      window.refreshFormVerifyBadge();
    } catch (e) {
      alert('Network error');
    }
  };

  // Hook create form modal open to ensure meta
  var _origOpenCreate = window.openCreateFormModal;
  if (typeof _origOpenCreate === 'function') {
    window.openCreateFormModal = function (prefill) {
      // If prefill is numeric id from live edit, handled separately
      if (prefill && typeof prefill === 'object') {
        window.openLiveFormEditor(prefill);
        return;
      }
      _origOpenCreate(null);
      window.ensureFormBuilderMeta();
      var idEl = document.getElementById('fbFormId');
      if (idEl) idEl.value = '';
    };
  }

  /**
   * Bulletproof activation: do NOT rely only on showSec hook (can be overwritten
   * or fail if __initGptBridge errors). Click + visibility + periodic check.
   */
  function activateLiveFormsIfVisible() {
    try {
      var ad = document.getElementById('adForms');
      var fac = document.getElementById('facForms');
      var visible =
        (ad && ad.offsetParent !== null && ad.style.display !== 'none') ||
        (fac && fac.offsetParent !== null && fac.style.display !== 'none');
      // Also check computed style when display:block but parent hidden
      if (ad) {
        var cs = window.getComputedStyle(ad);
        if (cs.display !== 'none' && cs.visibility !== 'hidden') visible = true;
      }
      if (!visible) return;
      // Detect old static empty shell still present (no live UI stamp)
      var stamped = document.getElementById('gpthLiveFormsStamp');
      if (!stamped && typeof window.renderLiveFormManager === 'function') {
        window.renderLiveFormManager();
      }
    } catch (e) {
      console.warn('[forms] activate', e);
    }
  }

  // Capture clicks on Form Builder sidebar items
  document.addEventListener(
    'click',
    function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var sl = t.closest('.sl, button, a');
      if (!sl) return;
      var oc = (sl.getAttribute('onclick') || '') + ' ' + (sl.textContent || '');
      if (
        /adForms|facForms|Form Builder|Form Manager/i.test(oc) ||
        (sl.textContent || '').trim() === 'Form Builder'
      ) {
        setTimeout(function () {
          if (typeof window.renderLiveFormManager === 'function') {
            window.renderLiveFormManager();
          }
        }, 80);
        setTimeout(activateLiveFormsIfVisible, 250);
      }
    },
    true,
  );

  // Re-wrap showSec after a delay (survives other wrappers)
  function rehookShowSecForForms() {
    try {
      var prev = window.showSec;
      if (typeof prev !== 'function') return;
      if (prev.__gpthFormsHooked) return;
      var wrapped = function (secId, linkEl) {
        var r = prev.apply(this, arguments);
        if (secId === 'adForms' || secId === 'facForms') {
          setTimeout(function () {
            if (typeof window.renderLiveFormManager === 'function') window.renderLiveFormManager();
          }, 50);
        }
        if (secId === 'stuForms' && typeof window.renderStudentFormsPanel === 'function') {
          setTimeout(function () {
            window.renderStudentFormsPanel();
          }, 50);
        }
        return r;
      };
      wrapped.__gpthFormsHooked = true;
      window.showSec = wrapped;
    } catch (e) {
      console.warn('[forms] rehook showSec', e);
    }
  }
  rehookShowSecForForms();
  setTimeout(rehookShowSecForForms, 800);
  // Only poll when Form Manager might be open — was every 2s and froze the UI
  setInterval(function () {
    if (document.hidden) return;
    if (!window.currentUser) return;
    var forms =
      document.getElementById('adForms') ||
      document.getElementById('facForms') ||
      document.getElementById('stuForms');
    if (!forms) return;
    if (forms.style.display === 'none' || forms.offsetParent === null) return;
    activateLiveFormsIfVisible();
  }, 20000);

  console.log('[bridge] live forms handlers installed (v=forms-perf)');
})();

/* ============================================================
   Mobile sidebar (hamburger) — keep full navigation on phones
   ============================================================ */
(function () {
  'use strict';

  function closeMobileNav() {
    document.querySelectorAll('.sb.sb-open').forEach(function (sb) {
      sb.classList.remove('sb-open');
    });
    document.querySelectorAll('.sb-backdrop.show').forEach(function (b) {
      b.classList.remove('show');
    });
    document.body.style.overflow = '';
  }

  function openMobileNav(sb) {
    if (!sb) return;
    sb.classList.add('sb-open');
    var bd = document.getElementById('sbBackdrop');
    if (bd) bd.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function ensureBackdrop() {
    var bd = document.getElementById('sbBackdrop');
    if (bd) return bd;
    bd = document.createElement('button');
    bd.type = 'button';
    bd.id = 'sbBackdrop';
    bd.className = 'sb-backdrop';
    bd.setAttribute('aria-label', 'Close menu');
    bd.addEventListener('click', closeMobileNav);
    document.body.appendChild(bd);
    return bd;
  }

  function ensureMenuButtons() {
    ensureBackdrop();
    document.querySelectorAll('.db-topbar').forEach(function (bar) {
      if (bar.querySelector('.db-menu-btn')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'db-menu-btn';
      btn.setAttribute('aria-label', 'Open menu');
      btn.innerHTML = '☰';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var wrap = bar.closest('.db') || bar.closest('.db-wrap') || document;
        var sb = wrap.querySelector('.sb') || document.querySelector('.db.show .sb') || document.querySelector('.sb');
        if (!sb) return;
        if (sb.classList.contains('sb-open')) closeMobileNav();
        else openMobileNav(sb);
      });
      // Insert at start of topbar
      if (bar.firstChild) bar.insertBefore(btn, bar.firstChild);
      else bar.appendChild(btn);
    });

    // Close drawer when a sidebar link is tapped
    document.querySelectorAll('.sb .sl, .sb .sb-menu a, .sb [data-fac]').forEach(function (el) {
      if (el.__mobNavBound) return;
      el.__mobNavBound = true;
      el.addEventListener('click', function () {
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
          setTimeout(closeMobileNav, 120);
        }
      });
    });
  }

  function bootMobNav() {
    try {
      ensureMenuButtons();
    } catch (e) {
      console.warn('[mobile-nav]', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(bootMobNav, 200);
    });
  } else {
    setTimeout(bootMobNav, 200);
  }
  setInterval(bootMobNav, 2500);
  window.addEventListener('resize', function () {
    if (window.matchMedia && window.matchMedia('(min-width: 769px)').matches) closeMobileNav();
  });
  window.__gpthCloseMobileNav = closeMobileNav;
  console.log('[bridge] mobile nav installed');
})();

