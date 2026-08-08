/**
 * Student Management hub — roster, year move, categories, branch transfer,
 * academic year (Admin/Principal), live reports. Roles: Exam, ACM, HOD, Principal, Admin.
 * ACM has the same write rights as HOD. Every change records who did it.
 */
(function () {
  'use strict';

  function esc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  async function api(path, opts) {
    opts = opts || {};
    var r = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign(
        { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        opts.body ? { 'Content-Type': 'application/json' } : {},
        opts.headers || {},
      ),
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + r.status));
    return data;
  }

  function roleOk() {
    var u = window.currentUser || {};
    return ['admin', 'principal', 'exam', 'acm', 'hod'].indexOf(u.role) >= 0;
  }

  function canTransferWrite() {
    var u = window.currentUser || {};
    // ACM = same write rights as HOD (academic documentation desk)
    return ['admin', 'principal', 'exam', 'hod', 'acm'].indexOf(u.role) >= 0;
  }

  function canEditAcademicYear() {
    var u = window.currentUser || {};
    return u.role === 'admin' || u.role === 'principal';
  }

  function actorSuffix(data) {
    if (!data) return '';
    var by = data.by || data.by_name || (data.actor && data.actor.name) || '';
    var role = data.by_role || data.role || '';
    if (!by) return '';
    return ' · by <strong>' + esc(by) + '</strong>' + (role ? ' (' + esc(role) + ')' : '');
  }

  function movedTipHtml(fromLabel) {
    return (
      '<div class="info-box" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:12px;">' +
      '💡 This screen is also under the main <strong>Student Management</strong> hub' +
      (fromLabel ? ' → <strong>' + esc(fromLabel) + '</strong>' : '') +
      '. Old menus stay available for a while.</div>'
    );
  }

  /* ---------- Nav inject into shells ---------- */
  function injectNav(shellSel, navId, panelId, showSecId, label, icon, afterMatch) {
    var menu = document.querySelector(shellSel + ' .sb-menu');
    var content = document.querySelector(shellSel + ' .db-content');
    if (!menu || !content) return;
    if (!document.getElementById(navId)) {
      var insertAfter = null;
      menu.querySelectorAll('.sl').forEach(function (sl) {
        var oc = sl.getAttribute('onclick') || '';
        var id = sl.id || '';
        if (afterMatch(oc, id, sl)) insertAfter = sl;
      });
      var nav = document.createElement('div');
      nav.className = 'sl';
      nav.id = navId;
      nav.setAttribute('onclick', "showSec('" + showSecId + "',this)");
      nav.innerHTML = '<span class="sli">' + icon + '</span>' + label;
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
      panel.innerHTML = '<div class="info-box">Loading…</div>';
      content.appendChild(panel);
    }
  }

  function ensureOpsMenus() {
    if (!roleOk()) return;
    var u = window.currentUser || {};
    var after = function (oc) {
      return oc.indexOf('Home') !== -1 || oc.indexOf('Exam') !== -1 || oc.indexOf('ACM') !== -1;
    };

    // Admin shell: Root Admin + Principal (if ever on admin) + Exam Cell (image 107 menu)
    // + ACM gets Student Management via block below
    if (
      u.role === 'admin' ||
      u.role === 'principal' ||
      u.role === 'exam' ||
      window._examScopedAdmin
    ) {
      injectNav('#dbAdmin', 'adOpsLiveNav', 'adOpsLive', 'adOpsLive', 'Live Academic', '📡', after);
      injectNav('#dbAdmin', 'adOpsCatNav', 'adOpsCategory', 'adOpsCategory', 'Student Management', '🏷️', after);
      injectNav('#dbAdmin', 'adOpsXferNav', 'adOpsTransfer', 'adOpsTransfer', 'Branch Transfer', '🔀', after);
    }

    // ACM: Student Management hub on admin shell (Live/Transfer live inside SM tabs)
    if (u.role === 'acm' || window._acmScopedAdmin) {
      injectNav('#dbAdmin', 'adOpsCatNav', 'adOpsCategory', 'adOpsCategory', 'Student Management', '🏷️', after);
      ;['adOpsLiveNav', 'adOpsXferNav'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }

    // Principal shell
    if (u.role === 'principal' || u.role === 'admin') {
      injectNav('#dbPrincipal', 'priOpsLiveNav', 'priOpsLive', 'priOpsLive', 'Live Academic', '📡', after);
      injectNav('#dbPrincipal', 'priOpsCatNav', 'priOpsCategory', 'priOpsCategory', 'Student Management', '🏷️', after);
      injectNav('#dbPrincipal', 'priOpsXferNav', 'priOpsTransfer', 'priOpsTransfer', 'Branch Transfer', '🔀', after);
    }
    // Faculty shell (HOD)
    if (u.role === 'hod' || u.role === 'faculty' || u.role === 'admin' || u.role === 'principal') {
      injectNav('#dbFaculty', 'facOpsLiveNav', 'facOpsLive', 'facOpsLive', 'Live Academic', '📡', after);
      injectNav('#dbFaculty', 'facOpsCatNav', 'facOpsCategory', 'facOpsCategory', 'Student Management', '🏷️', after);
      injectNav('#dbFaculty', 'facOpsXferNav', 'facOpsTransfer', 'facOpsTransfer', 'Branch Transfer', '🔀', after);
    }
    // Rename if an older "Student Category" nav is already in the DOM
    ;['adOpsCatNav', 'priOpsCatNav', 'facOpsCatNav'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '<span class="sli">🏷️</span>Student Management';
    });

    // Re-assert scoped shells after inject (keep allow-list stable; Exam keeps SM/Branch/Live)
    try {
      if (window._examScopedAdmin && typeof window.paintExamAdminMenu === 'function') {
        window.paintExamAdminMenu(window.currentUser);
      }
      if (window._acmScopedAdmin && typeof window.paintAcmAdminMenu === 'function') {
        window.paintAcmAdminMenu(window.currentUser);
      }
    } catch (eRescope) { /* ignore */ }
  }

  function panelHtmlLive(pid) {
    return (
      '<div class="info-box">📡 <strong>Live Academic Dashboard</strong> — Default: <strong>regular 3-year</strong> students only. ' +
      'Filter by year (I / II / III) and admission batch. Exam fees (Exam-validated <em>Paid</em>), profile completeness, ' +
      'and verified results for the <strong>running semester</strong>. HOD = own branch.</div>' +
      '<div id="' + pid + '_meta" style="font-size:0.8rem;opacity:.85;margin:0 0 10px;"></div>' +
      '<div class="card" style="padding:12px;margin-bottom:12px;">' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Entry</label><br>' +
      '<select id="' + pid + '_entry" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);">' +
      '<option value="regular" selected>Regular (3 year)</option>' +
      '<option value="lateral">Lateral / ITI / PUC</option>' +
      '<option value="all">All entry types</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Year (Roman)</label><br>' +
      '<select id="' + pid + '_year" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);">' +
      '<option value="">All years (I–III)</option>' +
      '<option value="I">I</option><option value="II">II</option><option value="III">III</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Admission year (batch)</label><br>' +
      '<select id="' + pid + '_batch" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);min-width:120px;">' +
      '<option value="">All batches</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">List</label><br>' +
      '<select id="' + pid + '_tab" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);">' +
      '<option value="all">All students</option>' +
      '<option value="fees_paid">Fees Paid</option>' +
      '<option value="fees_unpaid">Fees Not Paid</option>' +
      '<option value="profile_complete">Profile Complete</option>' +
      '<option value="profile_incomplete">Profile Incomplete</option>' +
      '<option value="results_filled">Results Filled (running sem)</option>' +
      '<option value="results_missing">Results Not Filled</option>' +
      '</select></div>' +
      '<button type="button" class="btn pr" onclick="window.opsLiveLoad&&window.opsLiveLoad(\'' + pid + '\')">↻ Apply / Refresh</button> ' +
      '<button type="button" class="btn go" onclick="window.opsExport&&window.opsExport(\'' + pid + '\')">⬇ Export Excel</button>' +
      '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;" id="' + pid + '_cards"></div>' +
      '<div class="card" style="margin-bottom:12px;">' +
      '<div class="card-hd"><h3>Lists</h3></div>' +
      '<div id="' + pid + '_table" style="padding:12px;overflow:auto;"></div></div>'
    );
  }

  function panelHtmlYearAndCategory(pid) {
    return (
      // ---- Single student year + category ----
      '<div class="card" style="padding:16px;max-width:920px;margin-bottom:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:1rem;">Single student — year &amp; category</h3>' +
      '<div class="form-row"><div class="fg"><label>Register number</label>' +
      '<input type="text" id="' + pid + '_reg" placeholder="171CS25001" style="text-transform:uppercase;" ' +
      'onkeydown="if(event.key===\'Enter\'){window.opsCatFetch&&window.opsCatFetch(\'' + pid + '\');}" /></div>' +
      '<div class="fg" style="align-self:end;"><button type="button" class="btn pr" onclick="window.opsCatFetch&&window.opsCatFetch(\'' + pid + '\')">Auto-fetch</button></div></div>' +
      '<div id="' + pid + '_info" style="margin:12px 0;font-size:0.88rem;"></div>' +
      '<div id="' + pid + '_audit" style="margin:0 0 12px;font-size:0.78rem;color:#334155;"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:10px 0 14px;padding:12px;border:1px solid var(--border);border-radius:10px;background:#f8fafc;">' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Study year (live)</label><br>' +
      '<select id="' + pid + '_year" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);min-width:100px;">' +
      '<option value="1">I (1st Year)</option>' +
      '<option value="2">II (2nd Year)</option>' +
      '<option value="3">III (3rd Year)</option></select></div>' +
      '<button type="button" class="btn pr" onclick="window.opsYearSingle&&window.opsYearSingle(\'' + pid + '\')">⬆ Update year</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;" id="' + pid + '_flags">' +
      ['iti:ITI', 'puc:PUC', 'repeater:Repeater', 'not_eligible:Not eligible', 'year_back:Year back', 'change_of_branch:Change of branch']
        .map(function (pair) {
          var k = pair.split(':')[0];
          var lab = pair.split(':')[1];
          return (
            '<label style="display:flex;gap:8px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:10px;cursor:pointer;">' +
            '<input type="checkbox" data-flag="' + k + '" id="' + pid + '_' + k + '" /> <strong>' + lab + '</strong></label>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="fg" style="margin-top:12px;"><label>Notes / reason <span style="opacity:.7;">(saved with your name)</span></label>' +
      '<input type="text" id="' + pid + '_notes" placeholder="Optional note — who/why is always recorded" /></div>' +
      '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn go" onclick="window.opsCatSave&&window.opsCatSave(\'' + pid + '\')">💾 Save category</button>' +
      '</div>' +
      '<div id="' + pid + '_msg" style="margin-top:10px;font-size:0.85rem;"></div></div>' +
      // ---- Bulk year transfer ----
      '<div class="card" style="padding:16px;">' +
      '<div class="card-hd" style="padding:0 0 12px;border:none;">' +
      '<h3 style="margin:0;">Bulk year transfer</h3></div>' +
      '<p style="font-size:0.8rem;opacity:.85;margin:0 0 10px;">Your name and role are recorded on every year move / remove.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px;">' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Filter current year</label><br>' +
      '<select id="' + pid + '_bulk_from" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="">All years</option>' +
      '<option value="1">I</option><option value="2">II</option><option value="3">III</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Search</label><br>' +
      '<input type="text" id="' + pid + '_bulk_q" placeholder="Reg / name" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);min-width:160px;" /></div>' +
      '<button type="button" class="btn ol" onclick="window.opsYearRoster&&window.opsYearRoster(\'' + pid + '\')">↻ Load roster</button>' +
      '<div style="flex:1;"></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Move selected to</label><br>' +
      '<select id="' + pid + '_bulk_to" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="1">I (1st Year)</option>' +
      '<option value="2">II (2nd Year)</option>' +
      '<option value="3" selected>III (3rd Year)</option></select></div>' +
      '<button type="button" class="btn go" onclick="window.opsYearBulk&&window.opsYearBulk(\'' + pid + '\')">⬆ Apply bulk year change</button>' +
      '<button type="button" class="btn re" onclick="window.opsYearRemove&&window.opsYearRemove(\'' + pid + '\')">🗑 Remove from list</button>' +
      '</div>' +
      '<div id="' + pid + '_bulk_meta" style="font-size:0.8rem;opacity:.85;margin-bottom:8px;"></div>' +
      '<div style="overflow:auto;max-height:420px;border:1px solid var(--border);border-radius:10px;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
      '<thead style="position:sticky;top:0;background:#f1f5f9;"><tr>' +
      '<th style="padding:8px;text-align:left;"><input type="checkbox" id="' + pid + '_bulk_all" ' +
      'onchange="window.opsYearToggleAll&&window.opsYearToggleAll(\'' + pid + '\',this.checked)" /></th>' +
      '<th style="padding:8px;text-align:left;">Reg</th><th style="padding:8px;text-align:left;">Name</th>' +
      '<th style="padding:8px;">Year</th><th style="padding:8px;">Batch</th></tr></thead>' +
      '<tbody id="' + pid + '_bulk_body"><tr><td colspan="5" style="padding:16px;opacity:.7;">Click Load roster.</td></tr></tbody>' +
      '</table></div>' +
      '<div id="' + pid + '_bulk_msg" style="margin-top:10px;font-size:0.85rem;"></div></div>'
    );
  }

  function panelHtmlTransfer(pid) {
    var write = canTransferWrite();
    return (
      '<div class="info-box">🔀 <strong>Branch Transfer</strong> — After Year 1, keep old + new register numbers (dual login). ' +
      'Outgoing HOD/ACM <em>releases</em>; Incoming HOD/ACM <em>accepts</em>; then data moves to the new branch. ' +
      'Every step records <strong>who</strong> created / released / accepted / cancelled.</div>' +
      (write
        ? '<div class="card" style="padding:16px;margin-bottom:14px;">' +
          '<h3 style="margin:0 0 10px;">Create transfer</h3>' +
          '<div class="form-row">' +
          '<div class="fg"><label>Current (old) reg no</label><input id="' + pid + '_old" style="text-transform:uppercase;" /></div>' +
          '<div class="fg"><label>New reg no (typed)</label><input id="' + pid + '_new" style="text-transform:uppercase;" /></div>' +
          '<div class="fg"><label>To branch</label><select id="' + pid + '_to">' +
          '<option value="Civil Engineering">Civil Engineering</option>' +
          '<option value="Computer Science and Engineering">Computer Science and Engineering</option>' +
          '<option value="Electronics and Communication Engineering">Electronics and Communication Engineering</option>' +
          '<option value="Mechanical Engineering">Mechanical Engineering</option></select></div></div>' +
          '<div class="fg"><label>Notes</label><input id="' + pid + '_notes" placeholder="Reason — your name is stored automatically" /></div>' +
          '<button type="button" class="btn pr" style="margin-top:10px;" onclick="window.opsXferCreate&&window.opsXferCreate(\'' +
          pid +
          '\')">Create draft</button></div>'
        : '') +
      '<div class="card"><div class="card-hd"><h3>Transfer history</h3>' +
      '<button type="button" class="btn ol" onclick="window.opsXferLoad&&window.opsXferLoad(\'' +
      pid +
      '\')">↻ Refresh</button></div>' +
      '<div id="' + pid + '_list" style="padding:12px;overflow:auto;"></div></div>'
    );
  }

  function panelHtmlRoster(pid) {
    var rpid = pid + 'R';
    var official = (window.OFFICIAL_BRANCHES && window.OFFICIAL_BRANCHES.length)
      ? window.OFFICIAL_BRANCHES
      : [
          'Civil Engineering',
          'Computer Science and Engineering',
          'Electronics and Communication Engineering',
          'Mechanical Engineering',
        ];
    var branchOpts = official
      .map(function (b) {
        return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
      })
      .join('');
    return (
      '<div class="info-box">📋 <strong>Roster</strong> — Search and filter all students (HOD = own branch). ' +
      'Click <strong>Manage</strong> to open year/category tools for that register number.</div>' +
      '<div class="card" style="padding:12px;margin-bottom:12px;">' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">' +
      '<div style="flex:1;min-width:180px;"><label style="font-size:0.72rem;font-weight:700;">Search</label><br>' +
      '<input type="text" id="' + rpid + '_q" placeholder="Name, reg, father…" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);" ' +
      'oninput="window.opsRosterFilter&&window.opsRosterFilter(\'' + pid + '\')" /></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Branch</label><br>' +
      '<select id="' + rpid + '_branch" style="padding:8px;border-radius:8px;border:1px solid var(--border);min-width:160px;" ' +
      'onchange="window.opsRosterFilter&&window.opsRosterFilter(\'' + pid + '\')">' +
      '<option value="">All branches</option>' + branchOpts + '</select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Year</label><br>' +
      '<select id="' + rpid + '_year" style="padding:8px;border-radius:8px;border:1px solid var(--border);" ' +
      'onchange="window.opsRosterFilter&&window.opsRosterFilter(\'' + pid + '\')">' +
      '<option value="">All</option><option value="1">I</option><option value="2">II</option><option value="3">III</option>' +
      '<option value="alumni">Alumni</option></select></div>' +
      '<button type="button" class="btn ol" onclick="window.opsRosterLoad&&window.opsRosterLoad(\'' + pid + '\')">↻ Refresh</button>' +
      '</div></div>' +
      '<div id="' + rpid + '_meta" style="font-size:0.8rem;opacity:.85;margin-bottom:8px;"></div>' +
      '<div class="card" style="overflow:auto;max-height:calc(100vh - 320px);">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">' +
      '<thead style="position:sticky;top:0;background:#f1f5f9;"><tr>' +
      '<th style="padding:8px;text-align:left;">Reg</th><th style="padding:8px;text-align:left;">Name</th>' +
      '<th style="padding:8px;text-align:left;">Father</th><th style="padding:8px;text-align:left;">Branch / Year</th>' +
      '<th style="padding:8px;"></th></tr></thead>' +
      '<tbody id="' + rpid + '_body"><tr><td colspan="5" style="padding:16px;opacity:.7;">Loading…</td></tr></tbody>' +
      '</table></div>'
    );
  }

  function panelHtmlAcademicYear(pid) {
    var ayid = pid + 'AY';
    var edit = canEditAcademicYear();
    return (
      '<div class="info-box">📅 <strong>Active Academic Year</strong> — DTE Karnataka session (e.g. 2026-27). ' +
      (edit
        ? 'Save year and optionally apply progression (1→2→3, auto pass-out). Detained / Year Back stay frozen. Your name is stored with the change.'
        : 'View only for your role. Admin / Principal can change the active year.') +
      '</div>' +
      '<div class="card" style="padding:18px;max-width:640px;">' +
      '<div class="form-row">' +
      '<div class="fg"><label>Active Academic Year</label>' +
      '<input type="text" id="' + ayid + '_ay" placeholder="2026-27" style="max-width:200px;" ' +
      (edit ? '' : 'readonly ') +
      '/></div>' +
      '<div class="fg"><label>Start month (1–12)</label>' +
      '<input type="number" id="' + ayid + '_month" min="1" max="12" value="6" style="max-width:100px;" ' +
      (edit ? '' : 'readonly ') +
      '/></div></div>' +
      (edit
        ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
          '<button class="btn pr" type="button" onclick="window.saveActiveAcademicYear&&window.saveActiveAcademicYear(\'' +
          ayid +
          '\',false)">💾 Save year only</button>' +
          '<button class="btn go" type="button" onclick="window.saveActiveAcademicYear&&window.saveActiveAcademicYear(\'' +
          ayid +
          '\',true)">▶ Save + Apply progression</button>' +
          '<button class="btn ol" type="button" onclick="window.applyAcademicProgressionOnly&&window.applyAcademicProgressionOnly()">↻ Recompute all</button>' +
          '</div>'
        : '') +
      '<div id="' + ayid + '_status" style="margin-top:14px;font-size:0.85rem;color:var(--text-muted);"></div>' +
      '<div id="' + ayid + '_report" style="margin-top:12px;"></div></div>'
    );
  }

  function panelHtmlHub(pid) {
    var role = (window.currentUser || {}).role || '';
    var showAy = true; // all see AY tab; edit gated inside
    var tabs = [
      { id: 'roster', label: '📋 Roster' },
      { id: 'year', label: '⬆ Year & Category' },
      { id: 'transfer', label: '🔀 Branch transfer' },
      { id: 'reports', label: '📡 Reports' },
    ];
    if (showAy) tabs.push({ id: 'ay', label: '📅 Academic year' });
    var tabBar =
      '<div id="' +
      pid +
      '_tabs" style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border);">' +
      tabs
        .map(function (t, i) {
          return (
            '<button type="button" class="btn ' +
            (i === 0 ? 'pr' : 'ol') +
            '" data-sm-tab="' +
            t.id +
            '" id="' +
            pid +
            '_tab_' +
            t.id +
            '" style="padding:7px 12px;font-size:0.78rem;font-weight:700;" ' +
            'onclick="window.opsHubTab&&window.opsHubTab(\'' +
            pid +
            '\',\'' +
            t.id +
            '\')">' +
            t.label +
            '</button>'
          );
        })
        .join('') +
      '</div>';

    // Sub-pids so transfer/live field ids don't clash with year/category
    var xferPid = pid + 'T';
    var livePid = pid + 'L';

    return (
      '<div class="info-box">🏷️ <strong>Student Management</strong> — Main desk for roster, year moves, categories, branch transfers, academic year, and live reports. ' +
      'HOD = own branch (reg codes). <strong>ACM has full write rights</strong> like HOD for academic documentation. ' +
      'Every change records <strong>who</strong> did it. Account Approvals stay on their own menu.</div>' +
      (role
        ? '<div style="font-size:0.78rem;margin:0 0 10px;opacity:.85;">Signed in as <strong>' +
          esc((window.currentUser || {}).display_name || role) +
          '</strong> (' +
          esc(role) +
          ')</div>'
        : '') +
      tabBar +
      '<div data-sm-pane="roster" id="' + pid + '_pane_roster">' +
      panelHtmlRoster(pid) +
      '</div>' +
      '<div data-sm-pane="year" id="' + pid + '_pane_year" style="display:none;">' +
      panelHtmlYearAndCategory(pid) +
      '</div>' +
      '<div data-sm-pane="transfer" id="' + pid + '_pane_transfer" style="display:none;">' +
      panelHtmlTransfer(xferPid) +
      '</div>' +
      '<div data-sm-pane="reports" id="' + pid + '_pane_reports" style="display:none;">' +
      panelHtmlLive(livePid) +
      '</div>' +
      '<div data-sm-pane="ay" id="' + pid + '_pane_ay" style="display:none;">' +
      panelHtmlAcademicYear(pid) +
      '</div>'
    );
  }

  window.opsHubTab = function (pid, tab) {
    var el = document.getElementById(pid);
    if (!el) return;
    el.querySelectorAll('[data-sm-pane]').forEach(function (pane) {
      pane.style.display = pane.getAttribute('data-sm-pane') === tab ? '' : 'none';
    });
    el.querySelectorAll('[data-sm-tab]').forEach(function (btn) {
      var on = btn.getAttribute('data-sm-tab') === tab;
      btn.className = 'btn ' + (on ? 'pr' : 'ol');
      btn.style.padding = '7px 12px';
      btn.style.fontSize = '0.78rem';
      btn.style.fontWeight = '700';
    });
    el.setAttribute('data-sm-active-tab', tab);
    // Lazy load tab content
    if (tab === 'roster') window.opsRosterLoad && window.opsRosterLoad(pid);
    if (tab === 'year') {
      setTimeout(function () {
        window.opsYearRoster && window.opsYearRoster(pid);
      }, 40);
    }
    if (tab === 'transfer') window.opsXferLoad && window.opsXferLoad(pid + 'T');
    if (tab === 'reports') window.opsLiveLoad && window.opsLiveLoad(pid + 'L');
    if (tab === 'ay') window.opsHubLoadAy && window.opsHubLoadAy(pid);
  };

  window.opsHubOpen = function (tab) {
    // Open the Student Management section for the current shell and select a tab
    var shellMap = [
      { dash: 'dbAdmin', sec: 'adOpsCategory', nav: 'adOpsCatNav' },
      { dash: 'dbPrincipal', sec: 'priOpsCategory', nav: 'priOpsCatNav' },
      { dash: 'dbFaculty', sec: 'facOpsCategory', nav: 'facOpsCatNav' },
    ];
    var pick = null;
    shellMap.forEach(function (s) {
      var d = document.getElementById(s.dash);
      if (d && d.classList && d.classList.contains('show')) pick = s;
    });
    if (!pick) pick = shellMap[0];
    var nav = document.getElementById(pick.nav);
    if (typeof window.showSec === 'function') {
      window.showSec(pick.sec, nav || null);
    }
    setTimeout(function () {
      window.opsHubTab && window.opsHubTab(pick.sec, tab || 'roster');
    }, 120);
  };

  window.opsHubLoadAy = async function (pid) {
    var ayid = pid + 'AY';
    try {
      if (typeof window.loadAcademicYearPanel === 'function') {
        // Also refresh standalone panels if present
        try {
          await window.loadAcademicYearPanel();
        } catch (e1) { /* ignore */ }
      }
      var res = await fetch('/api/institute-settings?_ts=' + Date.now(), { credentials: 'same-origin' });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.academic) return;
      var ay = document.getElementById(ayid + '_ay');
      var mo = document.getElementById(ayid + '_month');
      var st = document.getElementById(ayid + '_status');
      if (ay) ay.value = data.academic.active_academic_year || '';
      if (mo) mo.value = data.academic.academic_year_start_month || 6;
      if (st) {
        st.innerHTML =
          'Current active year: <strong>' +
          esc(data.academic.active_academic_year || '—') +
          '</strong>' +
          (canEditAcademicYear() ? ' · You can edit' : ' · View only') +
          (data.academic.updated_by_name
            ? ' · Last set by <strong>' + esc(data.academic.updated_by_name) + '</strong>'
            : '');
      }
    } catch (e) {
      console.warn('[ops] academic year load', e);
    }
  };

  window.opsRosterLoad = async function (pid) {
    var rpid = pid + 'R';
    var body = document.getElementById(rpid + '_body');
    var meta = document.getElementById(rpid + '_meta');
    if (body) body.innerHTML = '<tr><td colspan="5" style="padding:16px;opacity:.7;">Loading…</td></tr>';
    try {
      var r = await fetch('/api/students?include_alumni=1&lite=1&_ts=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok) throw new Error((data && data.error) || 'Failed to load students');
      var list = data.students || data.rows || data || [];
      if (!Array.isArray(list)) list = [];
      window._opsRosterList = list.map(function (s, i) {
        return {
          key: s.reg_no || String(i),
          reg_no: s.reg_no,
          name: s.name,
          father: s.father,
          dept: s.dept || s.branch,
          year: s.year,
          current_study_year: s.current_study_year,
          academic_status: s.academic_status,
          admission_academic_year: s.admission_academic_year || s.admission_year,
          entry_type: s.entry_type,
        };
      });
      window.opsRosterFilter(pid);
    } catch (e) {
      if (body) {
        body.innerHTML =
          '<tr><td colspan="5" style="padding:16px;color:#991b1b;">' + esc(e.message) + '</td></tr>';
      }
      if (meta) meta.textContent = '';
    }
  };

  window.opsRosterFilter = function (pid) {
    var rpid = pid + 'R';
    var body = document.getElementById(rpid + '_body');
    var meta = document.getElementById(rpid + '_meta');
    var q = ((document.getElementById(rpid + '_q') || {}).value || '').trim().toLowerCase();
    var branch = ((document.getElementById(rpid + '_branch') || {}).value || '').trim().toLowerCase();
    var year = ((document.getElementById(rpid + '_year') || {}).value || '').trim();
    var list = window._opsRosterList || [];
    var filtered = list.filter(function (s) {
      var st = String(s.academic_status || 'active').toLowerCase();
      if (year === 'alumni') {
        if (st !== 'passed_out') return false;
      } else if (year === '1' || year === '2' || year === '3') {
        if (st === 'passed_out') return false;
        var n = s.current_study_year != null ? Number(s.current_study_year) : null;
        if (n != null && n !== Number(year)) return false;
        if (n == null) {
          var y = String(s.year || '').toLowerCase();
          var want = year === '1' ? '1' : year === '2' ? '2' : '3';
          if (y.indexOf(want) < 0 && y.indexOf(year === '1' ? 'i' : year === '2' ? 'ii' : 'iii') < 0) {
            // allow loose match
            if (!(year === '1' && /1st|first|^i\b/i.test(y)) &&
                !(year === '2' && /2nd|second|^ii\b/i.test(y)) &&
                !(year === '3' && /3rd|third|^iii\b/i.test(y))) return false;
          }
        }
      }
      if (branch) {
        var d = String(s.dept || '').toLowerCase();
        if (d.indexOf(branch) < 0 && branch.indexOf(d) < 0) {
          if (!(branch.indexOf('computer') >= 0 && d.indexOf('computer') >= 0) &&
              !(branch.indexOf('civil') >= 0 && d.indexOf('civil') >= 0) &&
              !(branch.indexOf('mech') >= 0 && d.indexOf('mech') >= 0) &&
              !((branch.indexOf('electron') >= 0 || branch.indexOf('ece') >= 0) &&
                (d.indexOf('electron') >= 0 || d.indexOf('ece') >= 0))) {
            return false;
          }
        }
      }
      if (q) {
        var hay = [s.reg_no, s.name, s.father, s.dept, s.year].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    if (meta) meta.textContent = 'Showing ' + filtered.length + ' of ' + list.length + ' student(s)';
    if (!body) return;
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="5" style="padding:16px;opacity:.7;">No students match.</td></tr>';
      return;
    }
    body.innerHTML = filtered
      .slice(0, 800)
      .map(function (s) {
        var yLab =
          s.current_study_year === 1
            ? 'I'
            : s.current_study_year === 2
              ? 'II'
              : s.current_study_year === 3
                ? 'III'
                : s.year || '—';
        var st = String(s.academic_status || '');
        return (
          '<tr style="border-top:1px solid var(--border);">' +
          '<td style="padding:8px;font-family:monospace;font-size:0.75rem;">' +
          esc(s.reg_no || '—') +
          '</td>' +
          '<td style="padding:8px;"><strong>' +
          esc(s.name || '') +
          '</strong></td>' +
          '<td style="padding:8px;">' +
          esc(s.father || '—') +
          '</td>' +
          '<td style="padding:8px;font-size:0.78rem;">' +
          esc(s.dept || '—') +
          '<div style="opacity:.75;font-size:0.7rem;">Year ' +
          esc(String(yLab)) +
          (st ? ' · ' + esc(st) : '') +
          (s.admission_academic_year ? ' · Batch ' + esc(s.admission_academic_year) : '') +
          '</div></td>' +
          '<td style="padding:8px;white-space:nowrap;">' +
          '<button type="button" class="btn pr" style="padding:4px 10px;font-size:0.72rem;" ' +
          'onclick="window.opsRosterManage&&window.opsRosterManage(\'' +
          pid +
          '\',\'' +
          esc(s.reg_no || '') +
          '\')">Manage</button></td></tr>'
        );
      })
      .join('');
  };

  window.opsRosterManage = function (pid, reg) {
    if (!reg) return;
    window.opsHubTab(pid, 'year');
    setTimeout(function () {
      var regEl = document.getElementById(pid + '_reg');
      if (regEl) regEl.value = reg;
      window.opsCatFetch && window.opsCatFetch(pid);
    }, 80);
  };

  window.opsEnsurePanel = function (secId) {
    ensureOpsMenus();
    var el = document.getElementById(secId);
    if (!el) return;
    if (secId.indexOf('OpsLive') >= 0) {
      if (el.getAttribute('data-ops') !== 'live-v2') {
        el.setAttribute('data-ops', 'live-v2');
        el.innerHTML = movedTipHtml('Reports') + panelHtmlLive(secId);
      }
      window.opsLiveLoad(secId);
    } else if (secId.indexOf('OpsCategory') >= 0) {
      // Main Student Management hub
      if (el.getAttribute('data-ops') !== 'hub-v1') {
        el.setAttribute('data-ops', 'hub-v1');
        el.innerHTML = panelHtmlHub(secId);
      }
      var wantTab = el.getAttribute('data-sm-active-tab') || 'roster';
      window.opsHubTab(secId, wantTab);
    } else if (secId.indexOf('OpsTransfer') >= 0) {
      if (el.getAttribute('data-ops') !== 'xfer-v2') {
        el.setAttribute('data-ops', 'xfer-v2');
        el.innerHTML = movedTipHtml('Branch transfer') + panelHtmlTransfer(secId);
      }
      window.opsXferLoad(secId);
    }
  };

  window.opsLiveLoad = async function (pid) {
    var host = document.getElementById(pid + '_table');
    var cards = document.getElementById(pid + '_cards');
    var meta = document.getElementById(pid + '_meta');
    var tab = (document.getElementById(pid + '_tab') || {}).value || 'all';
    var entry = (document.getElementById(pid + '_entry') || {}).value || 'regular';
    var year = (document.getElementById(pid + '_year') || {}).value || '';
    var batch = (document.getElementById(pid + '_batch') || {}).value || '';
    if (host) host.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    try {
      var qs =
        'tab=' + encodeURIComponent(tab) +
        '&entry=' + encodeURIComponent(entry) +
        (year ? '&year=' + encodeURIComponent(year) : '') +
        (batch ? '&admission_year=' + encodeURIComponent(batch) : '');
      var data = await api('/api/ops/live?' + qs);
      var s = data.summary || {};
      // Populate admission batch options
      var batchEl = document.getElementById(pid + '_batch');
      if (batchEl && data.meta && Array.isArray(data.meta.admission_years)) {
        var prevB = batchEl.value || batch;
        var opts = '<option value="">All batches</option>';
        data.meta.admission_years.forEach(function (y) {
          opts +=
            '<option value="' +
            esc(y) +
            '"' +
            (y === prevB ? ' selected' : '') +
            '>' +
            esc(y) +
            '</option>';
        });
        batchEl.innerHTML = opts;
        if (prevB) batchEl.value = prevB;
      }
      if (meta && data.meta) {
        meta.innerHTML =
          'AY <strong>' +
          esc(data.meta.active_academic_year || '') +
          '</strong> · ' +
          esc(data.meta.term_label || '') +
          ' · Filter: <strong>' +
          esc(entry) +
          '</strong>' +
          (year ? ' · Year <strong>' + esc(year) + '</strong>' : '') +
          (batch ? ' · Batch <strong>' + esc(batch) + '</strong>' : '') +
          ' · ' +
          esc(data.meta.note || '');
      }
      if (cards) {
        cards.innerHTML = [
          ['Total', s.total],
          ['Fees paid', s.fees_paid],
          ['Fees unpaid', s.fees_unpaid],
          ['Profile OK', s.profile_complete],
          ['Profile incomplete', s.profile_incomplete],
          ['Results filled', s.results_filled],
          ['Results missing', s.results_missing],
        ]
          .map(function (x) {
            return (
              '<div style="min-width:110px;padding:10px 12px;border-radius:12px;background:#f1f5f9;border:1px solid var(--border);">' +
              '<div style="font-size:0.7rem;opacity:.7;">' +
              esc(x[0]) +
              '</div><div style="font-size:1.25rem;font-weight:800;">' +
              esc(String(x[1] != null ? x[1] : '—')) +
              '</div></div>'
            );
          })
          .join('');
      }
      var rows = data.rows || [];
      if (!host) return;
      if (!rows.length) {
        host.innerHTML = '<p style="opacity:.7;">No rows.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
        '<th style="text-align:left;padding:6px;">Reg</th><th style="text-align:left;">Name</th><th>Branch</th>' +
        '<th>Fees</th><th>Profile</th><th>Results</th><th>Run sem</th><th>Type</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html +=
          '<tr style="border-top:1px solid var(--border);">' +
          '<td style="padding:6px;font-family:monospace;font-size:0.72rem;">' +
          esc(r.reg_no) +
          '</td><td style="padding:6px;">' +
          esc(r.name) +
          '</td><td style="padding:6px;font-size:0.72rem;">' +
          esc(r.branch) +
          '</td><td style="padding:6px;text-align:center;">' +
          (r.fees_paid ? '<span class="badge active">Paid</span>' : '<span class="badge pending">Unpaid</span>') +
          '</td><td style="padding:6px;text-align:center;">' +
          (r.profile_complete
            ? '<span class="badge active">OK</span>'
            : '<span class="badge pending" title="' + esc((r.profile_missing || []).join(', ')) + '">Incomplete</span>') +
          '</td><td style="padding:6px;text-align:center;">' +
          (r.results_filled ? '<span class="badge active">Filled</span>' : '<span class="badge pending">Missing</span>') +
          '</td><td style="padding:6px;text-align:center;">' +
          esc(r.running_sem != null ? String(r.running_sem) : '—') +
          '</td><td style="padding:6px;">' +
          esc(r.entry_type_label || '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
      host.innerHTML = html;
    } catch (e) {
      if (host) host.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.opsExport = function (pid) {
    var entry = (document.getElementById(pid + '_entry') || {}).value || 'regular';
    var year = (document.getElementById(pid + '_year') || {}).value || '';
    var batch = (document.getElementById(pid + '_batch') || {}).value || '';
    var qs =
      '_ts=' +
      Date.now() +
      '&entry=' +
      encodeURIComponent(entry) +
      (year ? '&year=' + encodeURIComponent(year) : '') +
      (batch ? '&admission_year=' + encodeURIComponent(batch) : '');
    window.open('/api/ops/export?' + qs, '_blank');
  };

  window.opsCatFetch = async function (pid) {
    var regEl = document.getElementById(pid + '_reg');
    var info = document.getElementById(pid + '_info');
    var audit = document.getElementById(pid + '_audit');
    var msg = document.getElementById(pid + '_msg');
    var reg = (regEl && regEl.value ? regEl.value : '').trim().toUpperCase();
    if (!reg) {
      alert('Enter register number');
      return;
    }
    if (msg) msg.textContent = 'Fetching…';
    try {
      var data = await api('/api/ops/category?reg_no=' + encodeURIComponent(reg));
      var s = data.student || {};
      var yNum = s.current_study_year != null ? Number(s.current_study_year) : null;
      var yRoman = yNum === 1 ? 'I' : yNum === 2 ? 'II' : yNum === 3 ? 'III' : String(s.year || '—');
      if (info) {
        info.innerHTML =
          '<strong>' +
          esc(s.name) +
          '</strong> · ' +
          esc(s.reg_no) +
          ' · ' +
          esc(s.dept || '') +
          ' · Year <strong>' +
          esc(yRoman) +
          '</strong>' +
          (s.year ? ' (' + esc(String(s.year)) + ')' : '') +
          ' · Status <strong>' +
          esc(s.academic_status || '') +
          '</strong>' +
          (s.progress_locked ? ' · <span class="badge pending">Locked</span>' : '') +
          (s.previous_reg_no ? ' · Prev reg ' + esc(s.previous_reg_no) : '') +
          (s.alt_reg_no ? ' · Alt reg ' + esc(s.alt_reg_no) : '');
      }
      if (audit) {
        var bits = [];
        var yt = s.year_transfer_last;
        if (yt && yt.by) {
          bits.push(
            'Last year move: <strong>' +
              esc(String(yt.to_roman || yt.to || '')) +
              '</strong> by <strong>' +
              esc(yt.by) +
              '</strong>' +
              (yt.role ? ' (' + esc(yt.role) + ')' : '') +
              (yt.at ? ' @ ' + esc(String(yt.at).slice(0, 16).replace('T', ' ')) : ''),
          );
        }
        var lc = s.last_change || (s.ops_flags && s.ops_flags.last_change);
        if (lc && lc.by) {
          bits.push(
            'Last category change by <strong>' +
              esc(lc.by) +
              '</strong>' +
              (lc.role ? ' (' + esc(lc.role) + ')' : '') +
              (lc.at ? ' @ ' + esc(String(lc.at).slice(0, 16).replace('T', ' ')) : ''),
          );
        }
        var rem = s.ops_flags && s.ops_flags.removed_by;
        if (rem) {
          bits.push(
            'Removed from list by <strong>' +
              esc(rem) +
              '</strong>' +
              (s.ops_flags.removed_at
                ? ' @ ' + esc(String(s.ops_flags.removed_at).slice(0, 16).replace('T', ' '))
                : ''),
          );
        }
        audit.innerHTML = bits.length
          ? '<div style="padding:8px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;">' +
            bits.join('<br>') +
            '</div>'
          : '';
      }
      var yearSel = document.getElementById(pid + '_year');
      if (yearSel && yNum >= 1 && yNum <= 3) yearSel.value = String(yNum);
      var flags = s.ops_flags || {};
      ;['iti', 'puc', 'repeater', 'not_eligible', 'year_back', 'change_of_branch'].forEach(function (k) {
        var cb = document.getElementById(pid + '_' + k);
        if (cb) cb.checked = !!flags[k];
      });
      var notes = document.getElementById(pid + '_notes');
      if (notes) notes.value = flags.notes || '';
      if (msg) msg.textContent = 'Loaded.';
      window._opsCatReg = reg;
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.opsYearSingle = async function (pid) {
    var reg =
      window._opsCatReg ||
      ((document.getElementById(pid + '_reg') || {}).value || '').trim().toUpperCase();
    var yearEl = document.getElementById(pid + '_year');
    var msg = document.getElementById(pid + '_msg');
    var note = ((document.getElementById(pid + '_notes') || {}).value || '').trim();
    if (!reg) {
      alert('Fetch a student first');
      return;
    }
    var toYear = yearEl ? yearEl.value : '';
    if (!toYear) {
      alert('Select year I / II / III');
      return;
    }
    if (!confirm('Move ' + reg + ' to Year ' + (toYear === '1' ? 'I' : toYear === '2' ? 'II' : 'III') + '?')) return;
    if (msg) msg.textContent = 'Updating year…';
    try {
      var data = await api('/api/ops/year-transfer', {
        method: 'POST',
        body: { reg_no: reg, to_year: Number(toYear), note: note || null },
      });
      if (msg) {
        msg.innerHTML =
          '<span style="color:#166534;">Year updated to ' +
          esc(data.to_roman || toYear) +
          actorSuffix(data) +
          '.</span>';
      }
      window.opsCatFetch(pid);
      // refresh bulk roster if loaded
      if (document.getElementById(pid + '_bulk_body')) {
        window.opsYearRoster && window.opsYearRoster(pid);
      }
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.opsYearRoster = async function (pid) {
    var body = document.getElementById(pid + '_bulk_body');
    var meta = document.getElementById(pid + '_bulk_meta');
    var fromEl = document.getElementById(pid + '_bulk_from');
    var qEl = document.getElementById(pid + '_bulk_q');
    var year = fromEl ? fromEl.value : '';
    var q = qEl ? qEl.value.trim() : '';
    if (body) body.innerHTML = '<tr><td colspan="5" style="padding:16px;opacity:.7;">Loading…</td></tr>';
    try {
      var qs =
        'roster=1' +
        (year ? '&year=' + encodeURIComponent(year) : '') +
        (q ? '&q=' + encodeURIComponent(q) : '');
      var data = await api('/api/ops/year-transfer?' + qs);
      var list = data.students || [];
      window._opsYearRoster = list;
      if (meta) {
        meta.innerHTML =
          list.length +
          ' student(s)' +
          (data.hod_code
            ? ' · HOD branch <strong>' + esc(data.hod_code) + '</strong> (filter by reg: CS/CE/EC/ME)'
            : '') +
          ' · select rows then Apply bulk year change';
      }
      if (!body) return;
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="5" style="padding:16px;opacity:.7;">No students match.</td></tr>';
        return;
      }
      body.innerHTML = list
        .map(function (s, i) {
          return (
            '<tr style="border-top:1px solid var(--border);">' +
            '<td style="padding:6px 8px;"><input type="checkbox" data-year-reg="' +
            esc(s.reg_no) +
            '" class="' +
            pid +
            '_bulk_cb" /></td>' +
            '<td style="padding:6px 8px;font-family:monospace;font-size:0.75rem;">' +
            esc(s.reg_no) +
            '</td>' +
            '<td style="padding:6px 8px;">' +
            esc(s.name) +
            '</td>' +
            '<td style="padding:6px 8px;text-align:center;font-weight:700;">' +
            esc(s.year_roman || '—') +
            '</td>' +
            '<td style="padding:6px 8px;text-align:center;font-size:0.75rem;">' +
            esc(s.admission_academic_year || '—') +
            '</td></tr>'
          );
        })
        .join('');
      var all = document.getElementById(pid + '_bulk_all');
      if (all) all.checked = false;
    } catch (e) {
      if (body) {
        body.innerHTML =
          '<tr><td colspan="5" style="padding:16px;color:#991b1b;">' + esc(e.message) + '</td></tr>';
      }
    }
  };

  window.opsYearToggleAll = function (pid, on) {
    document.querySelectorAll('.' + pid + '_bulk_cb').forEach(function (cb) {
      cb.checked = !!on;
    });
  };

  function opsYearSelectedRegs(pid) {
    var regs = [];
    document.querySelectorAll('.' + pid + '_bulk_cb:checked').forEach(function (cb) {
      var r = cb.getAttribute('data-year-reg');
      if (r) regs.push(r);
    });
    return regs;
  }

  window.opsYearBulk = async function (pid) {
    var toEl = document.getElementById(pid + '_bulk_to');
    var msg = document.getElementById(pid + '_bulk_msg');
    var note = ((document.getElementById(pid + '_notes') || {}).value || '').trim();
    var toYear = toEl ? toEl.value : '';
    var regs = opsYearSelectedRegs(pid);
    if (!regs.length) {
      alert('Select at least one student');
      return;
    }
    if (!toYear) {
      alert('Select target year');
      return;
    }
    var roman = toYear === '1' ? 'I' : toYear === '2' ? 'II' : 'III';
    var fromFilter = ((document.getElementById(pid + '_bulk_from') || {}).value || '');
    var fromRoman = fromFilter === '1' ? 'I' : fromFilter === '2' ? 'II' : fromFilter === '3' ? 'III' : 'current';
    if (fromFilter && fromFilter === toYear) {
      alert(
        'Target year is the same as the filter year (' +
          roman +
          ' → ' +
          roman +
          ').\n\nChoose a different “Move selected to” year (e.g. III) so students leave this list.',
      );
      return;
    }
    if (
      !confirm(
        'Move ' +
          regs.length +
          ' student(s) to Year ' +
          roman +
          '?\n\nThey will leave the Year ' +
          fromRoman +
          ' filter after success.\nLive database will update.',
      )
    ) {
      return;
    }
    if (msg) msg.textContent = 'Updating ' + regs.length + ' students…';
    try {
      var data = await api('/api/ops/year-transfer', {
        method: 'POST',
        body: {
          action: 'set_year',
          reg_nos: regs,
          to_year: Number(toYear),
          note: note || 'Bulk year transfer',
        },
      });
      var errTxt =
        data.errors && data.errors.length
          ? '<br><span style="color:#991b1b;font-size:0.78rem;">' +
            esc(data.errors.join(' · ')) +
            '</span>'
          : '';
      if (msg) {
        msg.innerHTML =
          (data.updated
            ? '<span style="color:#166534;">Moved <strong>' +
              esc(String(data.updated || 0)) +
              '</strong> → Year ' +
              esc(data.to_roman || roman) +
              actorSuffix(data) +
              '.</span> '
            : '') +
          (data.failed
            ? '<span style="color:#991b1b;">Failed: ' + esc(String(data.failed)) + '.</span>'
            : '') +
          errTxt;
      }
      // Reload roster — transferred students leave the filtered year list
      await window.opsYearRoster(pid);
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.opsYearRemove = async function (pid) {
    var msg = document.getElementById(pid + '_bulk_msg');
    var note = ((document.getElementById(pid + '_notes') || {}).value || '').trim();
    var regs = opsYearSelectedRegs(pid);
    if (!regs.length) {
      alert('Select at least one student to remove from the list');
      return;
    }
    if (
      !confirm(
        'Remove ' +
          regs.length +
          ' student(s) from the active roster list?\n\nThey will no longer appear here (status → removed). Student login/account is not deleted.',
      )
    ) {
      return;
    }
    if (msg) msg.textContent = 'Removing ' + regs.length + ' students…';
    try {
      var data = await api('/api/ops/year-transfer', {
        method: 'POST',
        body: {
          action: 'remove',
          reg_nos: regs,
          note: note || 'Removed from roster list',
        },
      });
      if (msg) {
        msg.innerHTML =
          '<span style="color:#166534;">Removed <strong>' +
          esc(String(data.updated || 0)) +
          '</strong> from list' +
          actorSuffix(data) +
          '.</span>' +
          (data.failed
            ? ' <span style="color:#991b1b;">Failed: ' + esc(String(data.failed)) + '</span>'
            : '');
      }
      await window.opsYearRoster(pid);
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.opsCatSave = async function (pid) {
    var reg =
      window._opsCatReg ||
      ((document.getElementById(pid + '_reg') || {}).value || '').trim().toUpperCase();
    if (!reg) {
      alert('Fetch a student first');
      return;
    }
    var flags = {};
    ;['iti', 'puc', 'repeater', 'not_eligible', 'year_back', 'change_of_branch'].forEach(function (k) {
      var cb = document.getElementById(pid + '_' + k);
      flags[k] = !!(cb && cb.checked);
    });
    var notes = (document.getElementById(pid + '_notes') || {}).value || '';
    flags.notes = notes;
    var msg = document.getElementById(pid + '_msg');
    try {
      var saved = await api('/api/ops/category', {
        method: 'POST',
        body: { reg_no: reg, flags: flags, reason: notes },
      });
      if (msg) {
        msg.innerHTML =
          '<span style="color:#166534;">Category saved' + actorSuffix(saved) + '.</span>';
      }
      window.opsCatFetch(pid);
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.opsXferLoad = async function (pid) {
    var list = document.getElementById(pid + '_list');
    if (list) list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    try {
      var data = await api('/api/ops/branch-transfer');
      var rows = data.transfers || [];
      var write = !!data.can_write || canTransferWrite();
      if (!list) return;
      if (!rows.length) {
        list.innerHTML = '<p style="opacity:.7;">No transfers yet.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th>ID</th><th>Student</th><th>Old→New</th><th>From→To</th><th>Status</th><th>Who did what</th><th></th></tr></thead><tbody>';
      rows.forEach(function (t) {
        var auditParts = [];
        if (t.created_by_name) {
          auditParts.push(
            'Created by ' + t.created_by_name + (t.created_at ? ' @ ' + String(t.created_at).slice(0, 16).replace('T', ' ') : ''),
          );
        }
        if (t.released_by_name) {
          auditParts.push(
            'Released by ' + t.released_by_name + (t.released_at ? ' @ ' + String(t.released_at).slice(0, 16).replace('T', ' ') : ''),
          );
        }
        if (t.accepted_by_name) {
          auditParts.push(
            'Accepted by ' + t.accepted_by_name + (t.accepted_at ? ' @ ' + String(t.accepted_at).slice(0, 16).replace('T', ' ') : ''),
          );
        }
        if (t.cancelled_by_name) {
          auditParts.push(
            'Cancelled by ' + t.cancelled_by_name + (t.cancelled_at ? ' @ ' + String(t.cancelled_at).slice(0, 16).replace('T', ' ') : ''),
          );
        }
        var audit = auditParts.join(' · ');
        var acts = '';
        if (write && t.status === 'draft') {
          acts +=
            '<button type="button" class="btn ol" style="padding:3px 8px;font-size:0.7rem;" onclick="window.opsXferAct(\'release\',' +
            t.id +
            ',\'' +
            pid +
            '\')">Release (out)</button> ';
        }
        if (write && t.status === 'released') {
          acts +=
            '<button type="button" class="btn go" style="padding:3px 8px;font-size:0.7rem;" onclick="window.opsXferAct(\'accept\',' +
            t.id +
            ',\'' +
            pid +
            '\')">Accept (in)</button> ';
        }
        if (write && (t.status === 'draft' || t.status === 'released')) {
          acts +=
            '<button type="button" class="btn ol" style="padding:3px 8px;font-size:0.7rem;" onclick="window.opsXferAct(\'cancel\',' +
            t.id +
            ',\'' +
            pid +
            '\')">Cancel</button>';
        }
        html +=
          '<tr style="border-top:1px solid var(--border);vertical-align:top;">' +
          '<td style="padding:6px;">' +
          t.id +
          '</td><td style="padding:6px;">' +
          esc(t.student_name) +
          '</td><td style="padding:6px;font-family:monospace;font-size:0.7rem;">' +
          esc(t.old_reg_no) +
          ' → ' +
          esc(t.new_reg_no) +
          '</td><td style="padding:6px;font-size:0.72rem;">' +
          esc(t.from_branch) +
          ' → ' +
          esc(t.to_branch) +
          '</td><td style="padding:6px;"><span class="badge ' +
          (t.status === 'accepted' ? 'active' : 'pending') +
          '">' +
          esc(t.status) +
          '</span></td><td style="padding:6px;font-size:0.68rem;opacity:.85;max-width:220px;">' +
          esc(audit) +
          '</td><td style="padding:6px;white-space:nowrap;">' +
          acts +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      if (list) list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.opsXferCreate = async function (pid) {
    var oldR = ((document.getElementById(pid + '_old') || {}).value || '').trim().toUpperCase();
    var newR = ((document.getElementById(pid + '_new') || {}).value || '').trim().toUpperCase();
    var to = ((document.getElementById(pid + '_to') || {}).value || '').trim();
    var notes = ((document.getElementById(pid + '_notes') || {}).value || '').trim();
    if (!oldR || !newR || !to) {
      alert('Fill old reg, new reg, and destination branch');
      return;
    }
    try {
      var created = await api('/api/ops/branch-transfer', {
        method: 'POST',
        body: { action: 'create', old_reg_no: oldR, new_reg_no: newR, to_branch: to, notes: notes },
      });
      var who = (window.currentUser && window.currentUser.display_name) || 'you';
      alert(
        'Draft created by ' +
          who +
          '.\nOutgoing HOD/ACM should Release, then incoming HOD/ACM Accept.\nWho did each step is saved on the transfer.',
      );
      window.opsXferLoad(pid);
      void created;
    } catch (e) {
      alert(e.message);
    }
  };

  window.opsXferAct = async function (action, id, pid) {
    if (!confirm(action.toUpperCase() + ' transfer #' + id + '?')) return;
    try {
      await api('/api/ops/branch-transfer', {
        method: 'POST',
        body: { action: action, id: id },
      });
      window.opsXferLoad(pid);
    } catch (e) {
      alert(e.message);
    }
  };

  function hookShowSec() {
    if (typeof window.showSec !== 'function') {
      setTimeout(hookShowSec, 200);
      return;
    }
    if (window.showSec._opsHooked) return;
    var orig = window.showSec;
    window.showSec = function (secId, linkEl) {
      var r = orig.apply(this, arguments);
      try {
        if (secId && String(secId).indexOf('Ops') >= 0) {
          window.opsEnsurePanel(secId);
        }
      } catch (e) {
        console.warn('[ops]', e);
      }
      return r;
    };
    window.showSec._opsHooked = true;
  }

  window.opsEnsureMenus = ensureOpsMenus;

  function boot() {
    if (!roleOk()) return;
    ensureOpsMenus();
    hookShowSec();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(boot, 400);
    });
  } else {
    setTimeout(boot, 400);
  }
  // Re-inject after login paints dashboards
  setInterval(function () {
    if (roleOk()) ensureOpsMenus();
  }, 4000);

  console.log('[legacy-ops] Student Management hub (roster · year · category · transfer · reports · AY)');
})();
