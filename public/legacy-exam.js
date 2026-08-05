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

  var GRADES = ['', 'S', 'A', 'B', 'C', 'D', 'E', 'F', 'W', 'X', 'Pass', 'Fail'];
  var SESSIONS = [
    '2020-21 November', '2020-21 April',
    '2021-22 November', '2021-22 April',
    '2022-23 November', '2022-23 April',
    '2023-24 November', '2023-24 April',
    '2024-25 November', '2024-25 April',
    '2025-26 November', '2025-26 April',
    'Other / Supplementary',
  ];

  /* ---------- Student: Results entry ---------- */
  function ensureStuResultsPanel() {
    var panel = document.getElementById('stuResults');
    if (!panel) return;
    if (panel.getAttribute('data-exam-live') === '1') return;
    panel.setAttribute('data-exam-live', '1');
    panel.innerHTML =
      '<div class="info-box">📊 <strong>My Exam Results (C-20)</strong> — Enter pass/fail &amp; grade from your marksheet. ' +
      'Subjects are loaded for <strong>your branch only</strong>. Admission <strong>2020-21 to 2024-25 = C-20</strong>; ' +
      '<strong>2025-26+ = C-25</strong> (coming later). ITI/PUC lateral students skip Year-1 subjects. ' +
      'HOD / Principal / Exam verify entries. Verified rows lock (Admin can unlock).</div>' +
      '<div id="examStuMeta" style="padding:8px 4px;font-size:0.82rem;opacity:.85;"></div>' +
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
      '<select id="examStuSem" onchange="window.examStuPaintForm&&window.examStuPaintForm()" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
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

  window.examStuReload = async function () {
    ensureStuResultsPanel();
    var meta = document.getElementById('examStuMeta');
    var host = document.getElementById('examStuFormHost');
    var list = document.getElementById('examStuList');
    try {
      var data = await api('/api/exam/attempts');
      window._examStuState = data;
      var st = data.student || {};
      if (meta) {
        var pw = data.pathway;
        meta.innerHTML =
          '<strong>' + esc(st.name || '') + '</strong> · ' + esc(st.reg_no || '') +
          ' · ' + esc(st.branch || '') +
          ' · Scheme: <strong>' + esc(st.scheme || '—') + '</strong>' +
          (st.admission_academic_year ? ' · Adm. ' + esc(st.admission_academic_year) : '') +
          (st.entry_type === 'lateral'
            ? ' · <span class="badge pending">Lateral (ITI/PUC) — Year-1 hidden</span>'
            : '') +
          (pw
            ? ' · <span class="badge active">Pathway: ' + esc(pw.label) + ' (' + esc(pw.academic_year || '') + ')</span>'
            : data.pathway_required
              ? ' · <span class="badge pending">Sem 5–6 pathway not assigned by HOD</span>'
              : '') +
          (data.pathway_note
            ? '<div style="margin-top:6px;font-size:0.78rem;opacity:.85;">' + esc(data.pathway_note) + '</div>'
            : '');
      }
      if (st.scheme === 'C-25') {
        if (host) {
          host.innerHTML =
            '<div class="info-box" style="background:#fef3c7;">C-25 syllabus (admission 2025-26+) is not loaded yet. Contact Exam Section.</div>';
        }
      }
      window.examStuPaintForm();
      window.examStuPaintList();
    } catch (e) {
      if (host) host.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
      if (list) list.innerHTML = '';
    }
  };

  window.examStuPaintForm = function () {
    var host = document.getElementById('examStuFormHost');
    if (!host) return;
    var state = window._examStuState || {};
    var sem = Number((document.getElementById('examStuSem') || {}).value || 1);
    var cur = (state.curriculum || []).filter(function (s) { return Number(s.semester) === sem; });
    var hint = document.getElementById('examStuSemHint');
    if (hint) {
      hint.textContent =
        sem >= 5
          ? 'Sem 5–6 subjects come only from the pathway your HOD assigned for this academic year (changes every year).'
          : 'Add one row per exam attempt (e.g. fail Nov 2021-22, pass Apr 2022-23).';
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
  function ensureStuExamFeesPanel() {
    var panel = document.getElementById('stuExamFees');
    if (!panel) return;
    if (panel.getAttribute('data-exam-live') === '1') return;
    panel.setAttribute('data-exam-live', '1');
    panel.innerHTML =
      '<div class="info-box">💰 <strong>Exam Fees (live from your results)</strong> — Fee is calculated from backlog / regular status. ' +
      'Pay via <strong>K2 treasury challan</strong> (offline). There is <strong>no online K2 API</strong> in this portal — ' +
      'enter one or more challan receipts if you paid in parts (e.g. ₹300 + ₹50). ' +
      'Exam Section will <strong>manually tick Paid</strong> after verifying.</div>' +
      '<div class="card" style="padding:16px;margin-bottom:14px;">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">' +
      '<button type="button" class="btn ol" onclick="window.examFeesReload&&window.examFeesReload()">↻ Recalculate</button>' +
      '<label style="font-size:0.8rem;">Fine ₹ <input id="examFeeFine" type="number" min="0" value="0" ' +
      'style="width:90px;padding:6px;border-radius:6px;border:1.5px solid var(--border);" onchange="window.examFeesReload&&window.examFeesReload()" /></label>' +
      '</div>' +
      '<div id="examFeeBreakup" style="font-size:0.85rem;"></div>' +
      '<div style="margin-top:10px;font-size:1.05rem;font-weight:800;color:var(--navy);">Total: <span id="examFeeTotal">₹ 0</span></div>' +
      '<div id="examFeePayStatus" style="margin-top:8px;font-size:0.82rem;"></div>' +
      '</div>' +
      '<div class="card" style="padding:16px;">' +
      '<h3 style="margin:0 0 10px;font-size:0.95rem;color:var(--navy);">K2 Challan receipts (multiple allowed)</h3>' +
      '<div id="examChallanList"></div>' +
      '<button type="button" class="btn ol" style="margin:8px 0;" onclick="window.examAddChallanRow&&window.examAddChallanRow()">+ Add another challan</button>' +
      '<div class="fg" style="margin-top:8px;"><label>Note to Exam Section (optional)</label>' +
      '<input id="examFeeNote" type="text" placeholder="e.g. Paid ₹300 first, balance ₹50 next day" ' +
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
    var fine = Number((document.getElementById('examFeeFine') || {}).value || 0) || 0;
    var box = document.getElementById('examFeeBreakup');
    var tot = document.getElementById('examFeeTotal');
    var stEl = document.getElementById('examFeePayStatus');
    try {
      var data = await api('/api/exam/fees?fine=' + encodeURIComponent(fine));
      var lines = (data.fees && data.fees.lines) || [];
      if (box) {
        if (!lines.length) {
          box.innerHTML = '<p style="opacity:.7;">No fee lines — enter results first (or all passed).</p>';
        } else {
          box.innerHTML =
            '<table style="width:100%;border-collapse:collapse;"><tbody>' +
            lines.map(function (l) {
              return '<tr style="border-bottom:1px solid var(--border);"><td style="padding:6px;">' +
                esc(l.label) + '</td><td style="padding:6px;text-align:right;font-weight:700;">₹ ' +
                l.amount + '</td></tr>';
            }).join('') +
            '</tbody></table>';
        }
      }
      if (tot) tot.textContent = '₹ ' + ((data.fees && data.fees.total) || 0);
      if (stEl) {
        var p = data.payment;
        if (!p) stEl.innerHTML = '<span class="badge pending">Not submitted</span>';
        else {
          stEl.innerHTML =
            'Status: <strong>' + esc(p.status) + '</strong>' +
            (p.challan_total != null ? ' · Challan total ₹ ' + p.challan_total : '') +
            (p.paid_marked_by_name ? ' · Marked by ' + esc(p.paid_marked_by_name) : '') +
            (p.challans && p.challans.length
              ? '<div style="margin-top:6px;font-size:0.75rem;">' +
                p.challans.map(function (c) {
                  return esc(c.receipt_no) + ' — ₹' + c.amount;
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
      alert('Enter at least one K2 receipt number and amount. Use + Add another if you paid twice (e.g. ₹300 + ₹50).');
      return;
    }
    var fine = Number((document.getElementById('examFeeFine') || {}).value || 0) || 0;
    var note = ((document.getElementById('examFeeNote') || {}).value || '').trim();
    try {
      var data = await api('/api/exam/fees', {
        method: 'POST',
        body: { challans: challans, fine: fine, note: note },
      });
      alert(data.message || 'Challan details submitted. Exam Section will verify manually.');
      window.examFeesReload();
    } catch (e) {
      alert('Submit failed: ' + e.message);
    }
  };

  /* ---------- Staff: verify results + fee desk ---------- */
  function ensureExamStaffPanels() {
    // Inject into adExam and facExamModule
    ;[
      { root: 'adExam', prefix: 'adEx' },
      { root: 'facExamModule', prefix: 'facEx' },
    ].forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root) return;
      if (document.getElementById(cfg.prefix + 'ResultsVerify')) return;

      // tab buttons area
      var tabs = root.querySelector('.tabs') || root.querySelector('[class*="tab"]') || null;
      var tabHost = root.querySelector('.card-hd') || root.firstElementChild;
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border);';
      bar.innerHTML =
        '<button type="button" class="btn pr" data-exam-tab="' + cfg.prefix + 'ResultsVerify">✅ Result verification</button>' +
        '<button type="button" class="btn go" data-exam-tab="' + cfg.prefix + 'FeeDesk">💰 Exam fees desk</button>';
      root.insertBefore(bar, root.firstChild);

      var v = document.createElement('div');
      v.id = cfg.prefix + 'ResultsVerify';
      v.style.display = 'none';
      v.innerHTML =
        '<div class="info-box">Verify student-entered exam results. HOD = own branch. Exam / Principal / Admin = all. ' +
        'Verified rows lock for students.</div>' +
        '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        '<select id="' + cfg.prefix + 'RvBranch" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
        '<option value="">All branches</option>' +
        '<option value="CE">Civil</option><option value="CSE">CSE</option>' +
        '<option value="ECE">ECE</option><option value="ME">ME</option></select>' +
        '<select id="' + cfg.prefix + 'RvStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
        '<option value="pending">Pending</option><option value="">All statuses</option>' +
        '<option value="verified">Verified</option><option value="rejected">Rejected</option></select>' +
        '<button type="button" class="btn ol" data-exam-reload-rv="' + cfg.prefix + '">↻ Load</button>' +
        '<button type="button" class="btn go" data-exam-verify-sel="' + cfg.prefix + '">✅ Verify selected</button>' +
        '<button type="button" class="btn" style="background:#991b1b;color:#fff;" data-exam-reject-sel="' + cfg.prefix + '">Reject selected</button>' +
        '</div><div id="' + cfg.prefix + 'RvList" style="padding:10px;overflow-x:auto;"></div>';
      root.appendChild(v);

      var f = document.createElement('div');
      f.id = cfg.prefix + 'FeeDesk';
      f.style.display = 'none';
      f.innerHTML =
        '<div class="info-box">💰 Exam fees desk — <strong>no K2 API</strong>. Students enter challan number(s); ' +
        'you verify payment offline and tick <strong>Paid</strong> / <strong>Partial</strong> / <strong>Due</strong>. ' +
        'Multiple challans supported (e.g. ₹300 + ₹50).</div>' +
        '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<select id="' + cfg.prefix + 'FdBranch" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
        '<option value="">All branches</option>' +
        '<option value="civil">Civil</option><option value="computer">CSE</option>' +
        '<option value="electron">ECE</option><option value="mech">ME</option></select>' +
        '<select id="' + cfg.prefix + 'FdStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
        '<option value="">All</option><option value="challan_submitted">Challan submitted</option>' +
        '<option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option></select>' +
        '<button type="button" class="btn ol" data-exam-reload-fd="' + cfg.prefix + '">↻ Load</button></div>' +
        '<div id="' + cfg.prefix + 'FdList" style="padding:10px;overflow-x:auto;"></div>';
      root.appendChild(f);

      bar.querySelectorAll('[data-exam-tab]').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute('data-exam-tab');
          v.style.display = id.indexOf('Results') >= 0 ? '' : 'none';
          f.style.display = id.indexOf('Fee') >= 0 ? '' : 'none';
          if (id.indexOf('Results') >= 0) window.examStaffLoadVerify(cfg.prefix);
          else window.examStaffLoadFees(cfg.prefix);
        };
      });
    });

    // HOD: Result verification + Pathway manager (per academic year)
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
          '<div class="info-box">Verify branch student result entries.</div>' +
          '<div style="padding:10px;display:flex;gap:8px;">' +
          '<select id="hodExRvStatus" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
          '<option value="pending">Pending</option><option value="">All</option></select>' +
          '<button type="button" class="btn ol" data-exam-reload-rv="hodEx">↻ Load</button>' +
          '<button type="button" class="btn go" data-exam-verify-sel="hodEx">✅ Verify selected</button>' +
          '<button type="button" class="btn" style="background:#991b1b;color:#fff;" data-exam-reject-sel="hodEx">Reject selected</button>' +
          '</div><div id="hodExRvList" style="padding:10px;"></div>';
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
    }

    // Admin / Exam / Principal: pathway tab on exam shell
    ;[
      { root: 'adExam', prefix: 'adEx' },
      { root: 'facExamModule', prefix: 'facEx' },
    ].forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root || document.getElementById(cfg.prefix + 'Pathways')) return;
      var bar = root.querySelector('[data-exam-tab]') && root.querySelector('[data-exam-tab]').parentElement;
      if (bar) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ol';
        btn.setAttribute('data-exam-tab', cfg.prefix + 'Pathways');
        btn.textContent = '🛤️ Pathways';
        bar.appendChild(btn);
        btn.onclick = function () {
          var v = document.getElementById(cfg.prefix + 'ResultsVerify');
          var f = document.getElementById(cfg.prefix + 'FeeDesk');
          var p = document.getElementById(cfg.prefix + 'Pathways');
          if (v) v.style.display = 'none';
          if (f) f.style.display = 'none';
          if (p) {
            p.style.display = '';
            window.examPathwayLoadStaff && window.examPathwayLoadStaff(cfg.prefix);
          }
        };
      }
      if (!document.getElementById(cfg.prefix + 'Pathways')) {
        var pdiv = document.createElement('div');
        pdiv.id = cfg.prefix + 'Pathways';
        pdiv.style.display = 'none';
        pdiv.innerHTML =
          '<div class="info-box">Manage Sem 5–6 pathways by branch and academic year (same as HOD).</div>' +
          '<div style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:end;">' +
          '<div><label style="font-size:0.72rem;">Branch</label><br>' +
          '<select id="' + cfg.prefix + 'PwBranch" style="padding:8px;border-radius:8px;border:1.5px solid var(--border);">' +
          '<option value="CSE">CSE</option><option value="CE">Civil</option>' +
          '<option value="ECE">ECE</option><option value="ME">ME</option></select></div>' +
          '<div><label style="font-size:0.72rem;">Academic year</label><br>' +
          '<input id="' + cfg.prefix + 'PwYear" type="text" placeholder="2025-26" ' +
          'style="padding:8px;border-radius:8px;border:1.5px solid var(--border);width:110px;" /></div>' +
          '<button type="button" class="btn ol" onclick="window.examPathwayLoadStaff&&window.examPathwayLoadStaff(\'' +
          cfg.prefix + '\')">↻ Load</button>' +
          '<button type="button" class="btn pr" onclick="window.examPathwaySaveOfferingsStaff&&window.examPathwaySaveOfferingsStaff(\'' +
          cfg.prefix + '\')">💾 Save offerings</button>' +
          '</div>' +
          '<div id="' + cfg.prefix + 'PwOfferings" style="padding:10px;"></div>' +
          '<div id="' + cfg.prefix + 'PwStudents" style="padding:10px;"></div>' +
          '<div style="padding:10px;"><button type="button" class="btn go" ' +
          'onclick="window.examPathwaySaveAssignmentsStaff&&window.examPathwaySaveAssignmentsStaff(\'' +
          cfg.prefix + '\')">💾 Save assignments</button></div>';
        root.appendChild(pdiv);
      }
    });
  }

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

  window.examStaffLoadVerify = async function (prefix) {
    var list = document.getElementById(prefix + 'RvList');
    if (!list) return;
    list.innerHTML = '<p style="opacity:.7;">Loading…</p>';
    var statusEl = document.getElementById(prefix + 'RvStatus');
    var branchEl = document.getElementById(prefix + 'RvBranch');
    var q = '/api/exam/attempts?';
    var st = statusEl ? statusEl.value : 'pending';
    if (st) q += 'status=' + encodeURIComponent(st) + '&';
    if (branchEl && branchEl.value) q += 'branch=' + encodeURIComponent(branchEl.value) + '&';
    try {
      var data = await api(q);
      var attempts = data.attempts || [];
      if (!attempts.length) {
        list.innerHTML = '<p style="opacity:.7;">No rows.</p>';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
        '<th></th><th>Reg</th><th>Sem</th><th>Code</th><th>Session</th><th>Result</th><th>Grade</th><th>Status</th></tr></thead><tbody>';
      attempts.forEach(function (a) {
        html += '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:4px;"><input type="checkbox" class="exam-rv-cb" data-id="' + a.id + '" ' +
          (a.status === 'verified' ? 'disabled' : '') + ' /></td>' +
          '<td style="padding:4px;font-family:monospace;font-size:0.7rem;">' + esc(a.reg_no) + '</td>' +
          '<td style="padding:4px;">' + a.semester + '</td>' +
          '<td style="padding:4px;" title="' + esc(a.subject_name) + '">' + esc(a.subject_code) + '</td>' +
          '<td style="padding:4px;">' + esc(a.exam_session) + '</td>' +
          '<td style="padding:4px;">' + esc(a.result) + '</td>' +
          '<td style="padding:4px;">' + esc(a.grade) + '</td>' +
          '<td style="padding:4px;">' + esc(a.status) + '</td></tr>';
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<p style="color:#991b1b;">' + esc(e.message) + '</p>';
    }
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
        var pfx = ver.getAttribute('data-exam-verify-sel');
        var ids = [];
        document.querySelectorAll('#' + pfx + 'RvList .exam-rv-cb:checked').forEach(function (cb) {
          ids.push(Number(cb.getAttribute('data-id')));
        });
        if (!ids.length) {
          alert('Select rows first');
          return;
        }
        api('/api/exam/attempts', { method: 'PATCH', body: { action: 'verify', ids: ids } })
          .then(function () {
            alert('Verified ' + ids.length + ' row(s). Locked for student edits.');
            window.examStaffLoadVerify(pfx);
          })
          .catch(function (err) { alert(err.message); });
        return;
      }
      var rej = t.closest('[data-exam-reject-sel]');
      if (rej) {
        var pfx2 = rej.getAttribute('data-exam-reject-sel');
        var ids2 = [];
        document.querySelectorAll('#' + pfx2 + 'RvList .exam-rv-cb:checked').forEach(function (cb) {
          ids2.push(Number(cb.getAttribute('data-id')));
        });
        if (!ids2.length) {
          alert('Select rows first');
          return;
        }
        var note = prompt('Reject reason (optional)') || 'Rejected';
        api('/api/exam/attempts', { method: 'PATCH', body: { action: 'reject', ids: ids2, note: note } })
          .then(function () {
            alert('Rejected.');
            window.examStaffLoadVerify(pfx2);
          })
          .catch(function (err) { alert(err.message); });
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
