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
    // Rebuild if first paint OR older markup without official results card
    if (panel.getAttribute('data-exam-live') === '1' && document.getElementById('examOfficialHost')) return;
    panel.setAttribute('data-exam-live', '1');
    panel.innerHTML =
      '<div class="info-box">📊 <strong>My Exam Results</strong> — Official ledger results appear below when published. ' +
      'You can also enter pass/fail &amp; grade from your marksheet for verification. ' +
      'Scheme: admission <strong>2020-21 to 2024-25 = C-20</strong>; ' +
      '<strong>2025-26+ = C-25</strong> (Sem 2 subjects loaded from May 2026 ledger). ' +
      'Final year (III) is still C-20 until 2027-28. ITI/PUC lateral skip Year-1. HOD / Principal / Exam verify. Verified rows lock.</div>' +
      '<div id="examStuMeta" style="padding:8px 4px;font-size:0.82rem;opacity:.85;"></div>' +
      '<div class="card" style="margin-bottom:14px;" id="examOfficialCard">' +
      '<div class="card-hd"><h3>Official published results</h3></div>' +
      '<div id="examOfficialHost" style="padding:12px 16px;"><p style="opacity:.7;">Loading…</p></div></div>' +
      '<div class="card" style="margin-bottom:14px;">' +
      '<div class="card-hd"><h3>Enter / update results</h3>' +
      '<div class="card-acts">' +
      '<button type="button" class="btn ol" onclick="window.examStuReload&&window.examStuReload()">↻ Refresh</button> ' +
      '<button type="button" class="btn pr" onclick="window.examStuSave&&window.examStuSave(false)">💾 Save draft</button> ' +
      '<button type="button" class="btn go" onclick="window.examStuSave&&window.examStuSave(true)">📤 Submit for verification</button> ' +
      '<button type="button" class="btn ol" onclick="window.examPrintProvisional&&window.examPrintProvisional()">🖨️ Provisional card</button>' +
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
      '<div id="examStuList" style="padding:12px 16px;overflow-x:auto;"></div></div>';
  }

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

  function ensureStuExamFeesPanel() {
    var panel = document.getElementById('stuExamFees');
    if (!panel) return;
    // Rebuild if older panel still has manual fine input
    if (panel.getAttribute('data-exam-live') === '2') return;
    panel.setAttribute('data-exam-live', '2');
    panel.innerHTML =
      '<div class="info-box"><strong>Exam Fees (live from your results)</strong> — Base fee from backlog / current semester. ' +
      '<strong>Fine</strong> is set by Exam Section date schedule (you cannot edit fine). ' +
      'Pay on official <strong>K2 (Khajane-II)</strong>, then enter receipt number(s) here. ' +
      'No online K2 payment API. Multiple challans allowed (e.g. Rs 300 + Rs 50). ' +
      'Exam Section will manually mark Paid after verifying.</div>' +

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
      '</div>';
    window.examAddChallanRow();
    window.examAddChallanRow();
  }

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
          stEl.innerHTML =
            'Status: <strong>' + esc(p.status) + '</strong>' +
            (p.challan_total != null ? ' · Challan total Rs ' + p.challan_total : '') +
            (p.paid_marked_by_name ? ' · Marked by ' + esc(p.paid_marked_by_name) : '') +
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

  function ensureExamStaffPanels() {
    // Inject into adExam and facExamModule
    ;[
      { root: 'adExam', prefix: 'adEx' },
      { root: 'facExamModule', prefix: 'facEx' },
    ].forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root) return;

      // Always remove Pathways from Exam shell (HOD keeps own menu)
      stripExamPathwaysUi(root, cfg.prefix);

      if (!document.getElementById(cfg.prefix + 'ResultsVerify')) {
        var bar = document.createElement('div');
        bar.className = 'exam-staff-tabs';
        bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border);';
        bar.innerHTML =
          '<button type="button" class="btn pr" data-exam-tab="' + cfg.prefix + 'ResultsVerify">Result verification</button>' +
          '<button type="button" class="btn go" data-exam-tab="' + cfg.prefix + 'FeeDesk">Exam fees desk</button>' +
          '<button type="button" class="btn ol" data-exam-tab="' + cfg.prefix + 'FeeSchedule">Fee schedule</button>';
        root.insertBefore(bar, root.firstChild);

        var v = document.createElement('div');
        v.id = cfg.prefix + 'ResultsVerify';
        v.style.display = 'none';
        v.innerHTML =
          '<div class="info-box"><strong>Result verification (per student)</strong> — ' +
          'HOD = own branch; Exam / Principal / Admin = all. Open one student, review semester-wise subjects (larger view with name), ' +
          'then verify/reject. Verified rows lock for students.</div>' +
          '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
          '<select id="' + cfg.prefix + 'RvBranch" style="padding:10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.9rem;">' +
          '<option value="">All branches</option>' +
          '<option value="CE">Civil</option><option value="CSE">CSE</option>' +
          '<option value="ECE">ECE</option><option value="ME">ME</option></select>' +
          '<select id="' + cfg.prefix + 'RvStatus" style="padding:10px;border-radius:8px;border:1.5px solid var(--border);font-size:0.9rem;">' +
          '<option value="pending">Pending only</option><option value="">All statuses</option>' +
          '<option value="verified">Verified</option><option value="rejected">Rejected</option></select>' +
          '<button type="button" class="btn ol" data-exam-reload-rv="' + cfg.prefix + '" style="padding:10px 14px;">Reload students</button>' +
          '</div><div id="' + cfg.prefix + 'RvList" style="padding:8px 10px 16px;"></div>';
        root.appendChild(v);

        var f = document.createElement('div');
        f.id = cfg.prefix + 'FeeDesk';
        f.style.display = 'none';
        f.innerHTML =
          '<div class="info-box">Exam fees desk — <strong>no K2 API</strong>. Students enter challan number(s); ' +
          'you verify payment offline and tick <strong>Paid</strong> / <strong>Partial</strong> / <strong>Due</strong>. ' +
          'Multiple challans supported (e.g. Rs 300 + Rs 50). Fine amount comes from <strong>Fee schedule</strong> dates.</div>' +
          '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<select id="' + cfg.prefix + 'FdBranch" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
          '<option value="">All branches</option>' +
          '<option value="civil">Civil</option><option value="computer">CSE</option>' +
          '<option value="electron">ECE</option><option value="mech">ME</option></select>' +
          '<select id="' + cfg.prefix + 'FdStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
          '<option value="">All</option><option value="challan_submitted">Challan submitted</option>' +
          '<option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option></select>' +
          '<button type="button" class="btn ol" data-exam-reload-fd="' + cfg.prefix + '">Load</button></div>' +
          '<div id="' + cfg.prefix + 'FdList" style="padding:10px;overflow-x:auto;"></div>';
        root.appendChild(f);
      }

      // Fee schedule panel (always ensure; may be missing on older shells)
      if (!document.getElementById(cfg.prefix + 'FeeSchedule')) {
        var bar2 =
          root.querySelector('.exam-staff-tabs') ||
          (root.querySelector('[data-exam-tab]') && root.querySelector('[data-exam-tab]').parentElement);
        if (bar2 && !bar2.querySelector('[data-exam-tab="' + cfg.prefix + 'FeeSchedule"]')) {
          var sbtn = document.createElement('button');
          sbtn.type = 'button';
          sbtn.className = 'btn ol';
          sbtn.setAttribute('data-exam-tab', cfg.prefix + 'FeeSchedule');
          sbtn.textContent = 'Fee schedule';
          bar2.appendChild(sbtn);
        }
        var s = document.createElement('div');
        s.id = cfg.prefix + 'FeeSchedule';
        s.style.display = 'none';
        s.innerHTML =
          '<div class="info-box"><strong>Exam fee fine schedule</strong> — Set date windows without fine and with fine. ' +
          'Example: until 02-08-2026 fine Rs 0; from 03-08-2026 to 13-08-2026 fine Rs 50. Use <strong>+</strong> to add more windows. ' +
          'Students see this fine automatically on their Exam Fees panel (they cannot edit fine).</div>' +
          '<div class="card" style="padding:14px;margin:10px;">' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:12px;">' +
          '<div><label style="font-size:0.72rem;font-weight:700;">Exam cycle</label><br>' +
          '<input id="' + cfg.prefix + 'FsCycle" type="text" value="current" ' +
          'style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);width:140px;" /></div>' +
          '<button type="button" class="btn ol" onclick="window.examFeeScheduleLoad&&window.examFeeScheduleLoad(\'' +
          cfg.prefix +
          '\')">Load</button>' +
          '<button type="button" class="btn pr" onclick="window.examFeeScheduleSave&&window.examFeeScheduleSave(\'' +
          cfg.prefix +
          '\')">Save schedule</button>' +
          '</div>' +
          '<div id="' + cfg.prefix + 'FsResolved" style="font-size:0.85rem;margin-bottom:10px;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid var(--border);"></div>' +
          '<div id="' + cfg.prefix + 'FsRows"></div>' +
          '<button type="button" class="btn ol" style="margin-top:10px;" onclick="window.examFeeScheduleAddRow&&window.examFeeScheduleAddRow(\'' +
          cfg.prefix +
          '\')">+ Add date window</button>' +
          '</div>';
        root.appendChild(s);
      }

      // Wire tab clicks (rebind every ensure)
      var barWire =
        root.querySelector('.exam-staff-tabs') ||
        (root.querySelector('[data-exam-tab]') && root.querySelector('[data-exam-tab]').parentElement);
      if (barWire) {
        barWire.querySelectorAll('[data-exam-tab]').forEach(function (btn) {
          btn.onclick = function () {
            var id = btn.getAttribute('data-exam-tab') || '';
            var vEl = document.getElementById(cfg.prefix + 'ResultsVerify');
            var fEl = document.getElementById(cfg.prefix + 'FeeDesk');
            var sEl = document.getElementById(cfg.prefix + 'FeeSchedule');
            var pEl = document.getElementById(cfg.prefix + 'Pathways');
            if (vEl) vEl.style.display = id.indexOf('ResultsVerify') >= 0 ? '' : 'none';
            if (fEl) fEl.style.display = id.indexOf('FeeDesk') >= 0 ? '' : 'none';
            if (sEl) sEl.style.display = id.indexOf('FeeSchedule') >= 0 ? '' : 'none';
            if (pEl) pEl.style.display = 'none';
            if (id.indexOf('ResultsVerify') >= 0) window.examStaffLoadVerify(cfg.prefix);
            else if (id.indexOf('FeeDesk') >= 0) window.examStaffLoadFees(cfg.prefix);
            else if (id.indexOf('FeeSchedule') >= 0) window.examFeeScheduleLoad(cfg.prefix);
          };
        });
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

  window.examStaffLoadVerify = async function (prefix) {
    var list = document.getElementById(prefix + 'RvList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;padding:16px;font-size:0.95rem;">Loading students…</p>';
    var statusEl = document.getElementById(prefix + 'RvStatus');
    var branchEl = document.getElementById(prefix + 'RvBranch');
    var q = '/api/exam/attempts?';
    var st = statusEl ? statusEl.value : 'pending';
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
      };
      if (!byStudent.length) {
        list.innerHTML =
          '<div style="padding:28px;text-align:center;opacity:.75;font-size:0.95rem;">' +
          'No student result entries for this filter.</div>';
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
        window.examStaffLoadVerify(rel.getAttribute('data-exam-reload-rv'));
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
      }
      if (secId === 'adExam' || secId === 'facExamModule') {
        ensureExamStaffPanels();
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

  // Re-boot after login
  var _cu = null;
  setInterval(function () {
    if (window.currentUser && window.currentUser !== _cu) {
      _cu = window.currentUser;
      boot();
    }
  }, 1500);

  console.log('[legacy-exam] loaded — results self-entry, multi-challan fees, manual Exam paid tick (no K2 API)');
})();
