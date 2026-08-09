/**
 * GPT Hubli — Exam results self-entry, verification, provisional card,
 * live exam fees + multi K2 challan (manual Exam paid tick — no K2 API).
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
    if (!r.ok) {
      var err = (data && (data.error || data.message)) || ('HTTP ' + r.status);
      throw new Error(err);
    }
    return data;
  }

  // C-20 marksheet grades (S / A+ / A …) + common alt labels
  var GRADES = ['', 'S', 'A+', 'A', 'B+', 'B', 'C', 'D', 'E', 'F', 'O', 'P', 'W', 'X', 'Ab', 'Pass', 'Fail'];

  /**
   * Exam sessions roll forever from 2020-21 through current AY + next year.
   * No hard stop at 2026-27 — 2027-28, 2028-29… appear automatically.
   * November ≈ odd-term sitting; April ≈ even-term sitting.
   */
  function buildExamSessions(d) {
    d = d || new Date();
    var term = calendarTermInfo(d);
    var startYear = Number(String(term.academic_year || '').split('-')[0]) || d.getFullYear();
    var list = [];
    for (var s = 2020; s <= startYear + 1; s++) {
      var ay = s + '-' + String((s + 1) % 100).padStart(2, '0');
      list.push(ay + ' November');
      list.push(ay + ' April');
    }
    list.push('Other / Supplementary');
    return list;
  }

  var SESSIONS = buildExamSessions();

  /** Jun–Dec = odd term (1/3/5); Jan–May = even term (2/4/6). AY flips in June — permanent calendar rule. */
  function calendarTermInfo(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = d.getMonth() + 1; // 1–12
    var odd = m >= 6;
    var start = odd ? y : y - 1;
    var ay = start + '-' + String((start + 1) % 100).padStart(2, '0');
    return {
      parity: odd ? 'odd' : 'even',
      academic_year: ay,
      label: odd ? 'Odd semester (Jun–Dec)' : 'Even semester (Jan–May)',
    };
  }

  /** Study year 1/2/3 → running semester for current calendar term. */
  function semesterFromStudyYear(studyYear, parity) {
    var y = Number(studyYear);
    if (y !== 1 && y !== 2 && y !== 3) return null;
    var p = parity || calendarTermInfo().parity;
    return p === 'odd' ? 2 * y - 1 : 2 * y;
  }

  /* ---------- Student: Results entry ---------- */
  function ensureStuResultsPanel() {
    var panel = document.getElementById('stuResults');
    if (!panel) return;
    // v2 = Regular | Makeup tabs
    if (panel.getAttribute('data-exam-live') === '2' && document.getElementById('examOfficialHost')) return;
    panel.setAttribute('data-exam-live', '2');
    panel.innerHTML =
      '<div class="info-box"><strong>My Exam Results</strong> — Official ledger when published. ' +
      '<strong>Regular</strong> = normal semester entry. <strong>Makeup</strong> = only after Exam opens a makeup month ' +
      '(e.g. July / August 2026) for failed even-sem subjects. HOD / Exam verify. Verified rows lock.</div>' +
      '<div id="examStuMeta" style="padding:8px 4px;font-size:0.82rem;opacity:.85;"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<button type="button" class="btn pr" id="stuResTabReg" onclick="window.stuResShowTab&&window.stuResShowTab(\'regular\')">Regular</button>' +
      '<button type="button" class="btn ol" id="stuResTabMk" onclick="window.stuResShowTab&&window.stuResShowTab(\'makeup\')">Makeup</button>' +
      '<span id="stuResMakeupBadge" style="display:none;font-size:0.75rem;font-weight:800;padding:6px 10px;border-radius:999px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;"></span>' +
      '</div>' +
      /* Regular pane */
      '<div id="stuResPaneRegular">' +
      '<div class="card" style="margin-bottom:14px;" id="examOfficialCard">' +
      '<div class="card-hd"><h3>Official published results</h3></div>' +
      '<div id="examOfficialHost" style="padding:12px 16px;"><p style="opacity:.7;">Loading…</p></div></div>' +
      '<div class="card" style="margin-bottom:14px;">' +
      '<div class="card-hd"><h3>Enter / update results (Regular)</h3>' +
      '<div class="card-acts">' +
      '<button type="button" class="btn ol" onclick="window.examStuReload&&window.examStuReload()">Refresh</button> ' +
      '<button type="button" class="btn pr" onclick="window.examStuSave&&window.examStuSave(false)">Save draft</button> ' +
      '<button type="button" class="btn go" onclick="window.examStuSave&&window.examStuSave(true)">Submit for verification</button> ' +
      '<button type="button" class="btn ol" onclick="window.examPrintProvisional&&window.examPrintProvisional()">Provisional card</button>' +
      '</div></div>' +
      '<div style="padding:12px 16px;">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:end;">' +
      '<div><label style="font-size:0.75rem;font-weight:700;">Semester</label><br>' +
      '<select id="examStuSem" onchange="window.examStuOnSemChange&&window.examStuOnSemChange()" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="1">Sem 1</option><option value="2">Sem 2</option><option value="3">Sem 3</option>' +
      '<option value="4">Sem 4</option><option value="5">Sem 5</option><option value="6">Sem 6</option>' +
      '</select></div>' +
      '<div style="flex:1;min-width:200px;font-size:0.78rem;opacity:.8;" id="examStuSemHint"></div>' +
      '</div>' +
      '<div id="examStuFormHost"><p style="opacity:.7;">Loading subjects…</p></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-hd"><h3>All attempts &amp; status</h3></div>' +
      '<div id="examStuList" style="padding:12px 16px;overflow-x:auto;"></div></div>' +
      '</div>' +
      /* Makeup pane */
      '<div id="stuResPaneMakeup" style="display:none;">' +
      '<div id="stuMakeupBanner" class="info-box" style="margin-bottom:12px;">Loading makeup status…</div>' +
      '<div class="card" style="margin-bottom:14px;">' +
      '<div class="card-hd"><h3>Makeup result entry</h3>' +
      '<div class="card-acts">' +
      '<button type="button" class="btn ol" onclick="window.makeupStuReload&&window.makeupStuReload()">Refresh</button> ' +
      '<button type="button" class="btn pr" onclick="window.makeupStuSave&&window.makeupStuSave(false)">Save draft</button> ' +
      '<button type="button" class="btn go" onclick="window.makeupStuSave&&window.makeupStuSave(true)">Submit for verification</button>' +
      '</div></div>' +
      '<div style="padding:12px 16px;">' +
      '<p style="font-size:0.8rem;opacity:.8;margin:0 0 10px;">Only subjects you have <strong>not passed</strong> (fail/absent) after regular even-sem results. Session is set by Exam (makeup month).</p>' +
      '<div id="stuMakeupFormHost"><p style="opacity:.7;">Open the Makeup tab when Exam declares the month.</p></div>' +
      '</div></div>' +
      '<div class="card"><div class="card-hd"><h3>My makeup attempts</h3></div>' +
      '<div id="stuMakeupList" style="padding:12px 16px;overflow-x:auto;"></div></div>' +
      '</div>';
  }

  window.stuResShowTab = function (tab) {
    var reg = document.getElementById('stuResPaneRegular');
    var mk = document.getElementById('stuResPaneMakeup');
    var bR = document.getElementById('stuResTabReg');
    var bM = document.getElementById('stuResTabMk');
    if (reg) reg.style.display = tab === 'regular' ? '' : 'none';
    if (mk) mk.style.display = tab === 'makeup' ? '' : 'none';
    if (bR) bR.className = tab === 'regular' ? 'btn pr' : 'btn ol';
    if (bM) bM.className = tab === 'makeup' ? 'btn pr' : 'btn ol';
    if (tab === 'makeup') window.makeupStuReload && window.makeupStuReload();
  };

  window._makeupStuState = { cycle: null, eligible: [], makeup_attempts: [] };

  window.makeupStuReload = async function () {
    ensureStuResultsPanel();
    var banner = document.getElementById('stuMakeupBanner');
    var host = document.getElementById('stuMakeupFormHost');
    var list = document.getElementById('stuMakeupList');
    var badge = document.getElementById('stuResMakeupBadge');
    try {
      var data = await api('/api/exam/makeup/attempts');
      window._makeupStuState = data;
      var cycle = data.cycle;
      if (badge) {
        if (cycle && cycle.status === 'open') {
          badge.style.display = '';
          badge.textContent = 'Open · ' + (cycle.month_label || cycle.label || 'Makeup');
        } else {
          badge.style.display = 'none';
        }
      }
      if (banner) {
        if (!cycle) {
          banner.innerHTML =
            '<strong>Makeup not declared yet.</strong> Exam Section will open a makeup month ' +
            '(e.g. July / August 2026) after even-sem results. Check back then.';
          banner.style.background = '#f8fafc';
        } else if (cycle.status === 'open') {
          banner.innerHTML =
            '<strong>Makeup open:</strong> ' +
            esc(cycle.month_label) +
            ' · Session <strong>' +
            esc(cycle.session_name) +
            '</strong>' +
            (cycle.note ? '<div style="margin-top:6px;opacity:.85;">' + esc(cycle.note) + '</div>' : '');
          banner.style.background = '#ecfdf5';
        } else {
          banner.innerHTML =
            '<strong>Makeup cycle is ' +
            esc(cycle.status) +
            '.</strong> ' +
            esc(cycle.month_label || '') +
            ' — new entry closed.';
          banner.style.background = '#fef3c7';
        }
      }
      window.makeupStuPaintForm();
      if (list) {
        var rows = data.makeup_attempts || [];
        if (!rows.length) {
          list.innerHTML = '<p style="opacity:.7;">No makeup attempts yet.</p>';
        } else {
          list.innerHTML =
            '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
            '<th style="text-align:left;padding:6px;">Subject</th><th>Session</th><th>Result</th><th>Grade</th><th>Status</th></tr></thead><tbody>' +
            rows
              .map(function (a) {
                return (
                  '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;"><strong>' +
                  esc(a.subject_code) +
                  '</strong><div style="font-size:0.72rem;opacity:.75;">' +
                  esc(a.subject_name) +
                  ' · Sem ' +
                  a.semester +
                  '</div></td><td style="padding:6px;">' +
                  esc(a.exam_session) +
                  '</td><td style="padding:6px;">' +
                  esc(a.result) +
                  '</td><td style="padding:6px;">' +
                  esc(a.grade || '—') +
                  '</td><td style="padding:6px;">' +
                  esc(a.status) +
                  (a.verified_by_name
                    ? '<div style="font-size:0.7rem;opacity:.75;">' + esc(a.verified_by_name) + '</div>'
                    : '') +
                  '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table>';
        }
      }
    } catch (e) {
      if (banner) banner.textContent = e.message || 'Failed to load makeup';
      if (host) host.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.makeupStuPaintForm = function () {
    var host = document.getElementById('stuMakeupFormHost');
    if (!host) return;
    var data = window._makeupStuState || {};
    var cycle = data.cycle;
    if (!cycle || cycle.status !== 'open') {
      host.innerHTML =
        '<p style="opacity:.75;">Makeup entry unlocks when Exam sets status to <strong>Open</strong>.</p>';
      return;
    }
    var eligible = data.eligible || [];
    var existing = data.makeup_attempts || [];
    if (!eligible.length && !existing.length) {
      host.innerHTML =
        '<p style="opacity:.75;">No failed subjects eligible for this makeup (or you have already passed all).</p>';
      return;
    }
    // Merge eligible + any existing makeup rows not in eligible
    var byCode = {};
    eligible.forEach(function (e) {
      byCode[e.subject_code] = {
        code: e.subject_code,
        name: e.subject_name,
        semester: e.semester,
      };
    });
    existing.forEach(function (a) {
      if (!byCode[a.subject_code]) {
        byCode[a.subject_code] = {
          code: a.subject_code,
          name: a.subject_name,
          semester: a.semester,
        };
      }
    });
    var codes = Object.keys(byCode).sort();
    var html =
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>' +
      '<th style="text-align:left;padding:6px;">Subject</th><th>Session</th><th>Result</th><th>Grade</th></tr></thead><tbody>';
    codes.forEach(function (code) {
      var sub = byCode[code];
      var ex =
        existing.filter(function (a) {
          return a.subject_code === code;
        })[0] || {};
      var locked = ex.status === 'verified';
      html +=
        '<tr class="makeup-stu-row" data-code="' +
        esc(sub.code) +
        '" data-name="' +
        esc(sub.name) +
        '" data-sem="' +
        sub.semester +
        '" data-locked="' +
        (locked ? '1' : '0') +
        '" style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px 6px;"><strong>' +
        esc(sub.code) +
        '</strong><div style="font-size:0.72rem;opacity:.75;">' +
        esc(sub.name) +
        ' · Sem ' +
        sub.semester +
        '</div>' +
        (locked ? '<span class="badge active">Verified</span>' : '') +
        (ex.status === 'pending' ? '<span class="badge pending">Pending</span>' : '') +
        '</td>' +
        '<td style="padding:6px;font-size:0.78rem;">' +
        esc(cycle.session_name) +
        '</td>' +
        '<td style="padding:6px;"><select class="makeup-res" ' +
        (locked ? 'disabled' : '') +
        ' style="padding:6px;border-radius:6px;border:1px solid var(--border);">' +
        ['pass', 'fail', 'absent']
          .map(function (r) {
            return (
              '<option value="' +
              r +
              '"' +
              (ex.result === r ? ' selected' : '') +
              '>' +
              r +
              '</option>'
            );
          })
          .join('') +
        '</select></td>' +
        '<td style="padding:6px;"><select class="makeup-grade" ' +
        (locked ? 'disabled' : '') +
        ' style="padding:6px;border-radius:6px;border:1px solid var(--border);">';
      GRADES.forEach(function (g) {
        html +=
          '<option value="' +
          esc(g) +
          '"' +
          (String(ex.grade || '') === g ? ' selected' : '') +
          '>' +
          (g || '—') +
          '</option>';
      });
      html += '</select></td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  };

  window.makeupStuSave = async function (submit) {
    var rows = document.querySelectorAll('#stuMakeupFormHost tr.makeup-stu-row');
    var attempts = [];
    rows.forEach(function (tr) {
      if (tr.getAttribute('data-locked') === '1') return;
      var res = (tr.querySelector('.makeup-res') || {}).value || 'fail';
      var grade = (tr.querySelector('.makeup-grade') || {}).value || '';
      attempts.push({
        subject_code: tr.getAttribute('data-code'),
        subject_name: tr.getAttribute('data-name'),
        semester: Number(tr.getAttribute('data-sem')),
        result: res,
        grade: grade,
      });
    });
    if (!attempts.length) {
      alert('No editable makeup subjects to save.');
      return;
    }
    try {
      var data = await api('/api/exam/makeup/attempts', {
        method: 'POST',
        body: { action: submit ? 'submit' : 'save', attempts: attempts },
      });
      if (data.errors && data.errors.length) {
        alert('Saved with notes:\n' + data.errors.join('\n'));
      } else {
        alert(submit ? 'Submitted for HOD / Exam verification.' : 'Draft saved.');
      }
      window.makeupStuReload();
    } catch (e) {
      alert(e.message || 'Save failed');
    }
  };

  window._examStuState = { curriculum: [], attempts: [], student: null, effective: [] };

  window.examStuPaintOfficial = function (rows) {
    var host = document.getElementById('examOfficialHost');
    if (!host) return;
    rows = rows || [];
    if (!rows.length) {
      host.innerHTML =
        '<p style="opacity:.7;">No official semester results published yet. ' +
        'When Exam Section publishes the ledger, grades appear here automatically.</p>';
      return;
    }
    var html = '';
    rows.forEach(function (r) {
      var subs = Array.isArray(r.subjects) ? r.subjects : [];
      html +=
        '<div style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">' +
        '<div style="padding:10px 12px;background:#eef4ff;display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;">' +
        '<strong>Sem ' + esc(String(r.sem)) + '</strong>' +
        '<span>· ' + esc(r.session || '') + '</span>' +
        (r.sgpa != null ? '<span>· SGPA <strong>' + esc(String(r.sgpa)) + '</strong></span>' : '') +
        '<span class="badge ' +
        (String(r.result || '').toLowerCase() === 'pass' ? 'active' : 'pending') +
        '">' +
        esc(r.result || '—') +
        '</span></div>';
      if (!subs.length) {
        html += '<p style="padding:10px 12px;opacity:.7;">No subject breakdown.</p>';
      } else {
        html +=
          '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>' +
          '<th style="text-align:left;padding:6px 10px;">Code</th>' +
          '<th style="text-align:left;padding:6px 10px;">Subject</th>' +
          '<th style="padding:6px 8px;">Credits</th>' +
          '<th style="padding:6px 8px;">Grade</th></tr></thead><tbody>';
        subs.forEach(function (s) {
          html +=
            '<tr style="border-top:1px solid var(--border);">' +
            '<td style="padding:6px 10px;font-family:monospace;font-size:0.75rem;">' +
            esc(s.code || '') +
            '</td><td style="padding:6px 10px;">' +
            esc(s.name || '') +
            '</td><td style="padding:6px 8px;text-align:center;">' +
            esc(String(s.credits != null ? s.credits : '—')) +
            '</td><td style="padding:6px 8px;text-align:center;font-weight:700;">' +
            esc(s.grade || '—') +
            '</td></tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';
    });
    host.innerHTML = html;
  };

  window.examStuReload = async function () {
    ensureStuResultsPanel();
    // Refresh makeup badge quietly
    try {
      var mk = await api('/api/exam/makeup/cycles');
      var badge = document.getElementById('stuResMakeupBadge');
      if (badge && mk.open) {
        badge.style.display = '';
        badge.textContent = 'Open · ' + (mk.open.month_label || mk.open.label || 'Makeup');
      } else if (badge) {
        badge.style.display = 'none';
      }
    } catch (eMk) { /* ignore */ }
    var meta = document.getElementById('examStuMeta');
    var host = document.getElementById('examStuFormHost');
    var list = document.getElementById('examStuList');
    try {
      SESSIONS = buildExamSessions(); // roll exam-session list into future AYs automatically
      // Official published ledger (results table) + self-entry attempts in parallel
      var publishedP = api('/api/results').catch(function () { return { results: [] }; });
      var data = await api('/api/exam/attempts');
      window._examStuState = data;
      var pub = await publishedP;
      window.examStuPaintOfficial(Array.isArray(pub.results) ? pub.results : []);
      var st = data.student || {};
      var term = calendarTermInfo();
      var parity = data.term_parity || term.parity;
      var ay = data.active_academic_year || term.academic_year;
      var termLabel = data.term_label || term.label;
      var autoSem =
        data.current_semester != null
          ? Number(data.current_semester)
          : semesterFromStudyYear(st.current_study_year, parity);
      // Auto-select running semester (student can still change the dropdown)
      var semSel = document.getElementById('examStuSem');
      if (semSel && autoSem != null && !semSel.getAttribute('data-user-picked')) {
        semSel.value = String(autoSem);
      }
      if (meta) {
        var pw = data.pathway;
        meta.innerHTML =
          '<strong>' + esc(st.name || '') + '</strong> · ' + esc(st.reg_no || '') +
          ' · ' + esc(st.branch || '') +
          ' · Scheme: <strong>' + esc(st.scheme || '—') + '</strong>' +
          (st.admission_academic_year ? ' · Adm. ' + esc(st.admission_academic_year) : '') +
          (st.current_study_year ? ' · Year ' + esc(String(st.current_study_year)) : '') +
          (st.entry_type === 'lateral'
            ? ' · <span class="badge pending">Lateral (ITI/PUC) — Year-1 hidden</span>'
            : '') +
          ' · <span class="badge active">AY ' + esc(ay) + ' · ' + esc(termLabel) +
          (autoSem != null ? ' · running Sem ' + autoSem : '') + '</span>' +
          (pw
            ? ' · <span class="badge active">Pathway: ' + esc(pw.label) + ' (' + esc(pw.academic_year || '') + ')</span>'
            : data.pathway_required
              ? ' · <span class="badge pending">Sem 5–6 pathway not assigned by HOD</span>'
              : '') +
          (data.pathway_note
            ? '<div style="margin-top:6px;font-size:0.78rem;opacity:.85;">' + esc(data.pathway_note) + '</div>'
            : '') +
          '<div style="margin-top:6px;font-size:0.75rem;opacity:.8;">' +
          'Term rule: every <strong>June</strong> starts odd semesters (1/3/5); every <strong>January</strong> starts even (2/4/6). ' +
          'Use the Semester dropdown to enter backlog / other sem results.</div>';
      }
      // C-25 subjects are live for I/II Year; form paints from curriculum API.
      window.examStuPaintForm();
      window.examStuPaintList();
    } catch (e) {
      if (host) host.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
      if (list) list.innerHTML = '';
    }
  };

  window.examStuOnSemChange = function () {
    var sel = document.getElementById('examStuSem');
    if (sel) sel.setAttribute('data-user-picked', '1');
    window.examStuPaintForm && window.examStuPaintForm();
  };

  window.examStuPaintForm = function () {
    var host = document.getElementById('examStuFormHost');
    if (!host) return;
    var state = window._examStuState || {};
    var st = state.student || {};
    var term = calendarTermInfo();
    var parity = state.term_parity || term.parity;
    var autoSem =
      state.current_semester != null
        ? Number(state.current_semester)
        : semesterFromStudyYear(st.current_study_year, parity);
    var sem = Number((document.getElementById('examStuSem') || {}).value || 1);
    var cur = (state.curriculum || []).filter(function (s) { return Number(s.semester) === sem; });
    // If curriculum empty for this sem but attempts exist, still show those subjects
    if (!cur.length) {
      var byCode = {};
      (state.attempts || []).forEach(function (a) {
        if (Number(a.semester) !== sem) return;
        if (!byCode[a.subject_code]) {
          byCode[a.subject_code] = {
            code: a.subject_code,
            name: a.subject_name || a.subject_code,
            semester: sem,
          };
        }
      });
      cur = Object.keys(byCode)
        .sort()
        .map(function (k) { return byCode[k]; });
    }
    var hint = document.getElementById('examStuSemHint');
    if (hint) {
      var bits = [];
      if (autoSem != null) {
        bits.push(
          'Auto: AY ' + (state.active_academic_year || term.academic_year) +
            ' · ' + (state.term_label || term.label) +
            ' → Sem ' + autoSem +
            (Number(sem) === Number(autoSem) ? ' (selected)' : ' (you chose Sem ' + sem + ')'),
        );
      }
      bits.push(
        sem >= 5
          ? 'Sem 5–6 subjects come only from the pathway your HOD assigned for this academic year.'
          : 'Add one row per exam attempt (e.g. fail Nov, pass Apr).',
      );
      hint.textContent = bits.join(' — ');
    }
    if (!cur.length) {
      if (sem >= 5 && state.pathway_required) {
        host.innerHTML =
          '<div class="info-box" style="background:#fef3c7;">Your HOD has not assigned a Sem 5–6 pathway for the current academic year yet. ' +
          'Ask HOD to open <strong>Pathway assignment</strong> and set your pathway.</div>';
      } else {
        host.innerHTML = '<p style="opacity:.7;">No subjects for this semester (branch/scheme).</p>';
      }
      return;
    }
    var attempts = state.attempts || [];
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>' +
      '<th style="text-align:left;padding:6px;">Subject</th>' +
      '<th>Exam session</th><th>Result</th><th>Grade</th><th></th></tr></thead><tbody>';
    cur.forEach(function (sub, idx) {
      var existing = attempts.filter(function (a) {
        return a.subject_code === sub.code && Number(a.semester) === sem;
      });
      var rows = existing.length ? existing : [{ exam_session: '', result: 'fail', grade: '', status: 'draft' }];
      rows.forEach(function (ex, ri) {
        var locked = ex.status === 'verified';
        html += '<tr class="exam-stu-row" data-code="' + esc(sub.code) + '" data-name="' + esc(sub.name) +
          '" data-sem="' + sem + '" data-locked="' + (locked ? '1' : '0') + '" style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:8px 6px;"><strong>' + esc(sub.code) + '</strong><div style="font-size:0.72rem;opacity:.75;">' +
          esc(sub.name) + (sub.pathway ? ' · ' + esc(sub.pathway) : '') +
          (sub.is_audit ? ' · audit' : '') + '</div>' +
          (locked ? '<span class="badge active">Verified</span>' : '') +
          (ex.status === 'pending' ? '<span class="badge pending">Pending</span>' : '') +
          (ex.status === 'rejected' ? '<span class="badge" style="background:#fee2e2;color:#991b1b;">Rejected</span>' : '') +
          '</td>' +
          '<td style="padding:6px;"><select class="exam-sess" ' + (locked ? 'disabled' : '') +
          ' style="max-width:160px;padding:6px;border-radius:6px;border:1px solid var(--border);">';
        SESSIONS.forEach(function (s) {
          html += '<option value="' + esc(s) + '"' + (ex.exam_session === s ? ' selected' : '') + '>' + esc(s) + '</option>';
        });
        if (ex.exam_session && SESSIONS.indexOf(ex.exam_session) < 0) {
          html += '<option value="' + esc(ex.exam_session) + '" selected>' + esc(ex.exam_session) + '</option>';
        }
        html += '</select></td>' +
          '<td style="padding:6px;"><select class="exam-res" ' + (locked ? 'disabled' : '') +
          ' style="padding:6px;border-radius:6px;border:1px solid var(--border);">' +
          ['pass', 'fail', 'absent'].map(function (r) {
            return '<option value="' + r + '"' + (ex.result === r ? ' selected' : '') + '>' + r + '</option>';
          }).join('') + '</select></td>' +
          '<td style="padding:6px;"><select class="exam-grade" ' + (locked ? 'disabled' : '') +
          ' style="padding:6px;border-radius:6px;border:1px solid var(--border);">';
        GRADES.forEach(function (g) {
          html += '<option value="' + esc(g) + '"' + (String(ex.grade || '') === g ? ' selected' : '') + '>' +
            (g || '—') + '</option>';
        });
        if (ex.grade && GRADES.indexOf(ex.grade) < 0) {
          html += '<option value="' + esc(ex.grade) + '" selected>' + esc(ex.grade) + '</option>';
        }
        html += '</select></td>' +
          '<td style="padding:6px;white-space:nowrap;">' +
          (!locked
            ? '<button type="button" class="btn ol" style="padding:4px 8px;font-size:0.72rem;" onclick="window.examStuAddAttempt&&window.examStuAddAttempt(this)">+ Attempt</button>'
            : '') +
          '</td></tr>';
      });
    });
    html += '</tbody></table>' +
      '<p style="font-size:0.72rem;opacity:.7;margin-top:10px;">Tip: Failed in Dec/Nov session and passed later? Add another <strong>+ Attempt</strong> with the pass session.</p>';
    host.innerHTML = html;
  };

  window.examStuAddAttempt = function (btn) {
    var tr = btn && btn.closest ? btn.closest('tr') : null;
    if (!tr) return;
    var clone = tr.cloneNode(true);
    clone.setAttribute('data-locked', '0');
    clone.querySelectorAll('select').forEach(function (s) { s.disabled = false; });
    var sess = clone.querySelector('.exam-sess');
    if (sess) sess.selectedIndex = 0;
    var badge = clone.querySelector('.badge');
    if (badge) badge.remove();
    tr.parentNode.insertBefore(clone, tr.nextSibling);
  };

  window.examStuCollect = function () {
    var rows = document.querySelectorAll('#examStuFormHost tr.exam-stu-row');
    var attempts = [];
    rows.forEach(function (tr) {
      if (tr.getAttribute('data-locked') === '1') return;
      var code = tr.getAttribute('data-code') || '';
      var name = tr.getAttribute('data-name') || '';
      var sem = Number(tr.getAttribute('data-sem') || 0);
      var sess = (tr.querySelector('.exam-sess') || {}).value || '';
      var res = (tr.querySelector('.exam-res') || {}).value || 'fail';
      var grade = (tr.querySelector('.exam-grade') || {}).value || '';
      if (!code || !sess || !sem) return;
      attempts.push({
        subject_code: code,
        subject_name: name,
        semester: sem,
        exam_session: sess,
        result: res,
        grade: grade,
      });
    });
    return attempts;
  };

  window.examStuSave = async function (submit) {
    var attempts = window.examStuCollect();
    if (!attempts.length) {
      alert('Nothing to save for this semester (or all rows are verified/locked).');
      return;
    }
    try {
      var data = await api('/api/exam/attempts', {
        method: 'POST',
        body: { action: submit ? 'submit' : 'save', attempts: attempts },
      });
      if (data.errors && data.errors.length) {
        alert('Saved with notes:\n' + data.errors.join('\n'));
      } else {
        alert(submit
          ? '✅ Submitted for verification. HOD / Principal / Exam will review.'
          : '💾 Draft saved.');
      }
      window.examStuReload();
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  };

  window.examStuPaintList = function () {
    var list = document.getElementById('examStuList');
    if (!list) return;
    var attempts = (window._examStuState && window._examStuState.attempts) || [];
    var effective = (window._examStuState && window._examStuState.effective) || [];
    if (!attempts.length) {
      list.innerHTML = '<p style="opacity:.7;">No attempts entered yet.</p>';
      return;
    }
    var html = '<div style="margin-bottom:12px;"><strong>Effective status</strong> (pass if any verified pass attempt)</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:16px;"><thead><tr>' +
      '<th style="text-align:left;">Sem</th><th style="text-align:left;">Code</th><th style="text-align:left;">Subject</th>' +
      '<th>Effective</th><th>Grade</th><th>Latest session</th></tr></thead><tbody>';
    effective.forEach(function (e) {
      html += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:5px;">' + e.semester +
        '</td><td style="padding:5px;font-family:monospace;font-size:0.72rem;">' + esc(e.subject_code) +
        '</td><td style="padding:5px;">' + esc(e.subject_name) + '</td><td style="padding:5px;">' +
        (e.passed ? '<span class="badge active">Pass</span>' : '<span class="badge pending">' + esc(e.effective) + '</span>') +
        '</td><td style="padding:5px;">' + esc(e.grade) + '</td><td style="padding:5px;font-size:0.72rem;">' +
        esc(e.latest_session) + '</td></tr>';
    });
    html += '</tbody></table><div style="margin-bottom:8px;"><strong>All attempts</strong></div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
      '<th>Sem</th><th>Code</th><th>Session</th><th>Result</th><th>Grade</th><th>Status</th></tr></thead><tbody>';
    attempts.forEach(function (a) {
      html += '<tr style="border-bottom:1px solid var(--border);"><td style="padding:4px;">' + a.semester +
        '</td><td style="padding:4px;font-family:monospace;font-size:0.7rem;">' + esc(a.subject_code) +
        '</td><td style="padding:4px;">' + esc(a.exam_session) + '</td><td style="padding:4px;">' + esc(a.result) +
        '</td><td style="padding:4px;">' + esc(a.grade) + '</td><td style="padding:4px;">' + esc(a.status) +
        (a.reject_note ? ' · ' + esc(a.reject_note) : '') + '</td></tr>';
    });
    html += '</tbody></table>';
    list.innerHTML = html;
  };

  /* ---------- Provisional marks card ---------- */
  window.examPrintProvisional = function () {
    var state = window._examStuState || {};
    var st = state.student || {};
    var effective = state.effective || [];
    var w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
      alert('Allow pop-ups to print.');
      return;
    }
    var rows = effective.map(function (e) {
      return '<tr><td>' + e.semester + '</td><td>' + esc(e.subject_code) + '</td><td>' + esc(e.subject_name) +
        '</td><td>' + (e.passed ? 'Pass' : esc(e.effective)) + '</td><td>' + esc(e.grade) +
        '</td><td>' + esc(e.latest_session) + '</td></tr>';
    }).join('');
    w.document.write(
      '<!DOCTYPE html><html><head><title>Provisional Marks Card</title><style>' +
      'body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0f172a;}' +
      '.wm{position:fixed;inset:20% 10%;font-size:42px;color:rgba(185,28,28,.12);font-weight:900;' +
      'transform:rotate(-28deg);text-align:center;pointer-events:none;z-index:0;line-height:1.3;}' +
      '.content{position:relative;z-index:1;}' +
      'h1{font-size:1.2rem;margin:0 0 4px;color:#0f2d5c;}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px;}' +
      'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}' +
      'th{background:#e8f0fe;}' +
      '.disc{margin-top:18px;border:2px solid #b91c1c;background:#fef2f2;padding:12px;font-size:12px;}' +
      '@media print{.noprint{display:none;}}' +
      '</style></head><body>' +
      '<div class="wm">PROVISIONAL / REFERENCE ONLY<br>NOT FOR OFFICIAL VERIFICATION<br>NOT A VALID MARKS CARD</div>' +
      '<div class="content">' +
      '<h1>Government Polytechnic Hubli</h1>' +
      '<div style="font-size:13px;opacity:.85;">Provisional Marks Summary (student-entered, staff-verified where marked)</div>' +
      '<div style="margin-top:10px;font-size:13px;"><strong>' + esc(st.name || '') + '</strong><br>' +
      'Reg: ' + esc(st.reg_no || '') + ' · Branch: ' + esc(st.branch || '') +
      ' · Scheme: ' + esc(st.scheme || '') +
      (st.admission_academic_year ? ' · Admission: ' + esc(st.admission_academic_year) : '') +
      '</div>' +
      '<table><thead><tr><th>Sem</th><th>Code</th><th>Subject</th><th>Result</th><th>Grade</th><th>Session</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No data</td></tr>') +
      '</tbody></table>' +
      '<div class="disc"><strong>PROVISIONAL / REFERENCE ONLY</strong><br>' +
      'This is <strong>not</strong> an official marks card. It is generated from student-entered data ' +
      '(verified by college staff where applicable) for <strong>internal reference only</strong>. ' +
      '<strong>Not valid</strong> for university / employment / higher-education verification. ' +
      'For official documents, contact Exam Section / Board of Technical Examinations.</div>' +
      '<p class="noprint" style="margin-top:16px;"><button onclick="window.print()">Print</button></p>' +
      '</div></body></html>',
    );
    w.document.close();
  };

  /* ---------- Live Exam Fees + multi challan ---------- */
  var K2_CHALLAN_URL =
    'https://k2.karnataka.gov.in/wps/portal/Khajane-II/Scope/Remittance/ChallanGeneration/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTSycnQ39nQ38LVx8LA0C_f3DQn28PAwNQkz1w8EKDHAARwP9KGL041EQhd_4cP0ovFa4GBJQYGFEQIGBAVQBHlcU5IZGGGR6pgMA7DD6nQ!!/dz/d5/L2dBISEvZ0FBIS9nQSEh/';
  var K2_SAMPLE_PDF = '/docs/sample-k2-challan.pdf';

  function k2WarningCardHtml() {
    return (
      '<div class="card" style="padding:16px;margin-bottom:14px;border:1.5px solid #fdba74;background:#fff7ed;">' +
      '<h3 style="margin:0 0 10px;font-size:1rem;color:#9a3412;">Important — K2 challan must use these exact details</h3>' +
      '<p style="margin:0 0 10px;font-size:0.88rem;line-height:1.5;color:#7c2d12;">' +
      'If you select the wrong district / department / DDO, your fee will <strong>not</strong> reach the correct office. ' +
      'Check carefully before generating the challan.</p>' +
      '<ul style="margin:0 0 12px;padding-left:1.2rem;font-size:0.9rem;line-height:1.65;color:#0f172a;">' +
      '<li><strong>District:</strong> Bengaluru Urban</li>' +
      '<li><strong>Department:</strong> DEPARTMENT OF TECHNICAL EDUCATION</li>' +
      '<li><strong>DDO Office:</strong> DIRECTORATE OF TECHNICAL EDUCATION, BANGALORE</li>' +
      '<li><strong>DDO Code:</strong> <span style="font-family:ui-monospace,monospace;font-weight:800;letter-spacing:0.03em;">14254O</span></li>' +
      '</ul>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">' +
      '<a class="btn go" href="' +
      K2_CHALLAN_URL +
      '" target="_blank" rel="noopener noreferrer" ' +
      'style="padding:11px 16px;font-size:0.9rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
      'Open K2 Challan Generation</a>' +
      '<a class="btn ol" href="' +
      K2_SAMPLE_PDF +
      '" target="_blank" rel="noopener noreferrer" ' +
      'style="padding:11px 16px;font-size:0.9rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
      'View sample K2 challan (PDF)</a>' +
      '</div>' +
      '<p style="margin:12px 0 0;font-size:0.8rem;opacity:.8;line-height:1.45;">' +
      'After payment, copy the <strong>K2 receipt / challan number</strong> and amount into the form below and submit. ' +
      'Keep the paid challan PDF/print for your records.</p>' +
      '</div>'
    );
  }

  function ensureStuExamFeesPanel() {
    var panel = document.getElementById('stuExamFees');
    if (!panel) return;
    // v4 = Regular exam | Makeup exam | Admission
    if (panel.getAttribute('data-exam-live') === '4') return;
    panel.setAttribute('data-exam-live', '4');
    panel.innerHTML =
      /* Live Admission fee status — always visible when student opens Fees */
      '<div id="admFeeStatusBar" class="card" style="padding:14px 16px;margin-bottom:14px;border:2px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
      '<div style="font-size:0.72rem;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;opacity:.7;">Admission fees</div>' +
      '<div id="admFeeStatusPill" style="font-size:0.95rem;font-weight:800;padding:8px 14px;border-radius:999px;background:#f1f5f9;border:1.5px solid var(--border);">Loading…</div>' +
      '<div id="admFeeStatusYear" style="font-size:0.8rem;opacity:.8;"></div>' +
      '</div>' +
      '<div id="admFeeStatusStamp" style="font-size:0.78rem;max-width:100%;"></div>' +
      '</div>' +
      '<p id="admFeeStatusHint" style="margin:-6px 0 14px;font-size:0.78rem;opacity:.75;line-height:1.45;">' +
      'Admission paid/not paid is set by your verifier. Exam fees: use <strong>Regular</strong> or <strong>Makeup</strong> tabs (same K2, different amounts).</p>' +

      /* Tabs */
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<button type="button" class="btn pr" id="stuFeeTabExam" onclick="window.stuFeeShowTab&&window.stuFeeShowTab(\'exam\')">Regular exam fees</button>' +
      '<button type="button" class="btn ol" id="stuFeeTabMakeup" onclick="window.stuFeeShowTab&&window.stuFeeShowTab(\'makeup\')">Makeup fees</button>' +
      '<button type="button" class="btn ol" id="stuFeeTabAdm" onclick="window.stuFeeShowTab&&window.stuFeeShowTab(\'admission\')">Admission fees</button>' +
      '<span id="stuFeeMakeupBadge" style="display:none;font-size:0.72rem;font-weight:800;padding:6px 10px;border-radius:999px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;"></span>' +
      '</div>' +

      /* ---- Regular Exam fees pane ---- */
      '<div id="stuFeePaneExam">' +
      '<div class="info-box"><strong>Regular exam fees</strong> — Base fee from backlog / current semester. ' +
      '<strong>Fine</strong> is set by Exam Section date schedule (you cannot edit fine). ' +
      'Pay on official <strong>K2 (Khajane-II)</strong>, then enter receipt number(s) here. ' +
      'No online K2 payment API. Multiple challans allowed. Exam marks Paid after verifying.</div>' +

      '<div class="card" style="padding:16px;margin-bottom:14px;border:1.5px solid #fdba74;background:#fff7ed;">' +
      '<h3 style="margin:0 0 10px;font-size:1rem;color:#9a3412;">Important — K2 challan must use these exact details</h3>' +
      '<p style="margin:0 0 10px;font-size:0.88rem;line-height:1.5;color:#7c2d12;">' +
      'If you select the wrong district / department / DDO, your fee will <strong>not</strong> reach the correct office. ' +
      'Check carefully before generating the challan.</p>' +
      '<ul style="margin:0 0 12px;padding-left:1.2rem;font-size:0.9rem;line-height:1.65;color:#0f172a;">' +
      '<li><strong>District:</strong> Bengaluru Urban</li>' +
      '<li><strong>Department:</strong> DEPARTMENT OF TECHNICAL EDUCATION</li>' +
      '<li><strong>DDO Office:</strong> DIRECTORATE OF TECHNICAL EDUCATION, BANGALORE</li>' +
      '<li><strong>DDO Code:</strong> <span style="font-family:ui-monospace,monospace;font-weight:800;letter-spacing:0.03em;">14254O</span></li>' +
      '</ul>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">' +
      '<a class="btn go" href="' + K2_CHALLAN_URL + '" target="_blank" rel="noopener noreferrer" ' +
      'style="padding:11px 16px;font-size:0.9rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
      'Open K2 Challan Generation</a>' +
      '<a class="btn ol" href="' + K2_SAMPLE_PDF + '" target="_blank" rel="noopener noreferrer" ' +
      'style="padding:11px 16px;font-size:0.9rem;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
      'View sample K2 challan (PDF)</a>' +
      '</div>' +
      '<p style="margin:12px 0 0;font-size:0.8rem;opacity:.8;line-height:1.45;">' +
      'After payment, copy the <strong>K2 receipt / challan number</strong> and amount into the form below and submit. ' +
      'Keep the paid challan PDF/print for your records.</p>' +
      '</div>' +

      '<div class="card" style="padding:16px;margin-bottom:14px;">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">' +
      '<button type="button" class="btn ol" onclick="window.examFeesReload&&window.examFeesReload()">Recalculate</button>' +
      '<span id="examFeeFineBanner" style="font-size:0.82rem;padding:6px 10px;border-radius:8px;background:#f1f5f9;border:1px solid var(--border);"></span>' +
      '</div>' +
      '<div id="examFeeScheduleInfo" style="font-size:0.8rem;margin-bottom:8px;opacity:.9;"></div>' +
      '<div id="examFeeBreakup" style="font-size:0.85rem;"></div>' +
      '<div style="margin-top:10px;font-size:1.05rem;font-weight:800;color:var(--navy);">Total: <span id="examFeeTotal">Rs 0</span></div>' +
      '<div id="examFeePayStatus" style="margin-top:8px;font-size:0.82rem;"></div>' +
      '</div>' +
      '<div class="card" style="padding:16px;">' +
      '<h3 style="margin:0 0 10px;font-size:0.95rem;color:var(--navy);">K2 Challan receipts (multiple allowed)</h3>' +
      '<p style="margin:0 0 10px;font-size:0.82rem;opacity:.8;">Enter receipt no. from your paid K2 challan. Add another row if you paid in parts. Emojis are not allowed in text fields.</p>' +
      '<div id="examChallanList"></div>' +
      '<button type="button" class="btn ol" style="margin:8px 0;" onclick="window.examAddChallanRow&&window.examAddChallanRow()">+ Add another challan</button>' +
      '<div class="fg" style="margin-top:8px;"><label>Note to Exam Section (optional)</label>' +
      '<input id="examFeeNote" type="text" placeholder="e.g. Paid Rs 300 first, balance Rs 50 next day" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<button type="button" class="btn go" style="margin-top:12px;" onclick="window.examSubmitChallans&&window.examSubmitChallans()">Submit challan details</button>' +
      '</div>' +
      '</div>' +

      /* ---- Makeup exam fees pane ---- */
      '<div id="stuFeePaneMakeup" style="display:none;">' +
      '<div id="makeupFeeCycleBanner" class="info-box" style="margin-bottom:12px;">Loading makeup fee status…</div>' +
      k2WarningCardHtml() +
      '<div class="card" style="padding:16px;margin-bottom:14px;">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">' +
      '<button type="button" class="btn ol" onclick="window.makeupFeesReload&&window.makeupFeesReload()">Recalculate makeup fee</button>' +
      '<span id="makeupFeeFineBanner" style="font-size:0.82rem;padding:6px 10px;border-radius:8px;background:#f1f5f9;border:1px solid var(--border);"></span>' +
      '</div>' +
      '<div id="makeupFeeBreakup" style="font-size:0.85rem;"></div>' +
      '<div style="margin-top:10px;font-size:1.05rem;font-weight:800;color:var(--navy);">Makeup total: <span id="makeupFeeTotal">Rs 0</span></div>' +
      '<div id="makeupFeePayStatus" style="margin-top:8px;font-size:0.82rem;"></div>' +
      '</div>' +
      '<div class="card" style="padding:16px;">' +
      '<h3 style="margin:0 0 10px;font-size:0.95rem;color:var(--navy);">K2 Challan receipts (Makeup — multiple allowed)</h3>' +
      '<p style="margin:0 0 10px;font-size:0.82rem;opacity:.8;">Same K2 process as regular. Enter receipt no. and amount. Exam marks Paid separately for makeup.</p>' +
      '<div id="makeupChallanList"></div>' +
      '<button type="button" class="btn ol" style="margin:8px 0;" onclick="window.makeupAddChallanRow&&window.makeupAddChallanRow()">+ Add another challan</button>' +
      '<div class="fg" style="margin-top:8px;"><label>Note to Exam Section (optional)</label>' +
      '<input id="makeupFeeNote" type="text" placeholder="Makeup payment note" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<button type="button" class="btn go" style="margin-top:12px;" onclick="window.makeupSubmitChallans&&window.makeupSubmitChallans()">Submit makeup challan details</button>' +
      '</div>' +
      '</div>' +

      /* ---- Admission fees pane ---- */
      '<div id="stuFeePaneAdm" style="display:none;">' +
      '<div class="info-box"><strong>Admission / year tuition fees</strong> — Enter amount, receipt number and paid date after you pay. ' +
      'Your verifier (Cash / Office / HOD / ACM) confirms <strong>Paid</strong> or <strong>Not paid</strong>. ' +
      'The live status bar at the top updates as soon as they confirm.</div>' +
      '<div class="card" style="padding:16px;">' +
      '<h3 style="margin:0 0 12px;font-size:0.95rem;color:var(--navy);">Submit payment proof</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">' +
      '<div class="fg" style="margin:0;"><label>Fee amount (₹)</label>' +
      '<input id="admFeeAmount" type="text" placeholder="e.g. 12000" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div class="fg" style="margin:0;"><label>Receipt number</label>' +
      '<input id="admFeeReceipt" type="text" placeholder="Receipt / challan no." ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div class="fg" style="margin:0;"><label>Fees paid date</label>' +
      '<input id="admFeeDate" type="date" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '</div>' +
      '<div class="fg" style="margin-top:12px;"><label>Note to verifier (optional)</label>' +
      '<input id="admFeeNote" type="text" placeholder="Any note for Cash / Office" ' +
      'style="width:100%;padding:10px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<button type="button" class="btn go" style="margin-top:14px;" onclick="window.admFeeSubmit&&window.admFeeSubmit()">Submit for verification</button>' +
      '<div id="admFeeSubmitMsg" style="margin-top:10px;font-size:0.82rem;"></div>' +
      '<div id="admFeeRecordDetail" style="margin-top:14px;font-size:0.82rem;"></div>' +
      '</div>' +
      '</div>';

    window.examAddChallanRow();
    window.examAddChallanRow();
  }

  window.stuFeeShowTab = function (tab) {
    var exam = document.getElementById('stuFeePaneExam');
    var mk = document.getElementById('stuFeePaneMakeup');
    var adm = document.getElementById('stuFeePaneAdm');
    var bEx = document.getElementById('stuFeeTabExam');
    var bMk = document.getElementById('stuFeeTabMakeup');
    var bAd = document.getElementById('stuFeeTabAdm');
    if (exam) exam.style.display = tab === 'exam' ? '' : 'none';
    if (mk) mk.style.display = tab === 'makeup' ? '' : 'none';
    if (adm) adm.style.display = tab === 'admission' ? '' : 'none';
    if (bEx) bEx.className = tab === 'exam' ? 'btn pr' : 'btn ol';
    if (bMk) bMk.className = tab === 'makeup' ? 'btn pr' : 'btn ol';
    if (bAd) bAd.className = tab === 'admission' ? 'btn pr' : 'btn ol';
    if (tab === 'admission') window.admFeeReload && window.admFeeReload();
    if (tab === 'makeup') window.makeupFeesReload && window.makeupFeesReload();
    if (tab === 'exam') window.examFeesReload && window.examFeesReload();
  };

  window.makeupAddChallanRow = function () {
    var host = document.getElementById('makeupChallanList');
    if (!host) return;
    var n = host.querySelectorAll('.makeup-ch-row').length + 1;
    var div = document.createElement('div');
    div.className = 'makeup-ch-row';
    div.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;align-items:end;';
    div.innerHTML =
      '<div style="flex:1;min-width:160px;"><label style="font-size:0.72rem;">Challan ' +
      n +
      ' receipt no.</label>' +
      '<input class="makeup-ch-no" type="text" placeholder="K2 receipt number" ' +
      'style="width:100%;padding:9px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div style="width:120px;"><label style="font-size:0.72rem;">Amount ₹</label>' +
      '<input class="makeup-ch-amt" type="number" min="0" step="1" placeholder="0" ' +
      'style="width:100%;padding:9px;border-radius:8px;border:1.5px solid var(--border);" /></div>';
    host.appendChild(div);
  };

  window.makeupFeesReload = async function () {
    ensureStuExamFeesPanel();
    var host = document.getElementById('makeupChallanList');
    if (host && !host.querySelector('.makeup-ch-row')) {
      window.makeupAddChallanRow();
      window.makeupAddChallanRow();
    }
    var banner = document.getElementById('makeupFeeCycleBanner');
    var box = document.getElementById('makeupFeeBreakup');
    var tot = document.getElementById('makeupFeeTotal');
    var stEl = document.getElementById('makeupFeePayStatus');
    var fineB = document.getElementById('makeupFeeFineBanner');
    var badge = document.getElementById('stuFeeMakeupBadge');
    try {
      var data = await api('/api/exam/makeup/fees');
      var cycle = data.cycle;
      if (badge) {
        if (cycle && cycle.status === 'open') {
          badge.style.display = '';
          badge.textContent = 'Makeup open · ' + (cycle.month_label || '');
        } else badge.style.display = 'none';
      }
      if (banner) {
        if (!cycle) {
          banner.innerHTML =
            '<strong>No makeup declared.</strong> Exam Section opens makeup fees when they declare the month (e.g. July / August 2026).';
        } else if (cycle.status !== 'open') {
          banner.innerHTML =
            '<strong>Makeup cycle ' +
            esc(cycle.status) +
            ':</strong> ' +
            esc(cycle.month_label) +
            ' — payment entry closed.';
        } else {
          banner.innerHTML =
            '<strong>Makeup fees · ' +
            esc(cycle.month_label) +
            '</strong> — ₹' +
            (cycle.fee_per_subject || 0) +
            ' per failed subject' +
            (cycle.fee_base ? ' + base ₹' + cycle.fee_base : '') +
            '. Same K2 as regular; paid status is separate.';
        }
      }
      var lines = (data.fees && data.fees.lines) || [];
      var fineAmt = (data.fees && data.fees.fine) || 0;
      if (fineB) {
        if (fineAmt > 0) {
          fineB.style.background = '#fef2f2';
          fineB.innerHTML = '<strong>Makeup fine Rs ' + fineAmt + '</strong>';
        } else {
          fineB.style.background = '#ecfdf5';
          fineB.innerHTML = '<strong>No makeup fine</strong> (or not scheduled)';
        }
      }
      if (box) {
        if (!lines.length) {
          box.innerHTML =
            '<p style="opacity:.7;">No makeup fee lines — no open fails, or cycle not open.</p>';
        } else {
          box.innerHTML =
            '<table style="width:100%;border-collapse:collapse;"><tbody>' +
            lines
              .map(function (l) {
                return (
                  '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;">' +
                  esc(l.label) +
                  '</td><td style="padding:6px;text-align:right;font-weight:700;">Rs ' +
                  l.amount +
                  '</td></tr>'
                );
              })
              .join('') +
            '</tbody></table>';
        }
      }
      if (tot) tot.textContent = 'Rs ' + ((data.fees && data.fees.total) || 0);
      if (stEl) {
        var p = data.payment;
        if (!p) stEl.innerHTML = '<span class="badge pending">Not submitted</span>';
        else {
          var stampHtml = '';
          if (p.paid_marked_by_name && window.gpthStamp && p.stamp) {
            stampHtml = window.gpthStamp.html(p.stamp, 'paid');
          } else if (p.paid_marked_by_name) {
            stampHtml =
              '<div style="margin-top:6px;font-size:0.8rem;">Marked by <strong>' +
              esc(p.paid_marked_by_name) +
              '</strong></div>';
          }
          stEl.innerHTML =
            'Makeup status: <strong>' +
            esc(p.status) +
            '</strong>' +
            (p.challan_total != null ? ' · Challan total Rs ' + p.challan_total : '') +
            stampHtml;
        }
      }
    } catch (e) {
      if (banner) banner.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.makeupSubmitChallans = async function () {
    var rows = document.querySelectorAll('#makeupChallanList .makeup-ch-row');
    var challans = [];
    rows.forEach(function (row) {
      var no = ((row.querySelector('.makeup-ch-no') || {}).value || '').trim();
      var amt = Number((row.querySelector('.makeup-ch-amt') || {}).value || 0);
      if (no && amt > 0) challans.push({ receipt_no: no, amount: amt });
    });
    if (!challans.length) {
      alert('Enter at least one K2 receipt number and amount for makeup.');
      return;
    }
    var note = ((document.getElementById('makeupFeeNote') || {}).value || '').trim();
    try {
      var data = await api('/api/exam/makeup/fees', {
        method: 'POST',
        body: { challans: challans, note: note },
      });
      alert(data.message || 'Makeup challan submitted.');
      window.makeupFeesReload();
    } catch (e) {
      alert(e.message || 'Submit failed');
    }
  };

  function paintAdmFeeStatusBar(data) {
    var pill = document.getElementById('admFeeStatusPill');
    var yr = document.getElementById('admFeeStatusYear');
    var stampEl = document.getElementById('admFeeStatusStamp');
    var bar = document.getElementById('admFeeStatusBar');
    var detail = document.getElementById('admFeeRecordDetail');
    if (!pill) return;
    var st = (data && data.live && data.live.status) || (data && data.status) || 'not_paid';
    var label = (data && data.live && data.live.label) || 'Not paid';
    var yLabel = (data && data.year_label) || '';
    if (yr) yr.textContent = yLabel ? 'For ' + yLabel : '';
    pill.textContent = label;
    if (st === 'paid') {
      pill.style.background = '#dcfce7';
      pill.style.borderColor = '#86efac';
      pill.style.color = '#166534';
      if (bar) {
        bar.style.borderColor = '#86efac';
        bar.style.background = '#f0fdf4';
      }
    } else if (st === 'pending') {
      pill.style.background = '#fef3c7';
      pill.style.borderColor = '#fcd34d';
      pill.style.color = '#92400e';
      if (bar) {
        bar.style.borderColor = '#fcd34d';
        bar.style.background = '#fffbeb';
      }
    } else {
      pill.style.background = '#fee2e2';
      pill.style.borderColor = '#fca5a5';
      pill.style.color = '#991b1b';
      if (bar) {
        bar.style.borderColor = '#fca5a5';
        bar.style.background = '#fef2f2';
      }
    }
    var rec = data && data.record;
    if (stampEl) {
      stampEl.innerHTML = '';
      if (rec && rec.verified_by_name) {
        if (window.gpthStamp && rec.stamp) {
          stampEl.innerHTML = window.gpthStamp.html(rec.stamp, st === 'paid' ? 'paid' : 'verified');
        } else {
          stampEl.innerHTML =
            '<span style="opacity:.85;">Confirmed by <strong>' +
            esc(rec.verified_by_name) +
            '</strong>' +
            (rec.verified_by_role ? ' (' + esc(rec.verified_by_role) + ')' : '') +
            '</span>';
        }
      } else if (st === 'pending') {
        stampEl.innerHTML = '<span style="opacity:.8;">Waiting for verifier confirmation</span>';
      } else {
        stampEl.innerHTML = '<span style="opacity:.7;">Not confirmed yet</span>';
      }
    }
    if (detail) {
      if (!rec) {
        detail.innerHTML = '<span style="opacity:.7;">No proof submitted for this year yet.</span>';
      } else {
        detail.innerHTML =
          '<div class="card" style="padding:12px;background:var(--bg);border:1px solid var(--border);">' +
          '<div><strong>Submitted proof</strong></div>' +
          '<div style="margin-top:6px;">Amount: <strong>₹ ' +
          esc(rec.amount || '—') +
          '</strong> · Receipt: <strong>' +
          esc(rec.receipt_no || '—') +
          '</strong>' +
          (rec.paid_date ? ' · Date: ' + esc(rec.paid_date) : '') +
          '</div>' +
          (rec.student_note
            ? '<div style="margin-top:4px;opacity:.8;">Note: ' + esc(rec.student_note) + '</div>'
            : '') +
          (rec.staff_note
            ? '<div style="margin-top:4px;opacity:.8;">Verifier note: ' + esc(rec.staff_note) + '</div>'
            : '') +
          '</div>';
      }
      // Prefill form from last submit
      if (rec) {
        var a = document.getElementById('admFeeAmount');
        var r = document.getElementById('admFeeReceipt');
        var d = document.getElementById('admFeeDate');
        if (a && rec.amount) a.value = rec.amount;
        if (r && rec.receipt_no) r.value = rec.receipt_no;
        if (d && rec.paid_date) d.value = String(rec.paid_date).slice(0, 10);
      }
    }
  }

  window.admFeeReload = async function () {
    ensureStuExamFeesPanel();
    try {
      var data = await api('/api/admission-fees');
      paintAdmFeeStatusBar(data);
    } catch (e) {
      var pill = document.getElementById('admFeeStatusPill');
      if (pill) {
        pill.textContent = 'Status unavailable';
        pill.style.background = '#f1f5f9';
      }
    }
  };

  window.admFeeSubmit = async function () {
    var amount = ((document.getElementById('admFeeAmount') || {}).value || '').trim();
    var receipt = ((document.getElementById('admFeeReceipt') || {}).value || '').trim();
    var paidDate = ((document.getElementById('admFeeDate') || {}).value || '').trim();
    var note = ((document.getElementById('admFeeNote') || {}).value || '').trim();
    var msg = document.getElementById('admFeeSubmitMsg');
    if (!amount || !receipt) {
      alert('Enter fee amount and receipt number.');
      return;
    }
    try {
      var res = await api('/api/admission-fees', {
        method: 'POST',
        body: { amount: amount, receipt_no: receipt, paid_date: paidDate || null, note: note || null },
      });
      if (msg) {
        msg.style.color = '#166534';
        msg.textContent = res.message || 'Submitted for verification.';
      }
      await window.admFeeReload();
    } catch (e) {
      if (msg) {
        msg.style.color = '#991b1b';
        msg.textContent = e.message || 'Submit failed';
      }
      alert(e.message || 'Submit failed');
    }
  };

  window.examAddChallanRow = function () {
    var host = document.getElementById('examChallanList');
    if (!host) return;
    var n = host.querySelectorAll('.exam-ch-row').length + 1;
    var div = document.createElement('div');
    div.className = 'exam-ch-row';
    div.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;align-items:end;';
    div.innerHTML =
      '<div style="flex:1;min-width:160px;"><label style="font-size:0.72rem;">Challan ' + n + ' receipt no.</label>' +
      '<input class="exam-ch-no" type="text" placeholder="K2 receipt number" ' +
      'style="width:100%;padding:9px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div style="width:120px;"><label style="font-size:0.72rem;">Amount ₹</label>' +
      '<input class="exam-ch-amt" type="number" min="0" step="1" placeholder="0" ' +
      'style="width:100%;padding:9px;border-radius:8px;border:1.5px solid var(--border);" /></div>';
    host.appendChild(div);
  };

  window.examFeesReload = async function () {
    ensureStuExamFeesPanel();
    var box = document.getElementById('examFeeBreakup');
    var tot = document.getElementById('examFeeTotal');
    var stEl = document.getElementById('examFeePayStatus');
    var banner = document.getElementById('examFeeFineBanner');
    var schedInfo = document.getElementById('examFeeScheduleInfo');
    try {
      var data = await api('/api/exam/fees');
      var lines = (data.fees && data.fees.lines) || [];
      var fineAmt = (data.fees && data.fees.fine) || 0;
      var resolved = data.fine_schedule && data.fine_schedule.resolved;
      if (banner) {
        if (fineAmt > 0) {
          banner.style.background = '#fef2f2';
          banner.style.borderColor = '#fecaca';
          banner.innerHTML =
            '<strong>Fine Rs ' + fineAmt + '</strong>' +
            (resolved && resolved.label ? ' — ' + esc(resolved.label) : '');
        } else {
          banner.style.background = '#ecfdf5';
          banner.style.borderColor = '#a7f3d0';
          banner.innerHTML =
            '<strong>No fine</strong>' +
            (resolved && resolved.label ? ' — ' + esc(resolved.label) : ' (Exam schedule)');
        }
      }
      if (schedInfo) {
        var tiers = (data.fine_schedule && data.fine_schedule.tiers) || [];
        if (!tiers.length) {
          schedInfo.textContent = 'Exam Section has not published a fine date schedule yet.';
        } else {
          schedInfo.innerHTML =
            'Fine windows (Exam schedule): ' +
            tiers
              .map(function (t) {
                return (
                  esc(String(t.from_date).slice(0, 10)) +
                  ' to ' +
                  esc(String(t.to_date).slice(0, 10)) +
                  ' = Rs ' +
                  (t.fine_amount || 0)
                );
              })
              .join(' · ');
        }
      }
      if (box) {
        if (!lines.length) {
          box.innerHTML = '<p style="opacity:.7;">No fee lines — enter results first (or all passed).</p>';
        } else {
          box.innerHTML =
            '<table style="width:100%;border-collapse:collapse;"><tbody>' +
            lines.map(function (l) {
              var isFine = l.kind === 'fine';
              return (
                '<tr style="border-bottom:1px solid var(--border);' +
                (isFine ? 'background:#fff7ed;' : '') +
                '"><td style="padding:6px;">' +
                esc(l.label) +
                '</td><td style="padding:6px;text-align:right;font-weight:700;">Rs ' +
                l.amount +
                '</td></tr>'
              );
            }).join('') +
            '</tbody></table>';
        }
      }
      if (tot) tot.textContent = 'Rs ' + ((data.fees && data.fees.total) || 0);
      if (stEl) {
        var p = data.payment;
        if (!p) stEl.innerHTML = '<span class="badge pending">Not submitted</span>';
        else {
          var stampHtml = '';
          if (p.paid_marked_by_name && window.gpthStamp) {
            stampHtml = window.gpthStamp.html(
              {
                action: p.status === 'paid' || p.status === 'partial' ? 'paid' : 'updated',
                by_name: p.paid_marked_by_name,
                by_role: p.paid_marked_by_role || '',
                at: p.paid_marked_at,
              },
              'paid',
            );
          } else if (p.paid_marked_by_name) {
            stampHtml =
              '<div style="margin-top:6px;font-size:0.8rem;">Marked by <strong>' +
              esc(p.paid_marked_by_name) +
              '</strong></div>';
          }
          stEl.innerHTML =
            'Status: <strong>' + esc(p.status) + '</strong>' +
            (p.challan_total != null ? ' · Challan total Rs ' + p.challan_total : '') +
            stampHtml +
            (p.challans && p.challans.length
              ? '<div style="margin-top:6px;font-size:0.75rem;">' +
                p.challans.map(function (c) {
                  return esc(c.receipt_no) + ' — Rs ' + c.amount;
                }).join('<br>') +
                '</div>'
              : '');
        }
      }
    } catch (e) {
      if (box) box.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.examSubmitChallans = async function () {
    var rows = document.querySelectorAll('#examChallanList .exam-ch-row');
    var challans = [];
    rows.forEach(function (row) {
      var no = ((row.querySelector('.exam-ch-no') || {}).value || '').trim();
      var amt = Number((row.querySelector('.exam-ch-amt') || {}).value || 0);
      if (no && amt > 0) challans.push({ receipt_no: no, amount: amt });
    });
    if (!challans.length) {
      alert('Enter at least one K2 receipt number and amount. Use + Add another if you paid twice (e.g. Rs 300 + Rs 50).');
      return;
    }
    var note = ((document.getElementById('examFeeNote') || {}).value || '').trim();
    try {
      var data = await api('/api/exam/fees', {
        method: 'POST',
        body: { challans: challans, note: note },
      });
      alert(data.message || 'Challan details submitted. Exam Section will verify manually.');
      window.examFeesReload();
    } catch (e) {
      alert('Submit failed: ' + e.message);
    }
  };

  /* ---------- Staff: verify results + fee desk + fee schedule ---------- */
  function stripExamPathwaysUi(root, prefix) {
    if (!root) return;
    var p = document.getElementById(prefix + 'Pathways');
    if (p && p.parentNode) p.parentNode.removeChild(p);
    root.querySelectorAll('[data-exam-tab="' + prefix + 'Pathways"]').forEach(function (btn) {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    });
    // Also strip bare "Pathways" buttons left by older deploys
    root.querySelectorAll('button').forEach(function (btn) {
      var t = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (/pathways/i.test(t) && btn.getAttribute('data-exam-tab') === prefix + 'Pathways') {
        if (btn.parentNode) btn.parentNode.removeChild(btn);
      }
    });
  }

  /**
   * Admission fees desk — ACM Module (primary), Cash, Student Management.
   * Not on Exam Module (Exam handles regular + makeup exam fees only).
   */
  function ensureStandaloneAdmFeeDesk() {
    ;[
      { root: 'adACM', prefix: 'acmAf' },
      { root: 'facACM', prefix: 'facAcmAf' },
      { root: 'facCash', prefix: 'cashAf' },
      { root: 'adOpsCategory', prefix: 'adAf' },
      { root: 'facOpsCategory', prefix: 'facAf' },
    ].forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root) return;
      if (document.getElementById(cfg.prefix + 'AdmFeeDesk')) return;
      var wrap = document.createElement('div');
      wrap.id = cfg.prefix + 'AdmFeeDesk';
      wrap.style.cssText = 'margin:12px 0;';
      wrap.innerHTML =
        '<div class="card" style="padding:14px;border:1.5px solid #93c5fd;background:#eff6ff;">' +
        '<h3 style="margin:0 0 8px;font-size:0.95rem;color:var(--navy);">Admission fees desk (ACM)</h3>' +
        '<p style="margin:0 0 10px;font-size:0.8rem;opacity:.85;line-height:1.45;">Students submit proof under <strong>Fees → Admission fees</strong>. ' +
        'ACM / Cash confirm <strong>Paid</strong> or <strong>Not paid</strong> — live on student Fees status bar (your stamp).</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<select id="' +
        cfg.prefix +
        'AfStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
        '<option value="pending">Pending only</option><option value="">All</option>' +
        '<option value="paid">Paid</option><option value="not_paid">Not paid</option></select>' +
        '<button type="button" class="btn ol" onclick="window.admFeeStaffLoad&&window.admFeeStaffLoad(\'' +
        cfg.prefix +
        '\')">Load queue</button></div>' +
        '<div id="' +
        cfg.prefix +
        'AfList" style="overflow-x:auto;"></div></div>';
      // ACM module: put desk near top of ACM content
      root.insertBefore(wrap, root.firstChild);
    });
  }

  /** Remove Admission fees desk from Exam Module shells (belongs to ACM). */
  function stripExamAdmissionFeeDesk(root, prefix) {
    if (!root) return;
    var btn = root.querySelector('[data-exam-tab="' + prefix + 'AdmFeeDesk"]');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    var panel = document.getElementById(prefix + 'AdmFeeDesk');
    // Only remove if it is inside the exam root (not ACM)
    if (panel && root.contains(panel) && panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
  }

  function renameExamStaffTabLabels(root, prefix) {
    if (!root) return;
    var map = {};
    map[prefix + 'ResultsVerify'] = 'Regular exam results';
    map[prefix + 'FeeDesk'] = 'Regular fees desk';
    map[prefix + 'FeeSchedule'] = 'Regular fee schedule';
    map[prefix + 'RegularCycle'] = 'Regular exam declare';
    map[prefix + 'MakeupCycle'] = 'Makeup declare';
    map[prefix + 'MakeupVerify'] = 'Makeup results';
    map[prefix + 'MakeupFeeDesk'] = 'Makeup fees desk';
    map[prefix + 'MakeupFeeSched'] = 'Makeup fee schedule';
    Object.keys(map).forEach(function (tabId) {
      var b = root.querySelector('[data-exam-tab="' + tabId + '"]');
      if (b) b.textContent = map[tabId];
    });
  }

  /** Move a panel node into host if it exists elsewhere. */
  function adoptPanel(host, panelId) {
    if (!host) return null;
    var el = document.getElementById(panelId);
    if (el && el.parentNode !== host) host.appendChild(el);
    return el || document.getElementById(panelId);
  }

  /** Exam Module keeps PDC/lookup only — strip fee/result staff chrome. */
  function stripStaffChromeFromExamModule(root, prefix) {
    if (!root) return;
    root.querySelectorAll('.exam-staff-tabs').forEach(function (bar) {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
    // Move staff panels out of Exam Module so they can live on Exam Fee / Result Verification
    ;[
      'ResultsVerify',
      'RegularCycle',
      'FeeDesk',
      'FeeSchedule',
      'MakeupCycle',
      'MakeupVerify',
      'MakeupFeeDesk',
      'MakeupFeeSched',
      'ResultAnalysis',
      'AdmFeeDesk',
    ].forEach(function (suf) {
      var el = document.getElementById(prefix + suf);
      if (el && root.contains(el)) {
        // detach; re-home later
        el.parentNode.removeChild(el);
      }
    });
    stripExamPathwaysUi(root, prefix);
    stripExamAdmissionFeeDesk(root, prefix);
  }

  function ensureExamStaffPanels() {
    ensureStandaloneAdmFeeDesk();
    try {
      if (typeof window.ensureExamAdminDesk === 'function') window.ensureExamAdminDesk();
    } catch (eEns) { /* ignore */ }

    // Clean original Exam Module shells
    stripStaffChromeFromExamModule(document.getElementById('adExam'), 'adEx');
    stripStaffChromeFromExamModule(document.getElementById('facExamModule'), 'facEx');

    /**
     * Three shells:
     *  - adExamFee / facExamFee: fee verification (+ declare/schedule tools)
     *  - adResultVerify / facResultVerify: result verification + analysis
     *  - Exam Module: left clean (PDC etc.)
     */
    var shells = [
      {
        root: 'adExamFee',
        prefix: 'adEx',
        kind: 'fee',
        barHtml:
          '<button type="button" class="btn go" data-exam-tab="adExFeeDesk">Regular exam fee verification</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExMakeupFeeDesk">Makeup exam fee verification</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExFeeSchedule">Regular fee schedule</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExMakeupFeeSched">Makeup fee schedule</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExRegularCycle">Regular exam declare</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExMakeupCycle">Makeup declare</button>',
      },
      {
        root: 'adResultVerify',
        prefix: 'adEx',
        kind: 'result',
        barHtml:
          '<button type="button" class="btn pr" data-exam-tab="adExResultsVerify">Regular exam results</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExMakeupVerify">Makeup results</button>' +
          '<button type="button" class="btn ol" data-exam-tab="adExResultAnalysis">Result Analysis</button>',
      },
      // HOD / faculty: keep result verification on facExamModule (no separate fee menu required)
      {
        root: 'facExamModule',
        prefix: 'facEx',
        kind: 'result',
        barHtml:
          '<button type="button" class="btn pr" data-exam-tab="facExResultsVerify">Regular exam results</button>' +
          '<button type="button" class="btn ol" data-exam-tab="facExMakeupVerify">Makeup results</button>' +
          '<button type="button" class="btn ol" data-exam-tab="facExResultAnalysis">Result Analysis</button>',
      },
    ];

    shells.forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root) return;
      var prefix = cfg.prefix;

      // Tab bar for this shell
      var bar = root.querySelector('.exam-staff-tabs[data-shell="' + cfg.root + '"]');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'exam-staff-tabs';
        bar.setAttribute('data-shell', cfg.root);
        bar.style.cssText =
          'display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border);margin-bottom:8px;';
        bar.innerHTML = cfg.barHtml;
        // After info-box if present
        var info = root.querySelector('.info-box');
        if (info && info.nextSibling) root.insertBefore(bar, info.nextSibling);
        else root.insertBefore(bar, root.firstChild);
      } else {
        // Refresh labels
        bar.innerHTML = cfg.barHtml;
      }

      // Ensure panels exist (create if missing, then adopt into this shell)
      if (cfg.kind === 'fee' || cfg.kind === 'both') {
        if (!document.getElementById(prefix + 'FeeDesk')) {
          var f = document.createElement('div');
          f.id = prefix + 'FeeDesk';
          f.style.display = 'none';
          f.innerHTML =
            '<div class="info-box"><strong>Regular exam fee verification</strong> — Students pay via K2 and submit challan numbers. ' +
            'Verify offline and mark <strong>Paid</strong> / <strong>Partial</strong> / <strong>Due</strong>. ' +
            'Fine from Regular fee schedule. Admission fees are under ACM Module.</div>' +
            '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<select id="' +
            prefix +
            'FdBranch" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
            '<option value="">All branches</option>' +
            '<option value="civil">Civil</option><option value="computer">CSE</option>' +
            '<option value="electron">ECE</option><option value="mech">ME</option></select>' +
            '<select id="' +
            prefix +
            'FdStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
            '<option value="">All</option><option value="challan_submitted">Challan submitted</option>' +
            '<option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option></select>' +
            '<button type="button" class="btn ol" data-exam-reload-fd="' +
            prefix +
            '">Load students</button></div>' +
            '<div id="' +
            prefix +
            'FdList" style="padding:10px;overflow-x:auto;"></div>';
          root.appendChild(f);
        } else adoptPanel(root, prefix + 'FeeDesk');

        if (!document.getElementById(prefix + 'FeeSchedule')) {
          var s = document.createElement('div');
          s.id = prefix + 'FeeSchedule';
          s.style.display = 'none';
          s.innerHTML =
            '<div class="info-box"><strong>Regular fee schedule</strong> — Fine date windows for regular exams only. Makeup has its own schedule.</div>' +
            '<div class="card" style="padding:14px;margin:10px;">' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px;">' +
            '<div><label style="font-size:0.72rem;font-weight:700;">Exam cycle</label><br>' +
            '<input id="' +
            prefix +
            'FsCycle" type="text" value="current" ' +
            'style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);width:140px;" /></div>' +
            '<button type="button" class="btn ol" onclick="window.examFeeScheduleLoad&&window.examFeeScheduleLoad(\'' +
            prefix +
            '\')">Load</button>' +
            '<button type="button" class="btn pr" onclick="window.examFeeScheduleSave&&window.examFeeScheduleSave(\'' +
            prefix +
            '\')">Save schedule</button></div>' +
            '<div id="' +
            prefix +
            'FsResolved" style="font-size:0.85rem;margin-bottom:10px;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid var(--border);"></div>' +
            '<div id="' +
            prefix +
            'FsRows"></div>' +
            '<button type="button" class="btn ol" style="margin-top:10px;" onclick="window.examFeeScheduleAddRow&&window.examFeeScheduleAddRow(\'' +
            prefix +
            '\')">+ Add date window</button></div>';
          root.appendChild(s);
        } else adoptPanel(root, prefix + 'FeeSchedule');
      }

      if (cfg.kind === 'result' || cfg.kind === 'both') {
        if (!document.getElementById(prefix + 'ResultsVerify')) {
          var v = document.createElement('div');
          v.id = prefix + 'ResultsVerify';
          v.style.display = 'none';
          v.innerHTML =
            '<div class="info-box"><strong>Regular exam results verification</strong> — Verify student self-entry after they upload. ' +
            'Default lists <strong>all statuses</strong> (imported rows are already verified). Use <em>Pending / draft</em> for new submissions only.</div>' +
            '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
            '<select id="' +
            prefix +
            'RvBranch" onchange="window.examStaffLoadVerify&&window.examStaffLoadVerify(\'' +
            prefix +
            '\',{kind:\'regular\'})" style="padding:10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.9rem;">' +
            '<option value="">All branches</option>' +
            '<option value="CE">Civil</option><option value="CSE">CSE</option>' +
            '<option value="ECE">ECE</option><option value="ME">ME</option></select>' +
            '<select id="' +
            prefix +
            'RvStatus" onchange="window.examStaffLoadVerify&&window.examStaffLoadVerify(\'' +
            prefix +
            '\',{kind:\'regular\'})" style="padding:10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.9rem;">' +
            '<option value="">All statuses</option>' +
            '<option value="pending">Pending / draft (need verify)</option>' +
            '<option value="verified">Verified only</option>' +
            '<option value="rejected">Rejected only</option></select>' +
            '<button type="button" class="btn ol" data-exam-reload-rv="' +
            prefix +
            '" data-exam-kind="regular" style="padding:10px 14px;">Reload students</button>' +
            '</div><div id="' +
            prefix +
            'RvList" style="padding:8px 10px 16px;"></div>';
          root.appendChild(v);
        } else {
          adoptPanel(root, prefix + 'ResultsVerify');
          // Upgrade filters if still old "Pending only" default
          var stOld = document.getElementById(prefix + 'RvStatus');
          if (stOld && stOld.getAttribute('data-gpth-upgraded') !== '1') {
            stOld.setAttribute('data-gpth-upgraded', '1');
            stOld.innerHTML =
              '<option value="">All statuses</option>' +
              '<option value="pending">Pending / draft (need verify)</option>' +
              '<option value="verified">Verified only</option>' +
              '<option value="rejected">Rejected only</option>';
            stOld.value = '';
            stOld.onchange = function () {
              window.examStaffLoadVerify && window.examStaffLoadVerify(prefix, { kind: 'regular' });
            };
          }
          var brOld = document.getElementById(prefix + 'RvBranch');
          if (brOld) {
            brOld.onchange = function () {
              window.examStaffLoadVerify && window.examStaffLoadVerify(prefix, { kind: 'regular' });
            };
          }
        }
      }

      // Always re-home panels for this shell kind
      if (cfg.kind === 'fee') {
        ;['FeeDesk', 'FeeSchedule', 'RegularCycle', 'MakeupCycle', 'MakeupFeeDesk', 'MakeupFeeSched'].forEach(
          function (suf) {
            adoptPanel(root, prefix + suf);
          },
        );
      }
      if (cfg.kind === 'result') {
        ;['ResultsVerify', 'MakeupVerify', 'ResultAnalysis'].forEach(function (suf) {
          adoptPanel(root, prefix + suf);
        });
      }

      stripExamAdmissionFeeDesk(root, prefix);

      // Fee shell: declare + makeup fee panels
      if (cfg.kind === 'fee') {
        if (!document.getElementById(prefix + 'RegularCycle')) {
          var regCycle = document.createElement('div');
          regCycle.id = prefix + 'RegularCycle';
          regCycle.style.display = 'none';
          regCycle.innerHTML =
            '<div class="info-box"><strong>Regular exam declare</strong> — Month/session for regular sitting (e.g. April / May 2026).</div>' +
            '<div class="card" style="padding:14px;margin:10px;">' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">' +
            '<div class="fg" style="margin:0;"><label>Month label</label>' +
            '<input id="' + prefix + 'RgMonth" type="text" placeholder="April / May 2026" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div class="fg" style="margin:0;"><label>Session name</label>' +
            '<input id="' + prefix + 'RgSession" type="text" placeholder="Regular Apr-May 2026" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div class="fg" style="margin:0;"><label>Exam cycle key</label>' +
            '<input id="' + prefix + 'RgCycleKey" type="text" value="current" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div></div>' +
            '<div class="fg" style="margin-top:10px;"><label>Note (optional)</label>' +
            '<input id="' + prefix + 'RgNote" type="text" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn pr" onclick="window.regularCycleCreate&&window.regularCycleCreate(\'' +
            prefix + "','draft')\">Save draft</button>" +
            '<button type="button" class="btn go" onclick="window.regularCycleCreate&&window.regularCycleCreate(\'' +
            prefix + "','open')\">Declare &amp; Open</button>" +
            '<button type="button" class="btn ol" onclick="window.regularCycleLoad&&window.regularCycleLoad(\'' +
            prefix + "')\">Refresh list</button></div>" +
            '<div id="' + prefix + 'RgCycleList" style="margin-top:14px;"></div></div>';
          root.appendChild(regCycle);
        } else adoptPanel(root, prefix + 'RegularCycle');

        if (!document.getElementById(prefix + 'MakeupCycle')) {
          var mkCycle = document.createElement('div');
          mkCycle.id = prefix + 'MakeupCycle';
          mkCycle.style.display = 'none';
          mkCycle.innerHTML =
            '<div class="info-box"><strong>Makeup declare</strong> — e.g. July / August 2026. Fee per failed subject separate from regular.</div>' +
            '<div class="card" style="padding:14px;margin:10px;">' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">' +
            '<div class="fg" style="margin:0;"><label>Month label</label>' +
            '<input id="' + prefix + 'MkMonth" type="text" placeholder="July / August 2026" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div class="fg" style="margin:0;"><label>Session name</label>' +
            '<input id="' + prefix + 'MkSession" type="text" placeholder="Makeup Jul-Aug 2026" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div class="fg" style="margin:0;"><label>Fee ₹ / failed subject</label>' +
            '<input id="' + prefix + 'MkFeeSub" type="number" value="250" min="0" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div class="fg" style="margin:0;"><label>Base fee ₹</label>' +
            '<input id="' + prefix + 'MkFeeBase" type="number" value="0" min="0" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div></div>' +
            '<div class="fg" style="margin-top:10px;"><label>Note</label>' +
            '<input id="' + prefix + 'MkNote" type="text" ' +
            'style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
            '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn pr" onclick="window.makeupCycleCreate&&window.makeupCycleCreate(\'' +
            prefix + "','draft')\">Save draft</button>" +
            '<button type="button" class="btn go" onclick="window.makeupCycleCreate&&window.makeupCycleCreate(\'' +
            prefix + "','open')\">Declare &amp; Open</button>" +
            '<button type="button" class="btn ol" onclick="window.makeupCycleLoad&&window.makeupCycleLoad(\'' +
            prefix + "')\">Refresh</button></div>" +
            '<div id="' + prefix + 'MkCycleList" style="margin-top:14px;"></div></div>';
          root.appendChild(mkCycle);
        } else adoptPanel(root, prefix + 'MakeupCycle');

        if (!document.getElementById(prefix + 'MakeupFeeDesk')) {
          var mkFd = document.createElement('div');
          mkFd.id = prefix + 'MakeupFeeDesk';
          mkFd.style.display = 'none';
          mkFd.innerHTML =
            '<div class="info-box"><strong>Makeup exam fee verification</strong> — Separate from regular. Same K2; mark Paid after offline verify.</div>' +
            '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<select id="' + prefix + 'MkFdStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
            '<option value="">All</option><option value="challan_submitted">Challan submitted</option>' +
            '<option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option></select>' +
            '<button type="button" class="btn ol" onclick="window.makeupStaffLoadFees&&window.makeupStaffLoadFees(\'' +
            prefix + "')\">Load students</button></div>" +
            '<div id="' + prefix + 'MkFdList" style="padding:10px;overflow-x:auto;"></div>';
          root.appendChild(mkFd);
        } else adoptPanel(root, prefix + 'MakeupFeeDesk');

        if (!document.getElementById(prefix + 'MakeupFeeSched')) {
          var mkFs = document.createElement('div');
          mkFs.id = prefix + 'MakeupFeeSched';
          mkFs.style.display = 'none';
          mkFs.innerHTML =
            '<div class="info-box"><strong>Makeup fee schedule</strong> — Fine windows for makeup only.</div>' +
            '<div class="card" style="padding:14px;margin:10px;">' +
            '<button type="button" class="btn ol" onclick="window.makeupFeeSchedLoad&&window.makeupFeeSchedLoad(\'' +
            prefix + "')\">Load</button> " +
            '<button type="button" class="btn pr" onclick="window.makeupFeeSchedSave&&window.makeupFeeSchedSave(\'' +
            prefix + "')\">Save</button> " +
            '<button type="button" class="btn ol" onclick="window.makeupFeeSchedAddRow&&window.makeupFeeSchedAddRow(\'' +
            prefix + "')\">+ Window</button>" +
            '<div id="' + prefix + 'MkFsInfo" style="margin:10px 0;font-size:0.85rem;"></div>' +
            '<div id="' + prefix + 'MkFsRows"></div></div>';
          root.appendChild(mkFs);
        } else adoptPanel(root, prefix + 'MakeupFeeSched');
      }

      // Result shell: makeup results verify
      if (cfg.kind === 'result') {
        if (!document.getElementById(prefix + 'MakeupVerify')) {
          var mkV = document.createElement('div');
          mkV.id = prefix + 'MakeupVerify';
          mkV.style.display = 'none';
          mkV.innerHTML =
            '<div class="info-box"><strong>Makeup results verification</strong> — Pending makeup attempts. HOD = branch; Exam = all.</div>' +
            '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<select id="' + prefix + 'MkVStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
            '<option value="pending">Pending</option><option value="">All</option>' +
            '<option value="verified">Verified</option><option value="rejected">Rejected</option></select>' +
            '<button type="button" class="btn ol" onclick="window.makeupStaffLoadVerify&&window.makeupStaffLoadVerify(\'' +
            prefix + "')\">Load</button></div>" +
            '<div id="' + prefix + 'MkVList" style="padding:10px;overflow-x:auto;"></div>';
          root.appendChild(mkV);
        } else adoptPanel(root, prefix + 'MakeupVerify');
      }

      // Wire tab clicks for this shell only
      var barWire = root.querySelector('.exam-staff-tabs[data-shell="' + cfg.root + '"]');
      if (barWire) {
        barWire.querySelectorAll('[data-exam-tab]').forEach(function (btn) {
          btn.onclick = function () {
            var id = btn.getAttribute('data-exam-tab') || '';
            barWire.querySelectorAll('[data-exam-tab]').forEach(function (b) {
              b.classList.remove('act');
            });
            btn.classList.add('act');
            // Hide all staff panels under this root
            root.querySelectorAll('[id^="' + prefix + '"]').forEach(function (p) {
              if (p.tagName === 'DIV' && p.id && p.id.indexOf(prefix) === 0) {
                // only known staff panels
                if (
                  /ResultsVerify|FeeDesk|FeeSchedule|RegularCycle|MakeupCycle|MakeupVerify|MakeupFeeDesk|MakeupFeeSched|ResultAnalysis/.test(
                    p.id,
                  )
                ) {
                  p.style.display = 'none';
                }
              }
            });
            var target = document.getElementById(id);
            if (target) {
              target.style.display = '';
              try {
                target.classList.remove('gpth-sec-enter');
                void target.offsetWidth;
                target.classList.add('gpth-sec-enter');
              } catch (eA) { /* ignore */ }
            }
            if (id.indexOf('ResultsVerify') >= 0)
              window.examStaffLoadVerify(prefix, { kind: 'regular' });
            else if (id.indexOf('RegularCycle') >= 0) window.regularCycleLoad(prefix);
            else if (id.indexOf('MakeupFeeDesk') >= 0) window.makeupStaffLoadFees(prefix);
            else if (id.indexOf('FeeDesk') >= 0) window.examStaffLoadFees(prefix);
            else if (id.indexOf('MakeupFeeSched') >= 0) window.makeupFeeSchedLoad(prefix);
            else if (id.indexOf('FeeSchedule') >= 0) window.examFeeScheduleLoad(prefix);
            else if (id.indexOf('MakeupCycle') >= 0) window.makeupCycleLoad(prefix);
            else if (id.indexOf('MakeupVerify') >= 0) window.makeupStaffLoadVerify(prefix);
            else if (id.indexOf('ResultAnalysis') >= 0 && window.resAnalysisLoad) {
              window.resAnalysisLoad(id);
            }
          };
        });
        // Auto-open first tab when shell is empty/hidden
        if (cfg.kind === 'result' && cfg.root === 'adResultVerify') {
          var firstBtn =
            barWire.querySelector('[data-exam-tab$="ResultsVerify"]') ||
            barWire.querySelector('[data-exam-tab]');
          var shown = root.querySelector('[id$="ResultsVerify"]');
          if (firstBtn && shown && (shown.style.display === 'none' || !shown.offsetParent)) {
            try {
              firstBtn.click();
            } catch (eClick) {
              window.examStaffLoadVerify(prefix, { kind: 'regular' });
            }
          } else if (shown && shown.style.display !== 'none') {
            window.examStaffLoadVerify(prefix, { kind: 'regular' });
          }
        }
        if (cfg.kind === 'fee' && cfg.root === 'adExamFee') {
          var feeBtn = barWire.querySelector('[data-exam-tab$="FeeDesk"]:not([data-exam-tab*="Makeup"])');
          // FeeDesk matches MakeupFeeDesk — pick Regular fee verification button text
          feeBtn =
            barWire.querySelector('[data-exam-tab="' + prefix + 'FeeDesk"]') || feeBtn;
          if (feeBtn) {
            var feePanel = document.getElementById(prefix + 'FeeDesk');
            if (feePanel && feePanel.style.display === 'none') {
              try {
                feeBtn.click();
              } catch (eF) {
                window.examStaffLoadFees && window.examStaffLoadFees(prefix);
              }
            }
          }
        }
      }
    });

    // HOD: Result verification + Pathway manager (per academic year) — keep for HOD only
    if (window.currentUser && window.currentUser.role === 'hod') {
      var facContent = document.querySelector('#dbFaculty .db-content');
      var facMenu = document.querySelector('#dbFaculty .sb-menu');
      if (facContent && facMenu && !document.getElementById('facExamResultsNav')) {
        var nav = document.createElement('div');
        nav.className = 'sl';
        nav.id = 'facExamResultsNav';
        nav.setAttribute('data-fac', 'examresults');
        nav.innerHTML = '<span class="sli">✅</span>Result verification';
        nav.onclick = function () {
          facContent.querySelectorAll(':scope > div[id]').forEach(function (p) {
            p.style.display = p.id === 'facExamResultsHod' ? '' : 'none';
          });
          facMenu.querySelectorAll('.sl').forEach(function (sl) { sl.classList.remove('act'); });
          nav.classList.add('act');
          var p = document.getElementById('facExamResultsHod');
          if (p) p.style.display = '';
          window.examStaffLoadVerify('hodEx');
        };
        facMenu.appendChild(nav);
        var panel = document.createElement('div');
        panel.id = 'facExamResultsHod';
        panel.style.display = 'none';
        panel.innerHTML =
          '<div class="info-box">✅ <strong>Result verification (per student)</strong> — Pick a student on the left, ' +
          'review their subjects by semester (name + reg shown), then verify or reject that student. ' +
          'When many students submit, you work one student at a time — not one huge flat list.</div>' +
          '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<select id="hodExRvStatus" style="padding:10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.9rem;">' +
          '<option value="pending">Pending only</option><option value="">All statuses</option>' +
          '<option value="verified">Verified</option><option value="rejected">Rejected</option></select>' +
          '<button type="button" class="btn ol" data-exam-reload-rv="hodEx" style="padding:10px 14px;">↻ Reload students</button>' +
          '</div><div id="hodExRvList" style="padding:8px 10px 16px;"></div>';
        facContent.appendChild(panel);
      }
      if (facContent && facMenu && !document.getElementById('facPathwayNav')) {
        var pnav = document.createElement('div');
        pnav.className = 'sl';
        pnav.id = 'facPathwayNav';
        pnav.setAttribute('data-fac', 'pathways');
        pnav.innerHTML = '<span class="sli">🛤️</span>Sem 5–6 Pathways';
        pnav.onclick = function () {
          facContent.querySelectorAll(':scope > div[id]').forEach(function (p) {
            p.style.display = p.id === 'facPathwayHod' ? '' : 'none';
          });
          facMenu.querySelectorAll('.sl').forEach(function (sl) { sl.classList.remove('act'); });
          pnav.classList.add('act');
          var pp = document.getElementById('facPathwayHod');
          if (pp) pp.style.display = '';
          window.examPathwayLoad && window.examPathwayLoad();
        };
        facMenu.appendChild(pnav);
        var pPanel = document.createElement('div');
        pPanel.id = 'facPathwayHod';
        pPanel.style.display = 'none';
        pPanel.innerHTML =
          '<div class="info-box">🛤️ <strong>Sem 5–6 pathways (per academic year)</strong> — ' +
          'Offer which specializations / tracks run <strong>this year</strong>, then assign each student. ' +
          'When the academic year changes, set pathways again for the new year. ' +
          'Students only see Sem 5–6 subjects for their assigned pathway.</div>' +
          '<div class="card" style="padding:14px;margin-bottom:12px;">' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">' +
          '<div><label style="font-size:0.75rem;font-weight:700;">Academic year</label><br>' +
          '<input id="hodPwYear" type="text" placeholder="2025-26" ' +
          'style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);width:110px;" /></div>' +
          '<button type="button" class="btn ol" onclick="window.examPathwayLoad&&window.examPathwayLoad()">↻ Load year</button>' +
          '<button type="button" class="btn pr" onclick="window.examPathwaySaveOfferings&&window.examPathwaySaveOfferings()">💾 Save offerings</button>' +
          '</div>' +
          '<div id="hodPwOfferings" style="margin-top:12px;"></div></div>' +
          '<div class="card" style="padding:14px;">' +
          '<div class="card-hd" style="padding:0 0 10px;"><h3 style="margin:0;">Assign students</h3></div>' +
          '<div id="hodPwStudents" style="overflow-x:auto;"></div>' +
          '<button type="button" class="btn go" style="margin-top:10px;" ' +
          'onclick="window.examPathwaySaveAssignments&&window.examPathwaySaveAssignments()">💾 Save assignments</button>' +
          '</div>';
        facContent.appendChild(pPanel);
      }
      // Strip broken Student Key List if an older deploy left it in the DOM
      ;['facStudentKeyNav', 'facStudentKeyHod', 'facSubjectKeyNav', 'facSubjectKeyHod'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    }

    // Pathways intentionally NOT injected on Exam Module (HOD-only via sidebar).
  }

  function examFeeScheduleAddRow(prefix, data) {
    data = data || {};
    var host = document.getElementById(prefix + 'FsRows');
    if (!host) return;
    var row = document.createElement('div');
    row.className = 'exam-fs-row';
    row.style.cssText =
      'display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:#fff;';
    row.innerHTML =
      '<div><label style="font-size:0.7rem;font-weight:700;">From date</label><br>' +
      '<input class="fs-from" type="date" value="' +
      esc(data.from_date || '') +
      '" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.7rem;font-weight:700;">To date</label><br>' +
      '<input class="fs-to" type="date" value="' +
      esc(data.to_date || '') +
      '" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.7rem;font-weight:700;">Fine amount (Rs)</label><br>' +
      '<input class="fs-amt" type="number" min="0" step="1" value="' +
      esc(data.fine_amount != null ? String(data.fine_amount) : '0') +
      '" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);width:110px;" /></div>' +
      '<div style="flex:1;min-width:140px;"><label style="font-size:0.7rem;font-weight:700;">Note (optional)</label><br>' +
      '<input class="fs-label" type="text" placeholder="e.g. without fine / first fine" value="' +
      esc(data.label || '') +
      '" style="width:100%;padding:8px;border-radius:8px;border:1.5px solid var(--border);" /></div>' +
      '<button type="button" class="btn ol" style="padding:8px 10px;" title="Remove row">Remove</button>';
    row.querySelector('button').onclick = function () {
      if (host.querySelectorAll('.exam-fs-row').length <= 1) {
        alert('Keep at least one date window.');
        return;
      }
      host.removeChild(row);
    };
    host.appendChild(row);
  }

  window.examFeeScheduleAddRow = function (prefix) {
    examFeeScheduleAddRow(prefix, { fine_amount: 0 });
  };

  window.examFeeScheduleLoad = async function (prefix) {
    var cycleEl = document.getElementById(prefix + 'FsCycle');
    var cycle = ((cycleEl && cycleEl.value) || 'current').trim() || 'current';
    var host = document.getElementById(prefix + 'FsRows');
    var resEl = document.getElementById(prefix + 'FsResolved');
    if (!host) return;
    try {
      var data = await api('/api/exam/fee-schedule?exam_cycle=' + encodeURIComponent(cycle));
      host.innerHTML = '';
      var tiers = data.tiers || [];
      if (!tiers.length) {
        // Seed example: without-fine + one fine window
        examFeeScheduleAddRow(prefix, { fine_amount: 0, label: 'Without fine' });
        examFeeScheduleAddRow(prefix, { fine_amount: 50, label: 'First fine window' });
      } else {
        tiers.forEach(function (t) {
          examFeeScheduleAddRow(prefix, {
            from_date: String(t.from_date || '').slice(0, 10),
            to_date: String(t.to_date || '').slice(0, 10),
            fine_amount: t.fine_amount,
            label: t.label || '',
          });
        });
      }
      if (resEl) {
        var r = data.resolved || {};
        resEl.innerHTML =
          '<strong>Today (' +
          esc(r.as_of || '') +
          '):</strong> Fine Rs ' +
          (r.fine != null ? r.fine : 0) +
          ' — ' +
          esc(r.label || '') +
          (tiers.length
            ? '<div style="margin-top:6px;opacity:.85;">' +
              tiers.length +
              ' window(s) saved for cycle <code>' +
              esc(cycle) +
              '</code>.</div>'
            : '<div style="margin-top:6px;color:#9a3412;">No schedule saved yet — fill dates and Save.</div>');
      }
    } catch (e) {
      if (resEl) resEl.innerHTML = '<span style="color:#991b1b;">' + esc(e.message) + '</span>';
    }
  };

  window.examFeeScheduleSave = async function (prefix) {
    var cycleEl = document.getElementById(prefix + 'FsCycle');
    var cycle = ((cycleEl && cycleEl.value) || 'current').trim() || 'current';
    var host = document.getElementById(prefix + 'FsRows');
    if (!host) return;
    var tiers = [];
    host.querySelectorAll('.exam-fs-row').forEach(function (row) {
      var from = ((row.querySelector('.fs-from') || {}).value || '').trim();
      var to = ((row.querySelector('.fs-to') || {}).value || '').trim();
      var amt = Number((row.querySelector('.fs-amt') || {}).value || 0) || 0;
      var label = ((row.querySelector('.fs-label') || {}).value || '').trim();
      if (from && to) {
        tiers.push({ from_date: from, to_date: to, fine_amount: amt, label: label || null });
      }
    });
    if (!tiers.length) {
      alert('Add at least one date window with From and To dates.');
      return;
    }
    try {
      var data = await api('/api/exam/fee-schedule', {
        method: 'PUT',
        body: { exam_cycle: cycle, tiers: tiers },
      });
      alert(data.message || 'Schedule saved.');
      window.examFeeScheduleLoad(prefix);
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  };

  function currentAyGuess() {
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var start = m >= 6 ? y : y - 1;
    return start + '-' + String((start + 1) % 100).padStart(2, '0');
  }

  function paintOfferings(hostId, offerings) {
    var host = document.getElementById(hostId);
    if (!host) return;
    if (!offerings || !offerings.length) {
      host.innerHTML = '<p style="opacity:.7;">No pathway templates.</p>';
      return;
    }
    var html =
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>' +
      '<th>Offered this year?</th><th>Track</th><th>Label (editable)</th><th>Sem 5 codes</th><th>Sem 6 codes</th></tr></thead><tbody>';
    offerings.forEach(function (o) {
      html +=
        '<tr class="pw-off-row" data-key="' +
        esc(o.pathway_key) +
        '" style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:6px;text-align:center;"><input type="checkbox" class="pw-offered" ' +
        (o.is_offered ? 'checked' : '') +
        ' /></td>' +
        '<td style="padding:6px;font-size:0.72rem;">' +
        esc(o.track) +
        '</td>' +
        '<td style="padding:6px;"><input class="pw-label" type="text" value="' +
        esc(o.label) +
        '" style="width:100%;min-width:180px;padding:6px;border-radius:6px;border:1px solid var(--border);" /></td>' +
        '<td style="padding:6px;font-family:monospace;font-size:0.7rem;">' +
        esc((o.sem5_codes || []).join(', ')) +
        '</td>' +
        '<td style="padding:6px;font-family:monospace;font-size:0.7rem;">' +
        esc((o.sem6_codes || []).join(', ')) +
        '</td></tr>';
    });
    html += '</tbody></table>';
    host.innerHTML = html;
  }

  function paintAssignments(hostId, students, offerings) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var offered = (offerings || []).filter(function (o) {
      return o.is_offered;
    });
    if (!students || !students.length) {
      host.innerHTML = '<p style="opacity:.7;">No students in this branch.</p>';
      return;
    }
    var opts =
      '<option value="">— Not assigned —</option>' +
      offered
        .map(function (o) {
          return (
            '<option value="' +
            esc(o.pathway_key) +
            '">' +
            esc(o.label) +
            ' (' +
            esc(o.track) +
            ')</option>'
          );
        })
        .join('');
    var html =
      '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
      '<th>Reg</th><th>Name</th><th>Year</th><th>Pathway for this AY</th></tr></thead><tbody>';
    students.forEach(function (s) {
      var cur = s.assignment ? s.assignment.pathway_key : '';
      html +=
        '<tr class="pw-stu-row" data-reg="' +
        esc(s.reg_no) +
        '" style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:6px;font-family:monospace;font-size:0.72rem;">' +
        esc(s.reg_no) +
        '</td>' +
        '<td style="padding:6px;">' +
        esc(s.name) +
        '</td>' +
        '<td style="padding:6px;">' +
        (s.year != null ? s.year : '—') +
        '</td>' +
        '<td style="padding:6px;"><select class="pw-assign" style="min-width:220px;padding:6px;border-radius:6px;border:1px solid var(--border);">' +
        opts.replace(
          'value="' + esc(cur) + '"',
          'value="' + esc(cur) + '" selected',
        ) +
        '</select></td></tr>';
    });
    html += '</tbody></table>';
    // Fix selected options properly
    host.innerHTML = html;
    host.querySelectorAll('.pw-stu-row').forEach(function (tr, i) {
      var s = students[i];
      var sel = tr.querySelector('.pw-assign');
      if (sel && s.assignment) sel.value = s.assignment.pathway_key;
    });
  }

  window.examPathwayLoad = async function () {
    var yearEl = document.getElementById('hodPwYear');
    if (yearEl && !yearEl.value) yearEl.value = currentAyGuess();
    var ay = (yearEl && yearEl.value) || currentAyGuess();
    try {
      var off = await api('/api/exam/pathways?academic_year=' + encodeURIComponent(ay));
      window._hodPwBranch = off.branch_code;
      window._hodPwYear = off.academic_year;
      paintOfferings('hodPwOfferings', off.offerings || []);
      var asg = await api(
        '/api/exam/pathways?mode=assignments&academic_year=' + encodeURIComponent(ay),
      );
      paintAssignments('hodPwStudents', asg.students || [], asg.all_offerings || asg.offerings || []);
    } catch (e) {
      alert(e.message);
    }
  };

  window.examPathwaySaveOfferings = async function () {
    var ay = ((document.getElementById('hodPwYear') || {}).value || currentAyGuess()).trim();
    var rows = document.querySelectorAll('#hodPwOfferings .pw-off-row');
    var offerings = [];
    rows.forEach(function (tr) {
      offerings.push({
        pathway_key: tr.getAttribute('data-key'),
        is_offered: !!(tr.querySelector('.pw-offered') || {}).checked,
        label: ((tr.querySelector('.pw-label') || {}).value || '').trim(),
      });
    });
    try {
      await api('/api/exam/pathways', {
        method: 'PATCH',
        body: { academic_year: ay, offerings: offerings },
      });
      alert('Offerings saved for ' + ay);
      window.examPathwayLoad();
    } catch (e) {
      alert(e.message);
    }
  };

  window.examPathwaySaveAssignments = async function () {
    var ay = ((document.getElementById('hodPwYear') || {}).value || currentAyGuess()).trim();
    var rows = document.querySelectorAll('#hodPwStudents .pw-stu-row');
    var assignments = [];
    rows.forEach(function (tr) {
      var reg = tr.getAttribute('data-reg');
      var key = ((tr.querySelector('.pw-assign') || {}).value || '').trim();
      if (reg && key) assignments.push({ reg_no: reg, pathway_key: key });
    });
    if (!assignments.length) {
      alert('Select at least one student pathway.');
      return;
    }
    try {
      var data = await api('/api/exam/pathways', {
        method: 'POST',
        body: { action: 'assign_bulk', academic_year: ay, assignments: assignments },
      });
      alert('Assigned ' + (data.updated || 0) + ' student(s) for ' + ay);
      window.examPathwayLoad();
    } catch (e) {
      alert(e.message);
    }
  };

  window.examPathwayLoadStaff = async function (prefix) {
    var yearEl = document.getElementById(prefix + 'PwYear');
    var brEl = document.getElementById(prefix + 'PwBranch');
    if (yearEl && !yearEl.value) yearEl.value = currentAyGuess();
    var ay = (yearEl && yearEl.value) || currentAyGuess();
    var br = (brEl && brEl.value) || 'CSE';
    try {
      var off = await api(
        '/api/exam/pathways?academic_year=' +
          encodeURIComponent(ay) +
          '&branch=' +
          encodeURIComponent(br),
      );
      paintOfferings(prefix + 'PwOfferings', off.offerings || []);
      var asg = await api(
        '/api/exam/pathways?mode=assignments&academic_year=' +
          encodeURIComponent(ay) +
          '&branch=' +
          encodeURIComponent(br),
      );
      paintAssignments(prefix + 'PwStudents', asg.students || [], asg.all_offerings || asg.offerings || []);
    } catch (e) {
      alert(e.message);
    }
  };

  window.examPathwaySaveOfferingsStaff = async function (prefix) {
    var ay = ((document.getElementById(prefix + 'PwYear') || {}).value || currentAyGuess()).trim();
    var br = ((document.getElementById(prefix + 'PwBranch') || {}).value || 'CSE').trim();
    var rows = document.querySelectorAll('#' + prefix + 'PwOfferings .pw-off-row');
    var offerings = [];
    rows.forEach(function (tr) {
      offerings.push({
        pathway_key: tr.getAttribute('data-key'),
        is_offered: !!(tr.querySelector('.pw-offered') || {}).checked,
        label: ((tr.querySelector('.pw-label') || {}).value || '').trim(),
      });
    });
    try {
      await api('/api/exam/pathways', {
        method: 'PATCH',
        body: { academic_year: ay, branch: br, offerings: offerings },
      });
      alert('Offerings saved');
      window.examPathwayLoadStaff(prefix);
    } catch (e) {
      alert(e.message);
    }
  };

  window.examPathwaySaveAssignmentsStaff = async function (prefix) {
    var ay = ((document.getElementById(prefix + 'PwYear') || {}).value || currentAyGuess()).trim();
    var br = ((document.getElementById(prefix + 'PwBranch') || {}).value || 'CSE').trim();
    var rows = document.querySelectorAll('#' + prefix + 'PwStudents .pw-stu-row');
    var assignments = [];
    rows.forEach(function (tr) {
      var reg = tr.getAttribute('data-reg');
      var key = ((tr.querySelector('.pw-assign') || {}).value || '').trim();
      if (reg && key) assignments.push({ reg_no: reg, pathway_key: key });
    });
    try {
      var data = await api('/api/exam/pathways', {
        method: 'POST',
        body: { action: 'assign_bulk', academic_year: ay, branch: br, assignments: assignments },
      });
      alert('Assigned ' + (data.updated || 0));
      window.examPathwayLoadStaff(prefix);
    } catch (e) {
      alert(e.message);
    }
  };

  /** Staff verification state: per-student cards (not one giant flat table). */
  window._examRvState = window._examRvState || {};

  function examResultBadge(result) {
    var r = String(result || '').toLowerCase();
    if (r === 'pass') return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:800;font-size:0.8rem;">PASS</span>';
    if (r === 'fail') return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:800;font-size:0.8rem;">FAIL</span>';
    if (r === 'absent') return '<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:800;font-size:0.8rem;">ABSENT</span>';
    return esc(result || '—');
  }

  function examStatusBadge(status) {
    var s = String(status || '');
    if (s === 'pending') return '<span class="badge pending">pending</span>';
    if (s === 'verified') return '<span class="badge active">verified</span>';
    if (s === 'rejected') return '<span class="badge" style="background:#fee2e2;color:#991b1b;">rejected</span>';
    return '<span class="badge">' + esc(s) + '</span>';
  }

  window.examStaffLoadVerify = async function (prefix, opts) {
    opts = opts || {};
    var list = document.getElementById(prefix + 'RvList');
    if (!list) {
      console.warn('[exam] RvList missing for', prefix);
      return;
    }
    list.innerHTML = '<p style="opacity:.7;padding:16px;font-size:0.95rem;">Loading students…</p>';
    var statusEl = document.getElementById(prefix + 'RvStatus');
    var branchEl = document.getElementById(prefix + 'RvBranch');
    var kind = opts.kind || 'regular';
    var q = '/api/exam/attempts?kind=' + encodeURIComponent(kind) + '&';
    var st = statusEl ? statusEl.value : '';
    // Default: show all if filter not set; empty string = all
    if (st) q += 'status=' + encodeURIComponent(st) + '&';
    if (branchEl && branchEl.value) q += 'branch=' + encodeURIComponent(branchEl.value) + '&';
    try {
      var data = await api(q);
      var byStudent = data.by_student || [];
      var prev = (window._examRvState[prefix] || {}).selectedReg || null;
      window._examRvState[prefix] = {
        by_student: byStudent,
        selectedReg: prev,
        student_count: data.student_count || byStudent.length,
        pending_count: data.pending_count || 0,
        kind: kind,
      };
      if (!byStudent.length) {
        var stLabel = st === 'pending' ? 'pending/draft' : st || 'any status';
        list.innerHTML =
          '<div style="padding:28px;text-align:center;font-size:0.95rem;max-width:520px;margin:0 auto;line-height:1.5;">' +
          '<div style="font-weight:800;margin-bottom:8px;">No ' +
          esc(kind) +
          ' result rows for filter: <em>' +
          esc(stLabel) +
          '</em></div>' +
          '<div style="opacity:.8;">Tip: switch status to <strong>All statuses</strong> to see already verified entries, ' +
          'or ask students to <strong>Submit for verification</strong> (not only Save draft).</div>' +
          '<button type="button" class="btn ol" style="margin-top:14px;" onclick="var s=document.getElementById(\'' +
          prefix +
          'RvStatus\'); if(s){s.value=\'\';} window.examStaffLoadVerify(\'' +
          prefix +
          '\',{kind:\'' +
          kind +
          '\'})">Show all statuses</button></div>';
        return;
      }
      // Prefer previously selected student if still present; else first with pending
      var sel = prev;
      if (!sel || !byStudent.some(function (s) { return s.reg_no === sel; })) {
        var withPend = byStudent.find(function (s) { return s.pending > 0; });
        sel = (withPend || byStudent[0]).reg_no;
      }
      window._examRvState[prefix].selectedReg = sel;
      window.examStaffPaintVerify(prefix);
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;padding:16px;">' + esc(e.message) + '</p>';
    }
  };

  window.examStaffPaintVerify = function (prefix) {
    var list = document.getElementById(prefix + 'RvList');
    if (!list) return;
    var state = window._examRvState[prefix] || {};
    var byStudent = state.by_student || [];
    var sel = state.selectedReg;
    var filterQ = ((document.getElementById(prefix + 'RvSearch') || {}).value || '').trim().toLowerCase();

    var filtered = byStudent.filter(function (s) {
      if (!filterQ) return true;
      return (
        String(s.name || '').toLowerCase().indexOf(filterQ) >= 0 ||
        String(s.reg_no || '').toLowerCase().indexOf(filterQ) >= 0
      );
    });

    var html =
      '<div style="padding:8px 4px 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">' +
      '<div style="font-size:0.92rem;">' +
      '<strong>' + filtered.length + '</strong> student(s)' +
      (state.pending_count != null
        ? ' · <strong style="color:#b45309;">' + state.pending_count + '</strong> pending subject row(s)'
        : '') +
      ' · open one student at a time to verify' +
      '</div>' +
      '<input id="' + prefix + 'RvSearch" type="search" placeholder="Search name or reg…" ' +
      'value="' + esc(filterQ) + '" ' +
      'oninput="window.examStaffPaintVerify&&window.examStaffPaintVerify(\'' + prefix + '\')" ' +
      'style="padding:10px 12px;border-radius:8px;border:1.5px solid var(--border);min-width:220px;font-size:0.9rem;" />' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:minmax(260px,320px) 1fr;gap:14px;align-items:start;">' +
      '<div id="' + prefix + 'RvStudentList" style="max-height:70vh;overflow:auto;border:1.5px solid var(--border);border-radius:12px;background:#f8fafc;">';

    if (!filtered.length) {
      html += '<div style="padding:20px;opacity:.7;">No match.</div>';
    } else {
      filtered.forEach(function (s) {
        var active = s.reg_no === sel;
        html +=
          '<button type="button" class="exam-rv-stu" data-reg="' + esc(s.reg_no) + '" ' +
          'onclick="window.examStaffSelectStudent&&window.examStaffSelectStudent(\'' +
          prefix + '\',\'' + esc(s.reg_no).replace(/'/g, "\\'") + '\')" ' +
          'style="display:block;width:100%;text-align:left;padding:14px 14px;border:0;border-bottom:1px solid #e2e8f0;' +
          'cursor:pointer;background:' + (active ? '#fff7ed' : 'transparent') + ';' +
          (active ? 'box-shadow:inset 4px 0 0 #ea580c;' : '') + '">' +
          '<div style="font-weight:800;font-size:0.95rem;color:#0f172a;line-height:1.25;">' +
          esc(s.name || s.reg_no) + '</div>' +
          '<div style="font-family:ui-monospace,monospace;font-size:0.8rem;color:#475569;margin-top:3px;">' +
          esc(s.reg_no) + '</div>' +
          '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;">' +
          (s.pending
            ? '<span style="background:#ffedd5;color:#9a3412;padding:2px 8px;border-radius:999px;font-weight:700;">' +
              s.pending + ' pending</span>'
            : '') +
          (s.verified
            ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-weight:700;">' +
              s.verified + ' verified</span>'
            : '') +
          (s.rejected
            ? '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;font-weight:700;">' +
              s.rejected + ' rejected</span>'
            : '') +
          '<span style="opacity:.65;">' + s.total + ' row(s)</span>' +
          '</div></button>';
      });
    }

    html += '</div><div id="' + prefix + 'RvDetail" style="min-height:320px;border:1.5px solid var(--border);border-radius:12px;background:#fff;padding:0;overflow:hidden;"></div></div>';
    list.innerHTML = html;

    // Keep search caret: restore focus if typing
    var searchEl = document.getElementById(prefix + 'RvSearch');
    if (searchEl && filterQ) {
      try {
        searchEl.focus();
        var len = searchEl.value.length;
        searchEl.setSelectionRange(len, len);
      } catch (e1) { /* ignore */ }
    }

    window.examStaffPaintVerifyDetail(prefix);
  };

  window.examStaffSelectStudent = function (prefix, reg) {
    if (!window._examRvState[prefix]) window._examRvState[prefix] = {};
    window._examRvState[prefix].selectedReg = reg;
    window.examStaffPaintVerify(prefix);
  };

  window.examStaffPaintVerifyDetail = function (prefix) {
    var host = document.getElementById(prefix + 'RvDetail');
    if (!host) return;
    var state = window._examRvState[prefix] || {};
    var byStudent = state.by_student || [];
    var sel = state.selectedReg;
    var stu = byStudent.find(function (s) { return s.reg_no === sel; });
    if (!stu) {
      host.innerHTML = '<div style="padding:28px;opacity:.7;font-size:0.95rem;">Select a student from the left.</div>';
      return;
    }

    var attempts = (stu.attempts || []).slice().sort(function (a, b) {
      return Number(a.semester) - Number(b.semester) ||
        String(a.subject_code).localeCompare(String(b.subject_code)) ||
        Number(a.id) - Number(b.id);
    });
    var pendingIds = attempts.filter(function (a) { return a.status === 'pending'; }).map(function (a) { return a.id; });

    var html =
      '<div style="padding:16px 18px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#fff7ed 0%,#fff 100%);">' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between;">' +
      '<div>' +
      '<div style="font-size:1.2rem;font-weight:800;color:#0f172a;">' + esc(stu.name || stu.reg_no) + '</div>' +
      '<div style="margin-top:4px;font-size:0.9rem;color:#475569;">' +
      '<span style="font-family:ui-monospace,monospace;font-weight:700;">' + esc(stu.reg_no) + '</span>' +
      (stu.branch ? ' · ' + esc(stu.branch) : '') +
      (stu.branch_code ? ' · ' + esc(stu.branch_code) : '') +
      '</div>' +
      '<div style="margin-top:8px;font-size:0.85rem;">' +
      '<strong>' + pendingIds.length + '</strong> pending · ' +
      '<strong>' + (stu.verified || 0) + '</strong> verified · ' +
      '<strong>' + attempts.length + '</strong> total rows' +
      '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
      '<button type="button" class="btn ol" style="padding:10px 14px;font-size:0.85rem;" ' +
      'onclick="window.examStaffToggleAllStudent&&window.examStaffToggleAllStudent(\'' + prefix + '\',true)">Select all pending</button>' +
      '<button type="button" class="btn go" style="padding:10px 14px;font-size:0.85rem;" ' +
      'onclick="window.examStaffActStudent&&window.examStaffActStudent(\'' + prefix + '\',\'verify\')" ' +
      (pendingIds.length ? '' : 'disabled ') +
      '>✅ Verify all pending (' + pendingIds.length + ')</button>' +
      '<button type="button" class="btn" style="padding:10px 14px;font-size:0.85rem;background:#991b1b;color:#fff;" ' +
      'onclick="window.examStaffActStudent&&window.examStaffActStudent(\'' + prefix + '\',\'reject\')" ' +
      (pendingIds.length ? '' : 'disabled ') +
      '>Reject all pending</button>' +
      '</div></div></div>' +
      '<div style="padding:14px 16px;max-height:62vh;overflow:auto;">';

    // Group by semester
    var bySem = {};
    attempts.forEach(function (a) {
      var k = String(a.semester || '?');
      if (!bySem[k]) bySem[k] = [];
      bySem[k].push(a);
    });
    Object.keys(bySem).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (sem) {
      var rows = bySem[sem];
      html +=
        '<div style="margin-bottom:18px;">' +
        '<div style="font-size:1rem;font-weight:800;margin:4px 0 10px;padding:8px 12px;background:#f1f5f9;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">' +
        '<span>Semester ' + esc(sem) + ' <span style="font-weight:600;opacity:.7;font-size:0.85rem;">(' + rows.length + ' subjects)</span></span>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.92rem;">' +
        '<thead><tr style="background:#fafafa;text-align:left;">' +
        '<th style="padding:10px 8px;width:36px;"></th>' +
        '<th style="padding:10px 8px;">Subject</th>' +
        '<th style="padding:10px 8px;">Session</th>' +
        '<th style="padding:10px 8px;">Result</th>' +
        '<th style="padding:10px 8px;">Grade</th>' +
        '<th style="padding:10px 8px;">Status</th>' +
        '</tr></thead><tbody>';
      rows.forEach(function (a) {
        var canCheck = a.status === 'pending' || a.status === 'rejected';
        var passBg = String(a.result).toLowerCase() === 'pass' ? 'background:#f0fdf4;' :
          String(a.result).toLowerCase() === 'fail' ? 'background:#fef2f2;' : '';
        html +=
          '<tr class="exam-rv-row" style="border-bottom:1px solid #e2e8f0;' + passBg + '">' +
          '<td style="padding:12px 8px;vertical-align:top;">' +
          (canCheck
            ? '<input type="checkbox" class="exam-rv-cb" data-id="' + a.id + '" data-reg="' + esc(a.reg_no) + '" ' +
              (a.status === 'pending' ? 'checked ' : '') +
              'style="width:18px;height:18px;cursor:pointer;" />'
            : '') +
          '</td>' +
          '<td style="padding:12px 8px;vertical-align:top;">' +
          '<div style="font-weight:800;font-size:0.95rem;">' + esc(a.subject_code) + '</div>' +
          '<div style="font-size:0.84rem;color:#475569;margin-top:2px;line-height:1.35;">' +
          esc(a.subject_name || '') + '</div></td>' +
          '<td style="padding:12px 8px;vertical-align:top;font-size:0.9rem;">' + esc(a.exam_session || '—') + '</td>' +
          '<td style="padding:12px 8px;vertical-align:top;">' + examResultBadge(a.result) + '</td>' +
          '<td style="padding:12px 8px;vertical-align:top;font-weight:800;font-size:1.05rem;color:#0f172a;">' +
          esc(a.grade || '—') + '</td>' +
          '<td style="padding:12px 8px;vertical-align:top;">' + examStatusBadge(a.status) +
          (a.reject_note ? '<div style="font-size:0.75rem;color:#991b1b;margin-top:4px;">' + esc(a.reject_note) + '</div>' : '') +
          (a.status === 'verified' && a.verified_by_name && window.gpthStamp
            ? '<div style="margin-top:6px;">' +
              window.gpthStamp.line(
                {
                  action: 'verified',
                  by_name: a.verified_by_name,
                  by_role: a.verifier_role,
                  at: a.verified_at,
                },
                'verified',
              ) +
              '</div>'
            : a.status === 'verified' && a.verified_by_name
              ? '<div style="font-size:0.72rem;margin-top:4px;color:#166534;">Verified by ' +
                esc(a.verified_by_name) +
                (a.verifier_role ? ' (' + esc(a.verifier_role) + ')' : '') +
                '</div>'
              : '') +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    html +=
      '<div style="padding:12px 0 4px;border-top:1px solid var(--border);margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;">' +
      '<button type="button" class="btn go" style="padding:10px 16px;" ' +
      'onclick="window.examStaffActSelected&&window.examStaffActSelected(\'' + prefix + '\',\'verify\')">✅ Verify checked rows</button>' +
      '<button type="button" class="btn" style="padding:10px 16px;background:#991b1b;color:#fff;" ' +
      'onclick="window.examStaffActSelected&&window.examStaffActSelected(\'' + prefix + '\',\'reject\')">Reject checked rows</button>' +
      '<span style="font-size:0.8rem;opacity:.7;align-self:center;">Pending rows are pre-checked. Uncheck any you want to skip.</span>' +
      '</div></div>';

    host.innerHTML = html;
  };

  window.examStaffToggleAllStudent = function (prefix, on) {
    document.querySelectorAll('#' + prefix + 'RvDetail .exam-rv-cb').forEach(function (cb) {
      if (!cb.disabled) cb.checked = !!on;
    });
  };

  window.examStaffCollectChecked = function (prefix) {
    var ids = [];
    document.querySelectorAll('#' + prefix + 'RvList .exam-rv-cb:checked').forEach(function (cb) {
      var id = Number(cb.getAttribute('data-id'));
      if (id) ids.push(id);
    });
    return ids;
  };

  window.examStaffActSelected = function (prefix, action) {
    var ids = window.examStaffCollectChecked(prefix);
    if (!ids.length) {
      alert('Select subject rows first (pending rows are pre-checked for this student).');
      return;
    }
    var body = { action: action, ids: ids };
    if (action === 'reject') {
      var note = prompt('Reject reason (optional)') || 'Rejected';
      body.note = note;
    }
    api('/api/exam/attempts', { method: 'PATCH', body: body })
      .then(function (data) {
        alert(
          (action === 'verify' ? 'Verified ' : 'Rejected ') +
            (data.updated || ids.length) +
            ' row(s)' +
            (action === 'verify' ? '. Locked for student edits.' : '.'),
        );
        window.examStaffLoadVerify(prefix);
      })
      .catch(function (err) { alert(err.message); });
  };

  window.examStaffActStudent = function (prefix, action) {
    var state = window._examRvState[prefix] || {};
    var stu = (state.by_student || []).find(function (s) { return s.reg_no === state.selectedReg; });
    if (!stu) return;
    var ids = (stu.attempts || [])
      .filter(function (a) { return a.status === 'pending'; })
      .map(function (a) { return a.id; });
    if (!ids.length) {
      alert('No pending rows for this student.');
      return;
    }
    var body = { action: action, ids: ids };
    if (action === 'reject') {
      var note = prompt('Reject reason for all pending of ' + (stu.name || stu.reg_no) + ' (optional)') || 'Rejected';
      body.note = note;
    } else if (
      !confirm(
        'Verify all ' + ids.length + ' pending subject(s) for\n' +
          (stu.name || '') + ' (' + stu.reg_no + ')?\n\nRows will lock for the student.',
      )
    ) {
      return;
    }
    api('/api/exam/attempts', { method: 'PATCH', body: body })
      .then(function (data) {
        alert((action === 'verify' ? 'Verified ' : 'Rejected ') + (data.updated || ids.length) + ' row(s) for this student.');
        window.examStaffLoadVerify(prefix);
      })
      .catch(function (err) { alert(err.message); });
  };

  window.examStaffLoadFees = async function (prefix) {
    var list = document.getElementById(prefix + 'FdList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    var st = (document.getElementById(prefix + 'FdStatus') || {}).value || '';
    var br = (document.getElementById(prefix + 'FdBranch') || {}).value || '';
    var q = '/api/exam/fees?';
    if (st) q += 'status=' + encodeURIComponent(st) + '&';
    if (br) q += 'branch=' + encodeURIComponent(br) + '&';
    try {
      var data = await api(q);
      var payments = data.payments || [];
      if (!payments.length) {
        list.innerHTML = '<p style="opacity:.7;">No fee records yet.</p>';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th>Reg / Name</th><th>Branch</th><th>Computed</th><th>Challans</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      payments.forEach(function (p) {
        var ch = (p.challans || []).map(function (c) {
          return esc(c.receipt_no) + ' ₹' + c.amount;
        }).join('<br>') || '—';
        html += '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:6px;"><strong>' + esc(p.reg_no) + '</strong><div style="opacity:.75;">' +
          esc(p.name) + '</div></td>' +
          '<td style="padding:6px;font-size:0.72rem;">' + esc(p.branch || '') + '</td>' +
          '<td style="padding:6px;">₹ ' + p.computed_total +
          (p.challan_total != null ? '<div style="font-size:0.7rem;">Paid-in ₹' + p.challan_total + '</div>' : '') +
          '</td>' +
          '<td style="padding:6px;font-size:0.72rem;">' + ch + '</td>' +
          '<td style="padding:6px;"><strong>' + esc(p.status) + '</strong></td>' +
          '<td style="padding:6px;white-space:nowrap;">' +
          '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" ' +
          "onclick='window.examMarkPaid(" + p.id + ",\"paid\")'>Paid</button> " +
          '<button type="button" class="btn ol" style="padding:4px 8px;font-size:0.72rem;" ' +
          "onclick='window.examMarkPaid(" + p.id + ",\"partial\")'>Partial</button> " +
          '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b45309;color:#fff;" ' +
          "onclick='window.examMarkPaid(" + p.id + ",\"due\")'>Due</button>" +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  /* ---------- Regular exam declare ---------- */
  window.regularCycleLoad = async function (prefix) {
    var list = document.getElementById(prefix + 'RgCycleList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    try {
      var data = await api('/api/exam/regular-cycles');
      var cycles = data.cycles || [];
      if (!cycles.length) {
        list.innerHTML = '<p style="opacity:.7;">No regular exam cycles yet. Declare a month above.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
        '<th>Month</th><th>Session</th><th>Cycle key</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      cycles.forEach(function (c) {
        html +=
          '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;"><strong>' +
          esc(c.month_label) +
          '</strong></td><td style="padding:6px;">' +
          esc(c.session_name) +
          '</td><td style="padding:6px;">' +
          esc(c.exam_cycle) +
          '</td><td style="padding:6px;"><strong>' +
          esc(c.status) +
          '</strong>' +
          (c.declared_by_name
            ? '<div style="font-size:0.7rem;">' + esc(c.declared_by_name) + '</div>'
            : '') +
          '</td><td style="padding:6px;white-space:nowrap;">' +
          (c.status !== 'open'
            ? '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" onclick="window.regularCycleSetStatus(' +
              c.id +
              ',\'open\',\'' +
              prefix +
              '\')">Open</button> '
            : '') +
          (c.status === 'open'
            ? '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b45309;color:#fff;" onclick="window.regularCycleSetStatus(' +
              c.id +
              ',\'closed\',\'' +
              prefix +
              '\')">Close</button>'
            : '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.regularCycleCreate = async function (prefix, status) {
    var month = ((document.getElementById(prefix + 'RgMonth') || {}).value || '').trim();
    var session = ((document.getElementById(prefix + 'RgSession') || {}).value || '').trim();
    var cycleKey = ((document.getElementById(prefix + 'RgCycleKey') || {}).value || 'current').trim();
    var note = ((document.getElementById(prefix + 'RgNote') || {}).value || '').trim();
    if (!month) {
      alert('Enter month label (e.g. April / May 2026)');
      return;
    }
    try {
      await api('/api/exam/regular-cycles', {
        method: 'POST',
        body: {
          month_label: month,
          session_name: session || undefined,
          exam_cycle: cycleKey || 'current',
          note: note || null,
          status: status || 'draft',
        },
      });
      alert(status === 'open' ? 'Regular exam declared and opened.' : 'Draft saved.');
      window.regularCycleLoad(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  window.regularCycleSetStatus = async function (id, status, prefix) {
    try {
      await api('/api/exam/regular-cycles', {
        method: 'PATCH',
        body: { id: id, status: status },
      });
      window.regularCycleLoad(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  /* ---------- Makeup staff helpers ---------- */
  window.makeupCycleLoad = async function (prefix) {
    var list = document.getElementById(prefix + 'MkCycleList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    try {
      var data = await api('/api/exam/makeup/cycles');
      var cycles = data.cycles || [];
      if (!cycles.length) {
        list.innerHTML = '<p style="opacity:.7;">No cycles yet. Declare a month above.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;"><thead><tr>' +
        '<th>Month</th><th>Session</th><th>Fee/subj</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      cycles.forEach(function (c) {
        html +=
          '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;"><strong>' +
          esc(c.month_label) +
          '</strong><div style="font-size:0.72rem;opacity:.75;">' +
          esc(c.label) +
          '</div></td><td style="padding:6px;">' +
          esc(c.session_name) +
          '</td><td style="padding:6px;">₹' +
          c.fee_per_subject +
          (c.fee_base ? ' +' + c.fee_base : '') +
          '</td><td style="padding:6px;"><strong>' +
          esc(c.status) +
          '</strong>' +
          (c.declared_by_name
            ? '<div style="font-size:0.7rem;">' + esc(c.declared_by_name) + '</div>'
            : '') +
          '</td><td style="padding:6px;white-space:nowrap;">' +
          (c.status !== 'open'
            ? '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" onclick="window.makeupCycleSetStatus(' +
              c.id +
              ',\'open\',\'' +
              prefix +
              '\')">Open</button> '
            : '') +
          (c.status === 'open'
            ? '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b45309;color:#fff;" onclick="window.makeupCycleSetStatus(' +
              c.id +
              ',\'closed\',\'' +
              prefix +
              '\')">Close</button>'
            : '') +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.makeupCycleCreate = async function (prefix, status) {
    var month = ((document.getElementById(prefix + 'MkMonth') || {}).value || '').trim();
    var session = ((document.getElementById(prefix + 'MkSession') || {}).value || '').trim();
    var feeSub = Number((document.getElementById(prefix + 'MkFeeSub') || {}).value || 250);
    var feeBase = Number((document.getElementById(prefix + 'MkFeeBase') || {}).value || 0);
    var note = ((document.getElementById(prefix + 'MkNote') || {}).value || '').trim();
    if (!month) {
      alert('Enter month label (e.g. July / August 2026)');
      return;
    }
    try {
      await api('/api/exam/makeup/cycles', {
        method: 'POST',
        body: {
          month_label: month,
          session_name: session || undefined,
          fee_per_subject: feeSub,
          fee_base: feeBase,
          note: note || null,
          status: status || 'draft',
          even_sems_only: true,
          semesters: [2, 4, 6],
        },
      });
      alert(status === 'open' ? 'Makeup opened for students.' : 'Draft saved.');
      window.makeupCycleLoad(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  window.makeupCycleSetStatus = async function (id, status, prefix) {
    try {
      await api('/api/exam/makeup/cycles', {
        method: 'PATCH',
        body: { id: id, status: status },
      });
      window.makeupCycleLoad(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  window.makeupStaffLoadVerify = async function (prefix) {
    var list = document.getElementById(prefix + 'MkVList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    var st = (document.getElementById(prefix + 'MkVStatus') || {}).value || 'pending';
    try {
      var q = '/api/exam/makeup/attempts?list=1&status=' + encodeURIComponent(st);
      var data = await api(q);
      var rows = data.attempts || [];
      if (!rows.length) {
        list.innerHTML = '<p style="opacity:.7;">No makeup attempts for this filter.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th>Student</th><th>Subject</th><th>Session</th><th>Result</th><th>Status</th><th></th></tr></thead><tbody>';
      rows.forEach(function (a) {
        html +=
          '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;"><strong>' +
          esc(a.reg_no) +
          '</strong><div style="opacity:.75;">' +
          esc(a.student_name || '') +
          '</div></td><td style="padding:6px;">' +
          esc(a.subject_code) +
          '<div style="font-size:0.7rem;">' +
          esc(a.subject_name) +
          ' · Sem ' +
          a.semester +
          '</div></td><td style="padding:6px;">' +
          esc(a.exam_session) +
          '</td><td style="padding:6px;">' +
          esc(a.result) +
          ' ' +
          esc(a.grade || '') +
          '</td><td style="padding:6px;">' +
          esc(a.status) +
          '</td><td style="padding:6px;white-space:nowrap;">' +
          (a.status === 'pending'
            ? '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" onclick="window.makeupMarkAttempt(' +
              a.id +
              ',\'verify\',\'' +
              prefix +
              '\')">Verify</button> ' +
              '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b91c1c;color:#fff;" onclick="window.makeupMarkAttempt(' +
              a.id +
              ',\'reject\',\'' +
              prefix +
              '\')">Reject</button>'
            : '—') +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.makeupMarkAttempt = async function (id, action, prefix) {
    var note = action === 'reject' ? prompt('Reject note (optional):') : null;
    try {
      await api('/api/exam/makeup/attempts', {
        method: 'PATCH',
        body: { id: id, action: action, reject_note: note },
      });
      window.makeupStaffLoadVerify(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  window.makeupStaffLoadFees = async function (prefix) {
    var list = document.getElementById(prefix + 'MkFdList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    var st = (document.getElementById(prefix + 'MkFdStatus') || {}).value || '';
    try {
      var q = '/api/exam/makeup/fees?';
      if (st) q += 'status=' + encodeURIComponent(st) + '&';
      var data = await api(q);
      var payments = data.payments || [];
      if (!payments.length) {
        list.innerHTML =
          '<p style="opacity:.7;">No makeup fee records' +
          (data.cycle ? ' for ' + esc(data.cycle.month_label) : ' (declare an open cycle first)') +
          '.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th>Reg / Name</th><th>Computed</th><th>Challans</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      payments.forEach(function (p) {
        var ch =
          (p.challans || [])
            .map(function (c) {
              return esc(c.receipt_no) + ' ₹' + c.amount;
            })
            .join('<br>') || '—';
        html +=
          '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;"><strong>' +
          esc(p.reg_no) +
          '</strong><div style="opacity:.75;">' +
          esc(p.name || '') +
          '</div></td><td style="padding:6px;">₹ ' +
          p.computed_total +
          '</td><td style="padding:6px;font-size:0.72rem;">' +
          ch +
          '</td><td style="padding:6px;"><strong>' +
          esc(p.status) +
          '</strong></td><td style="padding:6px;white-space:nowrap;">' +
          '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" onclick="window.makeupMarkPaid(' +
          p.id +
          ',\'paid\',\'' +
          prefix +
          '\')">Paid</button> ' +
          '<button type="button" class="btn ol" style="padding:4px 8px;font-size:0.72rem;" onclick="window.makeupMarkPaid(' +
          p.id +
          ',\'partial\',\'' +
          prefix +
          '\')">Partial</button> ' +
          '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b45309;color:#fff;" onclick="window.makeupMarkPaid(' +
          p.id +
          ',\'due\',\'' +
          prefix +
          '\')">Due</button></td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.makeupMarkPaid = async function (id, status, prefix) {
    try {
      await api('/api/exam/makeup/fees', {
        method: 'PATCH',
        body: { id: id, status: status },
      });
      alert('Makeup fee marked ' + status);
      window.makeupStaffLoadFees(prefix);
    } catch (e) {
      alert(e.message || 'Failed');
    }
  };

  window.makeupFeeSchedAddRow = function (prefix, data) {
    var host = document.getElementById(prefix + 'MkFsRows');
    if (!host) return;
    data = data || { fine_amount: 0 };
    var div = document.createElement('div');
    div.className = 'mk-fs-row';
    div.style.cssText =
      'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:end;padding:8px;border:1px solid var(--border);border-radius:8px;';
    div.innerHTML =
      '<div><label style="font-size:0.7rem;">From</label><br><input class="mk-fs-from" type="date" value="' +
      esc(data.from_date || '') +
      '" style="padding:6px;border-radius:6px;border:1px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.7rem;">To</label><br><input class="mk-fs-to" type="date" value="' +
      esc(data.to_date || '') +
      '" style="padding:6px;border-radius:6px;border:1px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.7rem;">Fine ₹</label><br><input class="mk-fs-amt" type="number" min="0" value="' +
      (data.fine_amount || 0) +
      '" style="width:90px;padding:6px;border-radius:6px;border:1px solid var(--border);" /></div>' +
      '<div><label style="font-size:0.7rem;">Label</label><br><input class="mk-fs-label" type="text" value="' +
      esc(data.label || '') +
      '" style="padding:6px;border-radius:6px;border:1px solid var(--border);" /></div>';
    host.appendChild(div);
  };

  window.makeupFeeSchedLoad = async function (prefix) {
    var info = document.getElementById(prefix + 'MkFsInfo');
    var host = document.getElementById(prefix + 'MkFsRows');
    if (host) host.innerHTML = '';
    try {
      var data = await api('/api/exam/makeup/fee-schedule');
      if (info) {
        info.innerHTML = data.cycle
          ? 'Cycle: <strong>' +
            esc(data.cycle.month_label) +
            '</strong> (' +
            esc(data.cycle.status) +
            ')'
          : 'No open cycle — open a makeup cycle first.';
      }
      var tiers = data.tiers || [];
      if (!tiers.length) {
        window.makeupFeeSchedAddRow(prefix, { fine_amount: 0, label: 'Without fine' });
      } else {
        tiers.forEach(function (t) {
          window.makeupFeeSchedAddRow(prefix, t);
        });
      }
    } catch (e) {
      if (info) info.textContent = e.message || 'Load failed';
    }
  };

  window.makeupFeeSchedSave = async function (prefix) {
    var rows = document.querySelectorAll('#' + prefix + 'MkFsRows .mk-fs-row');
    var tiers = [];
    rows.forEach(function (row) {
      var from = ((row.querySelector('.mk-fs-from') || {}).value || '').trim();
      var to = ((row.querySelector('.mk-fs-to') || {}).value || '').trim();
      var amt = Number((row.querySelector('.mk-fs-amt') || {}).value || 0);
      var label = ((row.querySelector('.mk-fs-label') || {}).value || '').trim();
      if (from && to) tiers.push({ from_date: from, to_date: to, fine_amount: amt, label: label || null });
    });
    if (!tiers.length) {
      alert('Add at least one date window');
      return;
    }
    try {
      await api('/api/exam/makeup/fee-schedule', { method: 'PUT', body: { tiers: tiers } });
      alert('Makeup fine schedule saved.');
      window.makeupFeeSchedLoad(prefix);
    } catch (e) {
      alert(e.message || 'Save failed');
    }
  };

  window.admFeeStaffLoad = async function (prefix) {
    var list = document.getElementById(prefix + 'AfList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    var st = (document.getElementById(prefix + 'AfStatus') || {}).value || '';
    var q = '/api/admission-fees?';
    if (st) q += 'status=' + encodeURIComponent(st) + '&';
    try {
      var data = await api(q);
      var records = data.records || [];
      if (!records.length) {
        list.innerHTML = '<p style="opacity:.7;">No admission fee records for this filter.</p>';
        return;
      }
      var html =
        '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th>Reg / Name</th><th>Year</th><th>Proof</th><th>Status</th><th>Verifier</th><th>Actions</th></tr></thead><tbody>';
      records.forEach(function (p) {
        html +=
          '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:6px;"><strong>' +
          esc(p.reg_no) +
          '</strong><div style="opacity:.75;">' +
          esc(p.name || '') +
          '</div><div style="font-size:0.7rem;opacity:.65;">' +
          esc(p.dept || '') +
          '</div></td>' +
          '<td style="padding:6px;">' +
          esc(p.year_label || '') +
          '</td>' +
          '<td style="padding:6px;font-size:0.72rem;">' +
          (p.amount || p.receipt_no
            ? '₹ ' + esc(p.amount || '—') + '<br>' + esc(p.receipt_no || '') + (p.paid_date ? '<br>' + esc(p.paid_date) : '')
            : '—') +
          (p.student_note ? '<div style="opacity:.75;margin-top:2px;">' + esc(p.student_note) + '</div>' : '') +
          '</td>' +
          '<td style="padding:6px;"><strong>' +
          esc(p.status) +
          '</strong></td>' +
          '<td style="padding:6px;font-size:0.72rem;">' +
          (p.verified_by_name
            ? esc(p.verified_by_name) + (p.verified_by_role ? ' (' + esc(p.verified_by_role) + ')' : '')
            : '—') +
          '</td>' +
          '<td style="padding:6px;white-space:nowrap;">' +
          '<button type="button" class="btn go" style="padding:4px 8px;font-size:0.72rem;" ' +
          "onclick='window.admFeeMark(" +
          p.id +
          ",\"paid\")'>Paid</button> " +
          '<button type="button" class="btn" style="padding:4px 8px;font-size:0.72rem;background:#b91c1c;color:#fff;" ' +
          "onclick='window.admFeeMark(" +
          p.id +
          ",\"not_paid\")'>Not paid</button>" +
          '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
  };

  window.admFeeMark = async function (id, status) {
    try {
      await api('/api/admission-fees', { method: 'PATCH', body: { id: id, status: status } });
      alert(
        status === 'paid'
          ? 'Marked Paid — student Fees status bar will show Paid (with your stamp).'
          : 'Marked Not paid — student Fees status bar will show Not paid.',
      );
      ;['acmAf', 'facAcmAf', 'cashAf', 'adAf', 'facAf', 'adEx', 'facEx'].forEach(function (p) {
        if (document.getElementById(p + 'AfList')) window.admFeeStaffLoad(p);
      });
    } catch (e) {
      alert(e.message || 'Update failed');
    }
  };

  window.examMarkPaid = async function (id, status) {
    try {
      await api('/api/exam/fees', { method: 'PATCH', body: { id: id, status: status } });
      alert('Marked ' + status + ' (manual — no K2 API).');
      // reload both desks if present
      ;['adEx', 'facEx'].forEach(function (p) {
        if (document.getElementById(p + 'FdList')) window.examStaffLoadFees(p);
      });
    } catch (e) {
      alert(e.message);
    }
  };

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var rel = t.closest('[data-exam-reload-rv]');
      if (rel) {
        var kind = rel.getAttribute('data-exam-kind') || 'regular';
        window.examStaffLoadVerify(rel.getAttribute('data-exam-reload-rv'), { kind: kind });
        return;
      }
      var rfd = t.closest('[data-exam-reload-fd]');
      if (rfd) {
        window.examStaffLoadFees(rfd.getAttribute('data-exam-reload-fd'));
        return;
      }
      var ver = t.closest('[data-exam-verify-sel]');
      if (ver) {
        window.examStaffActSelected(ver.getAttribute('data-exam-verify-sel'), 'verify');
        return;
      }
      var rej = t.closest('[data-exam-reject-sel]');
      if (rej) {
        window.examStaffActSelected(rej.getAttribute('data-exam-reject-sel'), 'reject');
      }
    },
    true,
  );

  function boot() {
    ensureExamStaffPanels();
    if (window.currentUser && window.currentUser.role === 'student') {
      ensureStuResultsPanel();
      ensureStuExamFeesPanel();
    }
  }

  // Hook showSec
  var tries = 0;
  function patchShowSec() {
    if (typeof window.showSec !== 'function') {
      if (tries++ < 40) setTimeout(patchShowSec, 250);
      return;
    }
    if (window._examShowSecPatched) return;
    window._examShowSecPatched = true;
    var orig = window.showSec;
    window.showSec = function (secId, linkEl) {
      orig(secId, linkEl);
      if (secId === 'stuResults') {
        ensureStuResultsPanel();
        window.examStuReload();
      }
      if (secId === 'stuExamFees') {
        ensureStuExamFeesPanel();
        window.examFeesReload();
        window.admFeeReload && window.admFeeReload();
        window.makeupFeesReload && window.makeupFeesReload();
      }
      if (
        secId === 'adExam' ||
        secId === 'adExamFee' ||
        secId === 'adResultVerify' ||
        secId === 'facExamModule'
      ) {
        ensureExamStaffPanels();
        if (secId === 'adResultVerify') {
          setTimeout(function () {
            var btn = document.querySelector(
              '#adResultVerify [data-exam-tab="adExResultsVerify"]',
            );
            if (btn) btn.click();
            else window.examStaffLoadVerify('adEx', { kind: 'regular' });
          }, 80);
        }
        if (secId === 'adExamFee') {
          setTimeout(function () {
            var btn = document.querySelector('#adExamFee [data-exam-tab="adExFeeDesk"]');
            if (btn) btn.click();
            else window.examStaffLoadFees && window.examStaffLoadFees('adEx');
          }, 80);
        }
      }
      if (secId === 'adACM' || secId === 'facACM' || secId === 'facCash' || secId === 'adOpsCategory') {
        ensureStandaloneAdmFeeDesk();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      boot();
      patchShowSec();
    });
  } else {
    boot();
    patchShowSec();
  }

  // Re-boot once when user object changes (login) — was every 1.5s
  var _cu = null;
  setInterval(function () {
    if (document.hidden) return;
    if (window.currentUser && window.currentUser !== _cu) {
      _cu = window.currentUser;
      boot();
    }
  }, 5000);

  console.log('[legacy-exam] loaded — results self-entry, multi-challan fees, manual Exam paid tick (no K2 API)');
})();
