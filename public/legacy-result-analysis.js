/**
 * Result Analysis — sem / year / subject pass–fail % (live).
 * Injects into Result Management (HOD) and Exam Module tabs.
 */
(function () {
  'use strict';

  function esc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function roleOk() {
    var u = window.currentUser || {};
    return ['admin', 'principal', 'exam', 'acm', 'hod'].indexOf(u.role) >= 0;
  }

  async function api(path) {
    var r = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + r.status));
    return data;
  }

  function pctBar(passPct, failPct) {
    var p = Math.max(0, Math.min(100, Number(passPct) || 0));
    var f = Math.max(0, Math.min(100, Number(failPct) || 0));
    return (
      '<div style="display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--border);min-width:80px;">' +
      '<div style="width:' + p + '%;background:#16a34a;" title="Pass ' + p + '%"></div>' +
      '<div style="width:' + f + '%;background:#dc2626;" title="Fail ' + f + '%"></div>' +
      '</div>'
    );
  }

  function kpiCard(label, value, sub, color) {
    return (
      '<div class="card" style="flex:1;min-width:140px;padding:14px 16px;border-left:4px solid ' +
      (color || 'var(--primary)') + ';">' +
      '<div style="font-size:0.72rem;opacity:.75;font-weight:600;">' + esc(label) + '</div>' +
      '<div style="font-size:1.45rem;font-weight:800;margin-top:4px;">' + esc(value) + '</div>' +
      (sub ? '<div style="font-size:0.75rem;opacity:.8;margin-top:2px;">' + esc(sub) + '</div>' : '') +
      '</div>'
    );
  }

  function tableAgg(rows, titleCol) {
    if (!rows || !rows.length) {
      return '<p style="opacity:.7;padding:8px;">No data for current filters.</p>';
    }
    var html =
      '<div style="overflow:auto;"><table style="width:100%;min-width:520px;"><thead><tr>' +
      '<th>' + esc(titleCol) + '</th><th>Total</th><th>Pass</th><th>Fail</th>' +
      '<th>Pass %</th><th>Fail %</th><th>Avg SGPA</th><th>Ratio</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html +=
        '<tr>' +
        '<td><strong>' + esc(r.label) + '</strong></td>' +
        '<td style="text-align:center;">' + r.total + '</td>' +
        '<td style="text-align:center;color:#16a34a;font-weight:700;">' + r.pass + '</td>' +
        '<td style="text-align:center;color:#dc2626;font-weight:700;">' + r.fail + '</td>' +
        '<td style="text-align:center;">' + r.pass_pct + '%</td>' +
        '<td style="text-align:center;">' + r.fail_pct + '%</td>' +
        '<td style="text-align:center;">' + (r.avg_sgpa != null ? r.avg_sgpa : '—') + '</td>' +
        '<td style="min-width:100px;">' + pctBar(r.pass_pct, r.fail_pct) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function tableSubjects(rows) {
    if (!rows || !rows.length) {
      return '<p style="opacity:.7;padding:8px;">No subject rows for current filters.</p>';
    }
    var html =
      '<div style="overflow:auto;max-height:480px;"><table style="width:100%;min-width:720px;"><thead><tr>' +
      '<th>Code</th><th>Subject</th><th>Sem</th><th>Branch</th><th>Session</th>' +
      '<th>Appeared</th><th>Pass</th><th>Fail</th><th>Pass %</th><th>Fail %</th><th>Ratio</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html +=
        '<tr>' +
        '<td style="font-family:monospace;font-size:0.78rem;">' + esc(r.code || '') + '</td>' +
        '<td>' + esc(r.name || r.label) + '</td>' +
        '<td style="text-align:center;">' + esc(r.semester != null ? r.semester : '') + '</td>' +
        '<td style="text-align:center;">' + esc(r.branch || '') + '</td>' +
        '<td style="font-size:0.78rem;">' + esc(r.session || '') + '</td>' +
        '<td style="text-align:center;">' + r.total + '</td>' +
        '<td style="text-align:center;color:#16a34a;font-weight:700;">' + r.pass + '</td>' +
        '<td style="text-align:center;color:#dc2626;font-weight:700;">' + r.fail + '</td>' +
        '<td style="text-align:center;">' + r.pass_pct + '%</td>' +
        '<td style="text-align:center;">' + r.fail_pct + '%</td>' +
        '<td style="min-width:90px;">' + pctBar(r.pass_pct, r.fail_pct) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function panelHtml(pid) {
    var u = window.currentUser || {};
    var hodLock = u.role === 'hod';
    return (
      '<div class="info-box">📈 <strong>Result Analysis (live)</strong> — Semester-wise, year-wise (admission batch &amp; study year), ' +
      'and subject-wise pass / fail percentages from published ledgers and verified exam attempts. ' +
      (hodLock ? 'HOD view is limited to your branch. ' : '') +
      'Refresh anytime for current DB data.</div>' +
      '<div class="card" style="padding:14px;margin-bottom:12px;">' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Exam session</label><br>' +
      '<select id="' + pid + '_session" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);min-width:160px;">' +
      '<option value="">All sessions</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Semester</label><br>' +
      '<select id="' + pid + '_sem" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="">All</option>' +
      '<option value="1">Sem 1</option><option value="2">Sem 2</option><option value="3">Sem 3</option>' +
      '<option value="4">Sem 4</option><option value="5">Sem 5</option><option value="6">Sem 6</option>' +
      '</select></div>' +
      (hodLock
        ? ''
        : '<div><label style="font-size:0.72rem;font-weight:700;">Branch</label><br>' +
          '<select id="' + pid + '_branch" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
          '<option value="">All</option>' +
          '<option value="CE">Civil</option><option value="CSE">CSE</option>' +
          '<option value="ECE">ECE</option><option value="ME">ME</option></select></div>') +
      '<div><label style="font-size:0.72rem;font-weight:700;">Scheme</label><br>' +
      '<select id="' + pid + '_scheme" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="" selected>All schemes</option>' +
      '<option value="C-20">C-20 only</option><option value="C-25">C-25 only</option></select></div>' +
      '<div><label style="font-size:0.72rem;font-weight:700;">Data source</label><br>' +
      '<select id="' + pid + '_source" style="padding:8px 10px;border-radius:8px;border:1.5px solid var(--border);">' +
      '<option value="both">Published + Verified</option>' +
      '<option value="published">Published results only</option>' +
      '<option value="verified">Verified attempts only</option></select></div>' +
      '<button type="button" class="btn pr" onclick="window.resAnalysisLoad&&window.resAnalysisLoad(\'' + pid + '\')">↻ Analyze</button>' +
      '</div></div>' +
      '<div id="' + pid + '_meta" style="font-size:0.78rem;opacity:.8;margin-bottom:10px;"></div>' +
      '<div id="' + pid + '_kpis" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;"></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Semester-wise</h3></div>' +
      '<div id="' + pid + '_sem_tbl" style="padding:10px;"></div></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Admission year (batch)</h3></div>' +
      '<div id="' + pid + '_batch_tbl" style="padding:10px;"></div></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Study year (1st / 2nd / 3rd)</h3></div>' +
      '<div id="' + pid + '_year_tbl" style="padding:10px;"></div></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Branch-wise</h3></div>' +
      '<div id="' + pid + '_br_tbl" style="padding:10px;"></div></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Session-wise</h3></div>' +
      '<div id="' + pid + '_sess_tbl" style="padding:10px;"></div></div>' +
      '<div class="card" style="margin-bottom:12px;"><div class="card-hd"><h3>Subject-wise</h3></div>' +
      '<div id="' + pid + '_sub_tbl" style="padding:10px;"></div></div>' +
      '<div class="card"><div class="card-hd"><h3>Grade distribution (subjects)</h3></div>' +
      '<div id="' + pid + '_grade" style="padding:10px;"></div></div>'
    );
  }

  function attrEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  /** Ensure analysis markup exists (facResults rebuild can leave empty #frAnalysis). */
  function ensureAnalysisMarkup(pid) {
    var host = document.getElementById(pid);
    if (!host) return false;
    if (!document.getElementById(pid + '_session')) {
      host.innerHTML = panelHtml(pid);
    }
    return true;
  }

  window.resAnalysisLoad = async function (pid) {
    if (!ensureAnalysisMarkup(pid)) return;
    var sessionEl = document.getElementById(pid + '_session');
    var semEl = document.getElementById(pid + '_sem');
    var branchEl = document.getElementById(pid + '_branch');
    var schemeEl = document.getElementById(pid + '_scheme');
    var sourceEl = document.getElementById(pid + '_source');

    // Capture filter values BEFORE any DOM rewrite
    var wantSession = sessionEl ? sessionEl.value : '';
    var wantSem = semEl ? semEl.value : '';
    var wantBranch = branchEl ? branchEl.value : '';
    var wantScheme = schemeEl ? schemeEl.value : '';
    var wantSource = sourceEl ? sourceEl.value : 'both';

    var qs = new URLSearchParams();
    if (wantSession) qs.set('session', wantSession);
    if (wantSem) qs.set('sem', wantSem);
    if (wantBranch) qs.set('branch', wantBranch);
    if (wantScheme) qs.set('scheme', wantScheme);
    if (wantSource) qs.set('source', wantSource);

    var meta = document.getElementById(pid + '_meta');
    var kpis = document.getElementById(pid + '_kpis');
    if (meta) {
      meta.innerHTML =
        'Loading… filters: session=<strong>' +
        esc(wantSession || 'All') +
        '</strong> sem=<strong>' +
        esc(wantSem || 'All') +
        '</strong> scheme=<strong>' +
        esc(wantScheme || 'All') +
        '</strong> source=<strong>' +
        esc(wantSource) +
        '</strong>';
    }
    if (kpis) kpis.innerHTML = '';

    try {
      var data = await api('/api/results/analysis?' + qs.toString());
      // Re-read elements after possible panel repair
      sessionEl = document.getElementById(pid + '_session');
      semEl = document.getElementById(pid + '_sem');
      branchEl = document.getElementById(pid + '_branch');
      schemeEl = document.getElementById(pid + '_scheme');
      sourceEl = document.getElementById(pid + '_source');

      // Populate sessions without losing selection
      if (sessionEl && Array.isArray(data.sessions)) {
        var opts = '<option value="">All sessions</option>';
        var hasCur = !wantSession;
        data.sessions.forEach(function (s) {
          if (s === wantSession) hasCur = true;
          opts +=
            '<option value="' +
            attrEsc(s) +
            '"' +
            (s === wantSession ? ' selected' : '') +
            '>' +
            esc(s) +
            '</option>';
        });
        // Keep a custom session value if API list is incomplete
        if (wantSession && !hasCur) {
          opts +=
            '<option value="' +
            attrEsc(wantSession) +
            '" selected>' +
            esc(wantSession) +
            '</option>';
        }
        sessionEl.innerHTML = opts;
        try {
          sessionEl.value = wantSession || '';
        } catch (e1) { /* ignore */ }
      }
      if (semEl) {
        try {
          semEl.value = wantSem || '';
        } catch (e2) { /* ignore */ }
      }
      if (branchEl) {
        try {
          branchEl.value = wantBranch || '';
        } catch (e3) { /* ignore */ }
      }
      if (schemeEl) {
        try {
          schemeEl.value = wantScheme || '';
        } catch (e4) { /* ignore */ }
      }
      if (sourceEl) {
        try {
          sourceEl.value = wantSource || 'both';
        } catch (e5) { /* ignore */ }
      }

      var s = data.summary || {};
      var f = (data.filters && data.filters.applied) || {};
      if (meta) {
        meta.innerHTML =
          'Live at <strong>' +
          esc(new Date(data.live_at).toLocaleString()) +
          '</strong> · ' +
          'Applied: session=<strong>' +
          esc(f.session || wantSession || 'All') +
          '</strong> · sem=<strong>' +
          esc(f.sem || wantSem || 'All') +
          '</strong> · scheme=<strong>' +
          esc(f.scheme || wantScheme || 'All') +
          '</strong> · source=<strong>' +
          esc(f.source || wantSource) +
          '</strong> · ' +
          'Published matched: ' +
          esc(String(f.published_matched != null ? f.published_matched : s.published_rows_scanned || 0)) +
          ' · Verified matched: ' +
          esc(String(f.attempts_matched != null ? f.attempts_matched : s.verified_attempts_scanned || 0)) +
          (data.filters && data.filters.hod_locked_branch ? ' · <em>Branch locked (HOD)</em>' : '');
      }
      if (kpis) {
        kpis.innerHTML =
          kpiCard('Result rows', s.student_result_rows || 0, (s.distinct_students || 0) + ' students', '#2563eb') +
          kpiCard('Pass', s.pass || 0, (s.pass_pct || 0) + '%', '#16a34a') +
          kpiCard('Fail', s.fail || 0, (s.fail_pct || 0) + '%', '#dc2626') +
          kpiCard('Pass %', (s.pass_pct || 0) + '%', 'of filtered rows', '#15803d') +
          kpiCard('Fail %', (s.fail_pct || 0) + '%', 'of filtered rows', '#b91c1c') +
          kpiCard('Avg SGPA', s.avg_sgpa != null ? s.avg_sgpa : '—', 'from published', '#7c3aed') +
          kpiCard('Subject attempts', s.subject_rows || 0, 'in subject table', '#0891b2');
      }
      // Helpful zero-state
      if ((s.student_result_rows || 0) === 0 && meta) {
        var tip = '';
        if (wantSession === 'May 2026' && wantScheme === 'C-20') {
          tip =
            ' <span style="color:#b45309;">Tip: <strong>May 2026</strong> is C-25 Sem 2. Use scheme <strong>C-25</strong> or <strong>All schemes</strong>, or pick session <strong>Nov/Dec-2025</strong> / <strong>Apr/May-2026</strong> for C-20.</span>';
        } else if (wantScheme === 'C-20' || wantScheme === 'C-25') {
          tip =
            ' <span style="color:#b45309;">Tip: try scheme <strong>All schemes</strong>, or change exam session.</span>';
        } else {
          tip =
            ' <span style="color:#b45309;">Tip: set Exam session to <strong>All sessions</strong> to see everything for your branch.</span>';
        }
        meta.innerHTML += tip;
      }

      var el;
      el = document.getElementById(pid + '_sem_tbl');
      if (el) el.innerHTML = tableAgg(data.by_semester, 'Semester');
      el = document.getElementById(pid + '_batch_tbl');
      if (el) el.innerHTML = tableAgg(data.by_admission_year, 'Admission year');
      el = document.getElementById(pid + '_year_tbl');
      if (el) el.innerHTML = tableAgg(data.by_study_year, 'Study year');
      el = document.getElementById(pid + '_br_tbl');
      if (el) el.innerHTML = tableAgg(data.by_branch, 'Branch');
      el = document.getElementById(pid + '_sess_tbl');
      if (el) el.innerHTML = tableAgg(data.by_session, 'Session');
      el = document.getElementById(pid + '_sub_tbl');
      if (el) el.innerHTML = tableSubjects(data.by_subject);
      el = document.getElementById(pid + '_grade');
      if (el) {
        var grades = data.by_grade || [];
        if (!grades.length) el.innerHTML = '<p style="opacity:.7;">No grade data.</p>';
        else {
          el.innerHTML =
            '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
            grades
              .map(function (g) {
                return (
                  '<span class="badge" style="padding:6px 10px;font-size:0.85rem;">' +
                  esc(g.grade) + ': <strong>' + g.count + '</strong></span>'
                );
              })
              .join('') +
            '</div>';
        }
      }
    } catch (e) {
      if (meta) meta.innerHTML = '<span style="color:#dc2626;">' + esc(e.message || e) + '</span>';
    }
  };

  function ensureFrAnalysisTab() {
    var root = document.getElementById('facResults');
    if (!root) return;
    var tabs = root.querySelector('.tabs');
    var hasBtn = tabs && Array.prototype.some.call(tabs.querySelectorAll('.tab'), function (t) {
      return /Result Analysis/i.test(t.textContent || '');
    });
    if (tabs && !hasBtn) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.textContent = '📈 Result Analysis';
      btn.onclick = function () {
        window.showFacResTab && window.showFacResTab('frAnalysis', btn);
        window.resAnalysisLoad && window.resAnalysisLoad('frAnalysis');
      };
      tabs.appendChild(btn);
    }
    var panel = document.getElementById('frAnalysis');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'frAnalysis';
      panel.style.display = 'none';
      root.appendChild(panel);
    }
    // Always restore markup if empty or missing filters (after facResults rebuild)
    if (!document.getElementById('frAnalysis_session')) {
      panel.innerHTML = panelHtml('frAnalysis');
    }
  }

  function ensureExamAnalysisTab() {
    // Admin exam shell uses showExamTab('exResults'...)
    var hosts = [
      { parentSel: null, tabsFind: function () {
        // find tab bar that has exResults
        var btn = document.querySelector('[onclick*="exResults"]');
        return btn ? btn.closest('.tabs') : null;
      }, panelParent: function () {
        var el = document.getElementById('exResults');
        return el ? el.parentElement : null;
      }, id: 'exAnalysis' },
    ];
    hosts.forEach(function (h) {
      if (document.getElementById(h.id)) return;
      var tabs = h.tabsFind();
      var parent = h.panelParent();
      if (!tabs || !parent) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.textContent = '📈 Result Analysis';
      btn.onclick = function () {
        if (typeof window.showExamTab === 'function') {
          // extend visibility
          window.showExamTab(h.id, btn);
        } else {
          ;['exResults', 'exPDC', 'exAttShort', 'exFees', 'exKeylist', 'exNotEligible', 'exAnalysis'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = id === h.id ? 'block' : 'none';
          });
          tabs.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('act'); });
          btn.classList.add('act');
        }
        window.resAnalysisLoad && window.resAnalysisLoad(h.id);
      };
      tabs.appendChild(btn);
      var panel = document.createElement('div');
      panel.id = h.id;
      panel.style.display = 'none';
      panel.innerHTML = panelHtml(h.id);
      parent.appendChild(panel);
    });
  }

  function patchShowExamTab() {
    if (window.__resAnalysisExamPatched) return;
    var orig = window.showExamTab;
    if (typeof orig !== 'function') return;
    window.__resAnalysisExamPatched = true;
    window.showExamTab = function (tabId, btn) {
      var el = document.getElementById('exAnalysis');
      if (el) el.style.display = 'none';
      orig(tabId, btn);
      if (tabId === 'exAnalysis') {
        if (el) el.style.display = 'block';
        // hide others in case orig didn't know about us
        ;['exResults', 'exPDC', 'exAttShort', 'exFees', 'exKeylist', 'exNotEligible'].forEach(function (id) {
          var x = document.getElementById(id);
          if (x) x.style.display = 'none';
        });
      }
    };
  }

  function patchShowFacResTab() {
    if (window.__resAnalysisFacPatched) return;
    var orig = window.showFacResTab;
    if (typeof orig !== 'function') return;
    window.__resAnalysisFacPatched = true;
    window.showFacResTab = function (tabId, btn) {
      var el = document.getElementById('frAnalysis');
      if (el) el.style.display = 'none';
      orig(tabId, btn);
      if (tabId === 'frAnalysis') {
        ;['frView', 'frEdit'].forEach(function (id) {
          var x = document.getElementById(id);
          if (x) x.style.display = 'none';
        });
        if (el) el.style.display = 'block';
        if (btn) {
          var tabs = btn.closest('.tabs');
          if (tabs) {
            tabs.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('act'); });
            btn.classList.add('act');
          }
        }
      }
    };
  }

  /** Also inject into adExam / facExamModule staff bars (legacy-exam.js style). */
  function ensureStaffExamAnalysis() {
    ;[
      { root: 'adExam', prefix: 'adEx' },
      { root: 'facExamModule', prefix: 'facEx' },
    ].forEach(function (cfg) {
      var root = document.getElementById(cfg.root);
      if (!root) return;
      var id = cfg.prefix + 'ResultAnalysis';
      if (document.getElementById(id)) return;
      var bar = root.querySelector('[data-exam-tab]') && root.querySelector('[data-exam-tab]').parentElement;
      if (!bar) {
        // create mini bar if missing
        bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border);';
        root.insertBefore(bar, root.firstChild);
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ol';
      btn.setAttribute('data-exam-tab', id);
      btn.textContent = '📈 Result Analysis';
      bar.appendChild(btn);
      var panel = document.createElement('div');
      panel.id = id;
      panel.style.display = 'none';
      panel.innerHTML = panelHtml(id);
      root.appendChild(panel);
      btn.onclick = function () {
        root.querySelectorAll('[id^="' + cfg.prefix + '"]').forEach(function (p) {
          if (p.id && p.id.indexOf(cfg.prefix) === 0 && p.tagName === 'DIV') {
            // hide sibling analysis / verify panels
          }
        });
        ;[cfg.prefix + 'ResultsVerify', cfg.prefix + 'FeeDesk', cfg.prefix + 'Pathways', id].forEach(function (pid) {
          var el = document.getElementById(pid);
          if (el) el.style.display = pid === id ? '' : 'none';
        });
        window.resAnalysisLoad && window.resAnalysisLoad(id);
      };
    });
  }

  function boot() {
    if (!roleOk()) return;
    patchShowExamTab();
    patchShowFacResTab();
    ensureFrAnalysisTab();
    ensureExamAnalysisTab();
    ensureStaffExamAnalysis();
  }

  // Re-run on login / section open
  var _origShowSec = window.showSec;
  if (typeof _origShowSec === 'function' && !window.__resAnalysisShowSec) {
    window.__resAnalysisShowSec = true;
    window.showSec = function (secId, el) {
      _origShowSec(secId, el);
      setTimeout(boot, 50);
      if (secId === 'facResults' || secId === 'facResModule' || secId === 'adExam' || secId === 'facExamModule') {
        setTimeout(function () {
          boot();
          if (secId === 'facResults' || secId === 'facResModule') {
            ensureFrAnalysisTab();
          }
        }, 100);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  } else {
    setTimeout(boot, 400);
  }
  // late boot after bridge login (slow poll — only when shells exist)
  setInterval(function () {
    if (document.hidden) return;
    if (!roleOk()) return;
    if (!document.getElementById('facResults') && !document.getElementById('adExam') && !document.getElementById('facExamModule')) return;
    if (roleOk() && !document.getElementById('frAnalysis') && document.getElementById('facResults')) boot();
    if (roleOk() && !document.getElementById('exAnalysis') && document.querySelector('[onclick*="exResults"]')) boot();
  }, 12000);
})();
