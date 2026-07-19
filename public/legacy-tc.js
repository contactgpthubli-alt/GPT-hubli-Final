/* =============================================================
 * GPT Hubli — Transfer Certificate (ACM Module)
 * Issue TC form, A4 print, TC Register, template editor, Proceed
 * ============================================================= */
(function () {
  'use strict';

  var TC_STATE = {
    template: null,
    registerId: null,
    certRequestId: null,
    form: {},
  };

  function esc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function apiQuiet(path, opts) {
    return fetch(path, Object.assign({
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    }, opts || {})).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var msg = (data && data.error) ? data.error : ('Request failed ' + r.status);
          return { __error: msg, data: data };
        }
        return data;
      });
    }).catch(function (e) {
      return { __error: String(e && e.message || e) };
    });
  }

  function L(key, side) {
    var tpl = TC_STATE.template || {};
    var labels = tpl.labels || {};
    var row = labels[key] || {};
    if (side === 'kn') return row.kn || '';
    return row.en || key;
  }

  function H(key) {
    var tpl = TC_STATE.template || {};
    var header = tpl.header || {};
    return header[key] != null ? String(header[key]) : '';
  }

  function F(key) {
    var tpl = TC_STATE.template || {};
    var footer = tpl.footer || {};
    return footer[key] != null ? String(footer[key]) : '';
  }

  /* ---------- number → words (DOB) ---------- */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function twoDigitWords(n) {
    n = n | 0;
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }

  function yearWords(y) {
    y = y | 0;
    if (y === 2000) return 'Two Thousand';
    if (y > 2000 && y < 2100) {
      var rest = y - 2000;
      if (rest < 10) return 'Two Thousand ' + ONES[rest];
      return 'Two Thousand ' + twoDigitWords(rest);
    }
    if (y >= 1900 && y < 2000) {
      var r = y - 1900;
      if (r === 0) return 'Nineteen Hundred';
      return 'Nineteen ' + twoDigitWords(r);
    }
    return String(y);
  }

  function dobToWords(dateStr) {
    if (!dateStr) return '';
    var d = null;
    var s = String(dateStr).trim();
    // accept YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    else {
      m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    }
    if (!d || isNaN(d.getTime())) return s;
    var day = d.getDate();
    var mon = MONTHS[d.getMonth()];
    var yr = d.getFullYear();
    var dayW = twoDigitWords(day);
    // ordinal-ish plain
    return dayW + ' ' + mon + ' ' + yearWords(yr);
  }

  function formatDobDisplay(dateStr) {
    if (!dateStr) return '';
    var s = String(dateStr).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      var dd = String(m[3]).padStart(2, '0');
      var mm = String(m[2]).padStart(2, '0');
      return dd + '-' + mm + '-' + m[1];
    }
    return s;
  }

  function pickExtra(extra, keys) {
    if (!extra || typeof extra !== 'object') return '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      // exact
      if (extra[k] != null && String(extra[k]).trim() !== '') return String(extra[k]).trim();
      // case-insensitive
      var found = Object.keys(extra).find(function (ek) {
        return ek.replace(/\s+/g, ' ').trim().toLowerCase() === k.replace(/\s+/g, ' ').trim().toLowerCase();
      });
      if (found && extra[found] != null && String(extra[found]).trim() !== '') return String(extra[found]).trim();
    }
    return '';
  }

  /* ---------- panel hosts ---------- */
  function isRootAdminUser() {
    var u = window.currentUser;
    return !!(u && u.role === 'admin');
  }

  function ensureTcPanels() {
    // Admin shell (Root Admin + ACM scoped admin both use adACM)
    ensureTabsAndHosts('adACM', 'showAdACMTab', 'ad');
    // Faculty ACM workspace
    ensureTabsAndHosts('facACM', 'showFacACMTab', 'fac');
    // Always re-apply visibility: TC Template is Root Admin only (not ACM)
    applyTcTemplateVisibility();
  }

  function applyTcTemplateVisibility() {
    var allow = isRootAdminUser();
    document.querySelectorAll('[data-tc-tab="template"]').forEach(function (btn) {
      btn.style.display = allow ? '' : 'none';
    });
    ;['adAcmTcTpl', 'facAcmTcTpl'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (!allow) {
        el.style.display = 'none';
        el.innerHTML = ''; // strip editor if ACM somehow opened it
      }
    });
  }

  function ensureTabsAndHosts(rootId, showFn, prefix) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var tabs = root.querySelector('.tabs');
    if (!tabs) return;

    if (!document.getElementById(prefix + 'AcmTc')) {
      var tcTab = document.createElement('button');
      tcTab.className = 'tab';
      tcTab.type = 'button';
      tcTab.setAttribute('data-tc-tab', 'issue');
      tcTab.textContent = '📄 Issue TC';
      tcTab.onclick = function () { window[showFn](prefix + 'AcmTc', tcTab); if (window.mountTcForm) window.mountTcForm(); };

      var regTab = document.createElement('button');
      regTab.className = 'tab';
      regTab.type = 'button';
      regTab.setAttribute('data-tc-tab', 'register');
      regTab.textContent = '📒 TC Register';
      regTab.onclick = function () { window[showFn](prefix + 'AcmTcReg', regTab); if (window.renderTcRegister) window.renderTcRegister(); };

      // Template tab only for Root Admin — never for ACM staff
      var tplTab = null;
      if (isRootAdminUser()) {
        tplTab = document.createElement('button');
        tplTab.className = 'tab';
        tplTab.type = 'button';
        tplTab.setAttribute('data-tc-tab', 'template');
        tplTab.textContent = '✏️ TC Template';
        tplTab.onclick = function () {
          if (!isRootAdminUser()) {
            alert('TC Template is available to Root Admin only.');
            return;
          }
          window[showFn](prefix + 'AcmTcTpl', tplTab);
          if (window.renderTcTemplateEditor) window.renderTcTemplateEditor();
        };
      }

      tabs.appendChild(tcTab);
      tabs.appendChild(regTab);
      if (tplTab) tabs.appendChild(tplTab);

      var issue = document.createElement('div');
      issue.id = prefix + 'AcmTc';
      issue.style.display = 'none';
      issue.innerHTML = '<div data-tc-form-host="1"></div>';

      var reg = document.createElement('div');
      reg.id = prefix + 'AcmTcReg';
      reg.style.display = 'none';
      reg.innerHTML = '<div data-tc-register-host="1"></div>';

      root.appendChild(issue);
      root.appendChild(reg);

      // Host panel only for Root Admin
      if (isRootAdminUser()) {
        var tpl = document.createElement('div');
        tpl.id = prefix + 'AcmTcTpl';
        tpl.style.display = 'none';
        tpl.innerHTML = '<div data-tc-template-host="1"></div>';
        root.appendChild(tpl);
      }
    } else {
      // Panels already exist (e.g. created while admin was logged in) — hide template for ACM
      applyTcTemplateVisibility();
    }
  }

  /* ---------- load template ---------- */
  async function loadTemplate() {
    var data = await apiQuiet('/api/tc?kind=template&_ts=' + Date.now());
    if (data && data.template) {
      TC_STATE.template = {
        labels: data.template.labels || {},
        header: data.template.header || {},
        footer: data.template.footer || {},
      };
    } else if (!TC_STATE.template) {
      TC_STATE.template = { labels: {}, header: { emblem_url: '/karnataka-emblem.png' }, footer: {} };
    }
    return TC_STATE.template;
  }

  /** Rows admin marked hidden (comma list or array in header.hidden_rows). */
  function hiddenRowSet() {
    var raw = H('hidden_rows') || '';
    var set = {};
    if (Array.isArray(raw)) {
      raw.forEach(function (k) { set[String(k)] = true; });
    } else {
      String(raw).split(',').forEach(function (k) {
        k = k.trim();
        if (k) set[k] = true;
      });
    }
    return set;
  }

  function isRowHidden(key) {
    return !!hiddenRowSet()[key];
  }

  /** Visible serial number for printed table (skips hidden rows). */
  function visibleSl(keysUpTo) {
    var n = 0;
    keysUpTo.forEach(function (k) {
      if (!isRowHidden(k)) n++;
    });
    return n;
  }

  /* ---------- form HTML ---------- */
  function fieldInput(id, placeholder, readonly) {
    return '<input type="text" id="' + id + '" data-tc-field="' + id + '" ' +
      (readonly ? 'readonly style="background:#f8fafc;width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:0.85rem;"' :
        'style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;font-size:0.85rem;"') +
      ' placeholder="' + esc(placeholder || '') + '" />';
  }

  function labelCell(key) {
    var en = L(key, 'en');
    var kn = L(key, 'kn');
    return '<div style="font-size:0.78rem;line-height:1.35;">' +
      (kn ? '<div style="font-weight:600;">' + esc(kn) + '</div>' : '') +
      '<div style="opacity:.85;">' + esc(en) + '</div></div>';
  }

  function rowShell(sl, labelHtml, valueHtml) {
    return '<tr>' +
      '<td style="width:40px;text-align:center;font-weight:700;border:1px solid #334155;padding:6px;vertical-align:top;">' + sl + '</td>' +
      '<td style="width:38%;border:1px solid #334155;padding:6px 8px;vertical-align:top;background:#f8fafc;">' + labelHtml + '</td>' +
      '<td style="border:1px solid #334155;padding:6px 8px;vertical-align:top;">' + valueHtml + '</td>' +
      '</tr>';
  }

  function maybeRow(rowKey, slKeys, labelHtml, valueHtml) {
    if (isRowHidden(rowKey)) return '';
    return rowShell(visibleSl(slKeys), labelHtml, valueHtml);
  }

  function buildFormHtml() {
    var emblem = H('emblem_url') || '/karnataka-emblem.png';
    var semOpts = ['', '1st Sem', '2nd Sem', '3rd Sem', '4th Sem', '5th Sem', '6th Sem'].map(function (s) {
      return '<option value="' + s + '">' + (s || '-- Select Semester --') + '</option>';
    }).join('');
    var yn = '<option value="">-- Select --</option><option value="Yes">Yes</option><option value="No">No</option>';
    var cond = '<option value="">-- Select --</option><option value="Satisfactory">Satisfactory</option><option value="Unsatisfactory">Unsatisfactory</option>';

    // cumulative keys for serial renumbering when rows hidden
    var k1 = ['row1'];
    var k2 = k1.concat(['row2']);
    var k3 = k2.concat(['row3']);
    var k4 = k3.concat(['row4']);
    var k5 = k4.concat(['row5']);
    var k6 = k5.concat(['row6']);
    var k7 = k6.concat(['row7']);
    var k8 = k7.concat(['row8']);
    var k9 = k8.concat(['row9']);
    var k10 = k9.concat(['row10']);
    var k11 = k10.concat(['row11']);
    var k12 = k11.concat(['row12']);

    return '' +
      '<div class="card" style="padding:0;overflow:hidden;">' +
      '<div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">📄 Issue Transfer Certificate (Official Format)</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn ol" onclick="window.tcClearForm&&window.tcClearForm()">Clear</button>' +
      '<button type="button" class="btn gr" onclick="window.tcPrintA4&&window.tcPrintA4()">🖨️ Print A4</button>' +
      '</div></div>' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border);background:#fffbeb;">' +
      '<div style="font-size:0.78rem;color:#92400e;margin-bottom:8px;">Enter <strong>Register Number</strong> (row 4) to auto-fetch student details. Admission Register No. &amp; TC No. are ACM-only. After print, complete register with <strong>college</strong>, <strong>sent date</strong> and <strong>PO receipt</strong>.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
      '<div class="fg" style="margin:0;"><label>Quick load Register No.</label>' +
      '<input type="text" id="tcQuickReg" placeholder="Type reg no & press Enter" style="width:100%;padding:8px;border:1.5px solid #f59e0b;border-radius:8px;" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.tcFetchByReg&&window.tcFetchByReg(this.value);}" />' +
      '</div>' +
      '<div class="fg" style="margin:0;"><label>Linked Cert Request</label>' +
      '<input type="text" id="tcLinkedReq" readonly style="width:100%;padding:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;" placeholder="—" /></div>' +
      '<div class="fg" style="margin:0;"><label>Register entry ID</label>' +
      '<input type="text" id="tcRegisterId" readonly style="width:100%;padding:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;" placeholder="New" /></div>' +
      '</div></div>' +

      // A4 preview form
      '<div id="tcA4Sheet" style="max-width:210mm;margin:16px auto;padding:12mm 14mm;background:#fff;color:#0f172a;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.08);font-family:\'Times New Roman\',Times,serif;">' +

      // Header
      '<div style="text-align:center;margin-bottom:10px;">' +
      '<img src="' + esc(emblem) + '" alt="Emblem" style="width:72px;height:72px;object-fit:contain;display:block;margin:0 auto 6px;" />' +
      '<div style="font-size:0.95rem;font-weight:700;">' + esc(H('govt_kn') || 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ') + '</div>' +
      '<div style="font-size:0.82rem;font-weight:700;letter-spacing:.04em;">' + esc(H('govt_en') || 'GOVERNMENT OF KARNATAKA') + '</div>' +
      '<div style="font-size:0.78rem;margin-top:2px;">' + esc(H('dept_kn') || '') + (H('dept_kn') && H('dept_en') ? ' / ' : '') + esc(H('dept_en') || 'Department of Technical Education') + '</div>' +
      '<div style="font-size:1.05rem;font-weight:800;margin-top:6px;color:#1a4fa0;">' + esc(H('college_en') || 'GOVERNMENT POLYTECHNIC, HUBBALLI') + '</div>' +
      '<div style="font-size:0.9rem;font-weight:700;">' + esc(H('college_kn') || 'ಸರ್ಕಾರಿ ಪಾಲಿಟೆಕ್ನಿಕ್, ಹುಬ್ಬಳ್ಳಿ') + '</div>' +
      '<div style="margin-top:10px;font-size:1.1rem;font-weight:800;text-decoration:underline;">' + esc(H('title_en') || 'TRANSFER CERTIFICATE') + '</div>' +
      '<div style="font-size:0.95rem;font-weight:700;">' + esc(H('title_kn') || 'ವರ್ಗಾವಣೆ ಪ್ರಮಾಣಪತ್ರ') + '</div>' +
      '</div>' +

      // Adm / TC numbers
      '<div style="display:flex;justify-content:space-between;gap:16px;margin:12px 0 10px;font-size:0.85rem;">' +
      '<div style="flex:1;"><div style="font-weight:600;margin-bottom:4px;">' + esc(H('adm_reg_label_kn') || '') + '<br>' + esc(H('adm_reg_label_en') || 'Admission Register No.') + '</div>' +
      fieldInput('tc_admission_reg_no', 'ACM enters only') + '</div>' +
      '<div style="flex:1;text-align:right;"><div style="font-weight:600;margin-bottom:4px;">' + esc(H('tc_no_label_kn') || '') + '<br>' + esc(H('tc_no_label_en') || 'Transfer Certificate No.') + '</div>' +
      '<div style="text-align:left;">' + fieldInput('tc_tc_no', 'ACM enters TC number') + '</div></div>' +
      '</div>' +

      '<table style="width:100%;border-collapse:collapse;font-size:0.84rem;">' +
      maybeRow('row1', k1, labelCell('row1'), fieldInput('tc_student_name', 'Auto from profile')) +
      maybeRow('row2', k2,
        labelCell('row2_father') + '<div style="margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:6px;">' + labelCell('row2_mother') + '</div>',
        fieldInput('tc_father_name', 'Father name') +
        '<div style="margin-top:8px;">' + fieldInput('tc_mother_name', 'Mother name') + '</div>') +
      maybeRow('row3', k3, labelCell('row3'),
        '<div style="display:grid;grid-template-columns:140px 1fr;gap:8px;align-items:center;">' +
        '<input type="date" id="tc_dob" data-tc-field="tc_dob" onchange="window.tcUpdateDobWords&&window.tcUpdateDobWords()" style="padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;" />' +
        '<div><div style="font-size:0.72rem;opacity:.7;">In figures</div><input type="text" id="tc_dob_figures" readonly style="width:100%;padding:6px 8px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;" />' +
        '<div style="font-size:0.72rem;opacity:.7;margin-top:4px;">In words</div><input type="text" id="tc_dob_words" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;" placeholder="Auto-generated words" /></div></div>') +
      maybeRow('row4', k4,
        labelCell('row4_adm') + '<div style="margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:6px;">' + labelCell('row4_reg') + '</div>',
        fieldInput('tc_admission_date', '1st year fee receipt date / admission date') +
        '<div style="margin-top:8px;display:flex;gap:6px;">' +
        '<input type="text" id="tc_reg_no" data-tc-field="tc_reg_no" placeholder="Register Number — type & blur to fetch" ' +
        'style="flex:1;padding:6px 8px;border:2px solid #1a4fa0;border-radius:4px;font-family:JetBrains Mono,monospace;font-weight:700;" ' +
        'onblur="window.tcFetchByReg&&window.tcFetchByReg(this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.tcFetchByReg&&window.tcFetchByReg(this.value);}" />' +
        '<button type="button" class="btn ol" style="padding:4px 10px;font-size:0.75rem;" onclick="window.tcFetchByReg&&window.tcFetchByReg(document.getElementById(\'tc_reg_no\').value)">Fetch</button>' +
        '</div>') +
      maybeRow('row5', k5, labelCell('row5'),
        '<input type="date" id="tc_leaving_date" data-tc-field="tc_leaving_date" style="padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;" />') +
      maybeRow('row6', k6, labelCell('row6'), fieldInput('tc_class_leaving', 'e.g. Diploma in CSE — 3rd Year')) +
      maybeRow('row7', k7, labelCell('row7'),
        '<select id="tc_last_sem" data-tc-field="tc_last_sem" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;">' + semOpts + '</select>') +
      maybeRow('row8', k8, labelCell('row8'),
        '<select id="tc_qualified" data-tc-field="tc_qualified" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;">' + yn + '</select>') +
      maybeRow('row9', k9, labelCell('row9'),
        '<select id="tc_dues" data-tc-field="tc_dues" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;">' + yn + '</select>') +
      maybeRow('row10', k10, labelCell('row10'),
        '<select id="tc_scholarship" data-tc-field="tc_scholarship" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;">' + yn + '</select>') +
      maybeRow('row11', k11, labelCell('row11'),
        '<select id="tc_conduct" data-tc-field="tc_conduct" style="width:100%;padding:6px 8px;border:1px solid #94a3b8;border-radius:4px;">' + cond + '</select>') +
      maybeRow('row12', k12,
        labelCell('row12_religion') + '<div style="margin-top:8px;border-top:1px dashed #cbd5e1;padding-top:6px;">' + labelCell('row12_caste') + '</div>',
        fieldInput('tc_religion', 'Religion') +
        '<div style="margin-top:8px;">' + fieldInput('tc_caste', 'Caste') + '</div>') +
      '</table>' +

      // Footer — Principal signature only (no Clerk / ACM)
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px;font-size:0.85rem;">' +
      '<div>' +
      '<div>' + esc(F('place_kn') || 'ಸ್ಥಳ: ಹುಬ್ಬಳ್ಳಿ') + '</div>' +
      '<div>' + esc(F('place_en') || 'Place: Hubballi') + '</div>' +
      '<div style="margin-top:8px;"><strong>Date:</strong> <span id="tc_print_date">—</span></div>' +
      '<div><strong>Time:</strong> <span id="tc_print_time">—</span></div>' +
      '</div>' +
      '<div style="text-align:center;min-width:180px;">' +
      '<div style="height:56px;"></div>' +
      '<div style="border-top:1px solid #334155;padding-top:4px;font-size:0.78rem;">' +
      esc(F('sign_right_kn') || 'ಪ್ರಾಂಶುಪಾಲರು') + '<br>' + esc(F('sign_right_en') || 'Principal') +
      '</div></div>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:0.75rem;opacity:.75;font-style:italic;">' +
      esc(F('note_kn') || '') + (F('note_kn') ? ' · ' : '') + esc(F('note_en') || '') +
      '</div>' +

      '</div>' + // end A4 sheet

      // Post-print dispatch
      '<div style="padding:16px;border-top:1px solid var(--border);background:#fef2f2;" id="tcDispatchBox">' +
      '<div style="font-weight:700;color:#991b1b;margin-bottom:8px;">⚠️ TC Register (required after print)</div>' +
      '<div style="font-size:0.78rem;color:#7f1d1d;margin-bottom:10px;">Saved as <strong>Printed – Pending dispatch</strong> until <strong>TC sent to college</strong>, <strong>TC sent date</strong> and <strong>Post Office Receipt No.</strong> are filled.</div>' +
      '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px;align-items:end;">' +
      '<div class="fg" style="margin:0;"><label>TC sent to which college *</label>' +
      '<input type="text" id="tc_sent_college" placeholder="e.g. Government Polytechnic, Bengaluru" style="width:100%;padding:8px;border:1.5px solid #fca5a5;border-radius:8px;" /></div>' +
      '<div class="fg" style="margin:0;"><label>TC sent date *</label>' +
      '<input type="date" id="tc_sent_date" style="width:100%;padding:8px;border:1.5px solid #fca5a5;border-radius:8px;" /></div>' +
      '<div class="fg" style="margin:0;"><label>Post Office Receipt No. *</label>' +
      '<input type="text" id="tc_po_receipt" placeholder="PO receipt number" style="width:100%;padding:8px;border:1.5px solid #fca5a5;border-radius:8px;" /></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn" style="background:#b45309;color:#fff;" onclick="window.tcSaveRegister&&window.tcSaveRegister(\'print\')">Save after Print</button>' +
      '<button type="button" class="btn gr" onclick="window.tcSaveRegister&&window.tcSaveRegister(\'complete\')">✓ Complete Register</button>' +
      '</div></div>' +
      '<div id="tcSaveMsg" style="margin-top:10px;font-size:0.82rem;"></div>' +
      '</div>' +

      '</div>';
  }

  window.mountTcForm = async function () {
    ensureTcPanels();
    await loadTemplate();
    document.querySelectorAll('[data-tc-form-host="1"]').forEach(function (host) {
      host.innerHTML = buildFormHtml();
    });
    // set live date/time
    tcTickDateTime();
    // restore state if any
    if (TC_STATE.form && (TC_STATE.form.reg_no || TC_STATE.form.tc_reg_no)) {
      applyFormToDom(TC_STATE.form);
    }
    if (TC_STATE.registerId) {
      var rid = document.getElementById('tcRegisterId');
      if (rid) rid.value = String(TC_STATE.registerId);
    }
    if (TC_STATE.certRequestId) {
      var lr = document.getElementById('tcLinkedReq');
      if (lr) lr.value = 'Req #' + TC_STATE.certRequestId;
    }
  };

  function tcTickDateTime() {
    var now = new Date();
    var dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.querySelectorAll('#tc_print_date').forEach(function (el) { el.textContent = dateStr; });
    document.querySelectorAll('#tc_print_time').forEach(function (el) { el.textContent = timeStr; });
  }

  window.tcUpdateDobWords = function () {
    var dob = (document.getElementById('tc_dob') || {}).value || '';
    var fig = document.getElementById('tc_dob_figures');
    var words = document.getElementById('tc_dob_words');
    if (fig) fig.value = formatDobDisplay(dob);
    if (words) words.value = dobToWords(dob);
  };

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v == null ? '' : String(v);
  }

  function getVal(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function collectForm() {
    return {
      admission_reg_no: getVal('tc_admission_reg_no'),
      tc_no: getVal('tc_tc_no'),
      student_name: getVal('tc_student_name'),
      father_name: getVal('tc_father_name'),
      mother_name: getVal('tc_mother_name'),
      dob: getVal('tc_dob'),
      dob_figures: getVal('tc_dob_figures'),
      dob_words: getVal('tc_dob_words'),
      admission_date: getVal('tc_admission_date'),
      reg_no: getVal('tc_reg_no'),
      leaving_date: getVal('tc_leaving_date'),
      class_leaving: getVal('tc_class_leaving'),
      last_sem: getVal('tc_last_sem'),
      qualified: getVal('tc_qualified'),
      dues: getVal('tc_dues'),
      scholarship: getVal('tc_scholarship'),
      conduct: getVal('tc_conduct'),
      religion: getVal('tc_religion'),
      caste: getVal('tc_caste'),
      sent_to_college: getVal('tc_sent_college'),
      tc_sent_date: getVal('tc_sent_date'),
      po_receipt: getVal('tc_po_receipt'),
      branch: (TC_STATE.form && TC_STATE.form.branch) || '',
      print_date: (document.getElementById('tc_print_date') || {}).textContent || '',
      print_time: (document.getElementById('tc_print_time') || {}).textContent || '',
    };
  }

  function applyFormToDom(f) {
    if (!f) return;
    setVal('tc_admission_reg_no', f.admission_reg_no);
    setVal('tc_tc_no', f.tc_no);
    setVal('tc_student_name', f.student_name);
    setVal('tc_father_name', f.father_name);
    setVal('tc_mother_name', f.mother_name);
    setVal('tc_dob', f.dob);
    setVal('tc_dob_figures', f.dob_figures || formatDobDisplay(f.dob));
    setVal('tc_dob_words', f.dob_words || dobToWords(f.dob));
    setVal('tc_admission_date', f.admission_date);
    setVal('tc_reg_no', f.reg_no);
    setVal('tc_leaving_date', f.leaving_date);
    setVal('tc_class_leaving', f.class_leaving);
    setVal('tc_last_sem', f.last_sem);
    setVal('tc_qualified', f.qualified);
    setVal('tc_dues', f.dues);
    setVal('tc_scholarship', f.scholarship);
    setVal('tc_conduct', f.conduct);
    setVal('tc_religion', f.religion);
    setVal('tc_caste', f.caste);
    setVal('tc_sent_college', f.sent_to_college);
    setVal('tc_sent_date', f.tc_sent_date);
    setVal('tc_po_receipt', f.po_receipt);
    setVal('tcQuickReg', f.reg_no);
  }

  window.tcClearForm = function () {
    TC_STATE.registerId = null;
    TC_STATE.certRequestId = null;
    TC_STATE.form = {};
    window.mountTcForm();
  };

  window.tcFetchByReg = async function (reg) {
    reg = String(reg || '').trim();
    if (!reg) { alert('Enter Register Number'); return; }
    setVal('tc_reg_no', reg);
    setVal('tcQuickReg', reg);

    // Prefer students cache from bridge
    var list = window._acmStudentsCache;
    if (!list || !list.length) {
      var data = await apiQuiet('/api/students?_ts=' + Date.now());
      list = (data && data.students) ? data.students : [];
      window._acmStudentsCache = list;
    }
    var stu = list.find(function (s) {
      return String(s.reg_no || '').toUpperCase() === reg.toUpperCase();
    });
    if (!stu) {
      // try partial
      stu = list.find(function (s) {
        return String(s.reg_no || '').toUpperCase().indexOf(reg.toUpperCase()) >= 0;
      });
    }
    if (!stu) {
      alert('Student not found for register number: ' + reg);
      return;
    }

    var extra = stu.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }

    var name = stu.name || pickExtra(extra, ['Student (As per SSLC)', 'Student (As per Aadhar)', 'Name']) || stu.display_name || '';
    var father = stu.father || pickExtra(extra, ['Father Name', "Father's Name", 'Father']) || '';
    var mother = pickExtra(extra, ['Mother Name', "Mother's Name", 'Mother']) || '';
    var dob = pickExtra(extra, ['Date of Birth', 'DOB', 'Date of Birth (as per SSLC)']) || '';
    // normalize dob to yyyy-mm-dd if possible
    var dobIso = '';
    var dm = String(dob).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dm) dobIso = dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
    else if (/^\d{4}-\d{2}-\d{2}/.test(dob)) dobIso = dob.slice(0, 10);

    var admDate = pickExtra(extra, [
      '1st Year Fee Receipt Date', 'First Year Fee Receipt Date', '1st Year Fee Date',
      'Admission Date', 'Date of Admission', '1st Year Fee Paid Date',
    ]) || '';

    var religion = pickExtra(extra, ['Religion']) || '';
    var caste = pickExtra(extra, ['Caste', 'Category', 'Caste / Category']) || '';
    var branch = stu.dept || pickExtra(extra, ['Branch']) || '';
    var year = stu.year || pickExtra(extra, ['Current Year']) || '';
    var classLeaving = [branch, year].filter(Boolean).join(' — ');

    // semester guess from year
    var semGuess = '';
    var y = String(year).toLowerCase();
    if (y.indexOf('1') === 0) semGuess = '2nd Sem';
    else if (y.indexOf('2') === 0) semGuess = '4th Sem';
    else if (y.indexOf('3') === 0) semGuess = '6th Sem';

    var form = {
      student_name: name,
      father_name: father,
      mother_name: mother,
      dob: dobIso || '',
      dob_figures: formatDobDisplay(dobIso || dob),
      dob_words: dobToWords(dobIso || dob),
      admission_date: admDate,
      reg_no: stu.reg_no || reg,
      class_leaving: classLeaving,
      last_sem: getVal('tc_last_sem') || semGuess,
      religion: religion,
      caste: caste,
      branch: branch,
      admission_reg_no: getVal('tc_admission_reg_no'),
      tc_no: getVal('tc_tc_no'),
      leaving_date: getVal('tc_leaving_date'),
      qualified: getVal('tc_qualified'),
      dues: getVal('tc_dues'),
      scholarship: getVal('tc_scholarship'),
      conduct: getVal('tc_conduct'),
    };
    TC_STATE.form = form;
    applyFormToDom(form);
    tcTickDateTime();
  };

  /* ---------- Proceed from queue ---------- */
  window.acmProceedTc = async function (certReqId, regNo) {
    ensureTcPanels();
    TC_STATE.certRequestId = certReqId || null;
    TC_STATE.registerId = null;

    // mark processing
    if (certReqId && window.api && window.api.patch) {
      try {
        await window.api.patch('/api/cert-requests', {
          id: certReqId,
          status: 'processing',
          remarks: 'TC Proceed — opened Issue TC form at ACM.',
        });
      } catch (e) { /* ignore */ }
    }

    // open Issue TC tab in visible ACM root
    var adRoot = document.getElementById('adACM');
    var facRoot = document.getElementById('facACM');
    var useAdmin = adRoot && adRoot.offsetParent !== null;
    var useFac = facRoot && facRoot.offsetParent !== null;
    if (!useAdmin && !useFac) {
      // open ACM section
      if (typeof window.showSec === 'function') {
        var link = document.querySelector('[onclick*="adACM"], [onclick*="facACM"]');
        if (adRoot) window.showSec('adACM', link);
        else if (facRoot) window.showSec('facACM', link);
      }
      useAdmin = !!document.getElementById('adACM');
    }

    var tabId = useAdmin || document.getElementById('adAcmTc') ? 'adAcmTc' : 'facAcmTc';
    var showFn = tabId.indexOf('ad') === 0 ? 'showAdACMTab' : 'showFacACMTab';
    var btn = document.querySelector('#' + (tabId.indexOf('ad') === 0 ? 'adACM' : 'facACM') + ' [data-tc-tab="issue"]');
    if (typeof window[showFn] === 'function') window[showFn](tabId, btn);

    await window.mountTcForm();
    if (regNo) await window.tcFetchByReg(regNo);
    if (TC_STATE.certRequestId) {
      var lr = document.getElementById('tcLinkedReq');
      if (lr) lr.value = 'Req #' + TC_STATE.certRequestId;
    }
    // scroll to form
    var sheet = document.getElementById('tcA4Sheet');
    if (sheet) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  };

  /* ---------- Print A4 (single page + readable row spacing) ---------- */
  function buildPrintHtml(form) {
    var emblem = H('emblem_url') || '/karnataka-emblem.png';
    function lv(key) {
      var en = L(key, 'en');
      var kn = L(key, 'kn');
      return (kn ? '<span class="kn">' + esc(kn) + '</span><br>' : '') +
        '<span class="en">' + esc(en) + '</span>';
    }
    /** Stack two bilingual labels with clear gap (Father / Mother, Religion / Caste, …) */
    function lvPair(keyA, keyB) {
      return '<div class="lab-block">' + lv(keyA) + '</div>' +
        '<div class="lab-block lab-block-2">' + lv(keyB) + '</div>';
    }
    /** Stack two values with matching gap (Suresh / Radha, Hindu / Uppar, …) */
    function valPair(a, b, strongB) {
      var top = '<div class="val-line">' + (a || '&nbsp;') + '</div>';
      var bot = strongB
        ? '<div class="val-line val-line-2"><strong>' + (b || '&nbsp;') + '</strong></div>'
        : '<div class="val-line val-line-2">' + (b || '&nbsp;') + '</div>';
      return top + bot;
    }
    function cell(sl, lab, val) {
      return '<tr><td class="sl">' + sl + '</td>' +
        '<td class="lab">' + lab + '</td>' +
        '<td class="val">' + (val || '&nbsp;') + '</td></tr>';
    }
    var dobVal =
      '<div class="val-line">' + esc(form.dob_figures || '') + '</div>' +
      (form.dob_words
        ? '<div class="val-line val-line-2 sub">(' + esc(form.dob_words) + ')</div>'
        : '');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>TC - ' + esc(form.reg_no) + '</title>' +
      '<style>' +
      '@page{size:A4 portrait;margin:9mm 11mm;}' +
      'html,body{margin:0;padding:0;}' +
      'body{font-family:"Times New Roman",Times,serif;color:#000;font-size:11px;line-height:1.35;}' +
      '.page{width:100%;box-sizing:border-box;}' +
      '.hdr{text-align:center;margin:0 0 5px;line-height:1.25;}' +
      '.hdr img{width:52px;height:52px;object-fit:contain;display:block;margin:0 auto 3px;}' +
      '.hdr .gkn{font-size:12px;font-weight:700;}' +
      '.hdr .gen{font-size:10.5px;font-weight:700;letter-spacing:.02em;}' +
      '.hdr .dept{font-size:9.5px;}' +
      '.hdr .col{font-size:13px;font-weight:800;margin-top:2px;}' +
      '.hdr .colkn{font-size:11px;font-weight:700;}' +
      '.hdr .title{font-size:13.5px;font-weight:800;text-decoration:underline;margin-top:5px;}' +
      '.hdr .titlekn{font-size:11.5px;font-weight:700;}' +
      '.meta{display:flex;justify-content:space-between;gap:10px;margin:6px 0 5px;font-size:10.5px;}' +
      'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px;}' +
      /* Comfortable row padding so labels/values are not cramped */
      'td{border:1px solid #000;padding:6px 7px;vertical-align:middle;line-height:1.4;}' +
      'td.sl{width:28px;text-align:center;font-weight:700;padding:6px 3px;}' +
      'td.lab{width:42%;}' +
      'td.val{word-wrap:break-word;}' +
      '.kn{font-weight:600;font-size:10.5px;line-height:1.35;}' +
      '.en{font-size:10.5px;line-height:1.35;}' +
      '.sub{font-size:9.5px;}' +
      /* Clear gap between stacked pairs (Father/Mother, Religion/Caste, DOB lines, …) */
      '.lab-block{display:block;}' +
      '.lab-block-2{margin-top:8px;padding-top:6px;border-top:1px dotted #999;}' +
      '.val-line{display:block;min-height:1.15em;}' +
      '.val-line-2{margin-top:8px;padding-top:6px;}' +
      '.foot{display:flex;justify-content:space-between;align-items:flex-end;margin-top:12px;font-size:10.5px;line-height:1.45;}' +
      '.sig{text-align:center;min-width:130px;}' +
      '.sig .line{border-top:1px solid #000;margin-top:26px;padding-top:3px;line-height:1.3;}' +
      '.note{margin-top:6px;font-size:9.5px;font-style:italic;line-height:1.3;}' +
      '@media print{' +
      '  body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      '  .page{page-break-inside:avoid;}' +
      '  table,tr,td{page-break-inside:avoid;}' +
      '}' +
      '</style></head><body><div class="page">' +
      '<div class="hdr">' +
      '<img src="' + esc(emblem) + '" alt="Emblem" />' +
      '<div class="gkn">' + esc(H('govt_kn') || 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ') + '</div>' +
      '<div class="gen">' + esc(H('govt_en') || 'GOVERNMENT OF KARNATAKA') + '</div>' +
      '<div class="dept">' + esc(H('dept_en') || 'Department of Technical Education') + '</div>' +
      '<div class="col">' + esc(H('college_en') || 'GOVERNMENT POLYTECHNIC, HUBBALLI') + '</div>' +
      '<div class="colkn">' + esc(H('college_kn') || '') + '</div>' +
      '<div class="title">' + esc(H('title_en') || 'TRANSFER CERTIFICATE') + '</div>' +
      '<div class="titlekn">' + esc(H('title_kn') || 'ವರ್ಗಾವಣೆ ಪ್ರಮಾಣಪತ್ರ') + '</div>' +
      '</div>' +
      '<div class="meta">' +
      '<div><strong>' + esc(H('adm_reg_label_en') || 'Admission Register No.') + ':</strong> ' + esc(form.admission_reg_no) + '</div>' +
      '<div><strong>' + esc(H('tc_no_label_en') || 'Transfer Certificate No.') + ':</strong> ' + esc(form.tc_no) + '</div>' +
      '</div>' +
      '<table>' +
      (function () {
        var parts = '';
        var order = [
          { key: 'row1', lab: lv('row1'), val: esc(form.student_name) },
          {
            key: 'row2',
            lab: lvPair('row2_father', 'row2_mother'),
            val: valPair(esc(form.father_name), esc(form.mother_name)),
          },
          { key: 'row3', lab: lv('row3'), val: dobVal },
          {
            key: 'row4',
            lab: lvPair('row4_adm', 'row4_reg'),
            val: valPair(esc(form.admission_date), esc(form.reg_no), true),
          },
          { key: 'row5', lab: lv('row5'), val: esc(form.leaving_date) },
          { key: 'row6', lab: lv('row6'), val: esc(form.class_leaving) },
          { key: 'row7', lab: lv('row7'), val: esc(form.last_sem) },
          { key: 'row8', lab: lv('row8'), val: esc(form.qualified) },
          { key: 'row9', lab: lv('row9'), val: esc(form.dues) },
          { key: 'row10', lab: lv('row10'), val: esc(form.scholarship) },
          { key: 'row11', lab: lv('row11'), val: esc(form.conduct) },
          {
            key: 'row12',
            lab: lvPair('row12_religion', 'row12_caste'),
            val: valPair(esc(form.religion), esc(form.caste)),
          },
        ];
        var sl = 0;
        order.forEach(function (r) {
          if (isRowHidden(r.key)) return;
          sl++;
          parts += cell(sl, r.lab, r.val);
        });
        return parts;
      })() +
      '</table>' +
      '<div class="foot">' +
      '<div>' + esc(F('place_en') || 'Place: Hubballi') +
      '<br><strong>Date:</strong> ' + esc(form.print_date) +
      '<br><strong>Time:</strong> ' + esc(form.print_time) + '</div>' +
      '<div class="sig"><div class="line">' +
      esc(F('sign_right_kn') || 'ಪ್ರಾಂಶುಪಾಲರು') + '<br>' +
      esc(F('sign_right_en') || 'Principal') +
      '</div></div>' +
      '</div>' +
      '<div class="note">' + esc(F('note_en') || '') +
      (F('note_kn') ? ' · ' + esc(F('note_kn')) : '') +
      '</div>' +
      '</div></body></html>';
  }

  window.tcPrintA4 = async function () {
    tcTickDateTime();
    var form = collectForm();
    if (!form.reg_no) { alert('Register Number is required.'); return; }
    if (!form.tc_no) { alert('Transfer Certificate No. is required (ACM enters this).'); return; }
    if (!form.admission_reg_no) { alert('Admission Register No. is required (ACM enters this).'); return; }
    if (!form.student_name) { alert('Student name is empty. Fetch by Register Number first.'); return; }

    TC_STATE.form = form;

    // Always open the print dialog from the filled form
    var html = buildPrintHtml(form);
    if (typeof window.acmPrintHtmlBlob === 'function') {
      window.acmPrintHtmlBlob(html);
    } else {
      var iframe = document.getElementById('tcPrintFrame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'tcPrintFrame';
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
        document.body.appendChild(iframe);
      }
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(function () {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          var w = window.open('', '_blank');
          if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
        }
      }, 300);
    }

    // Then save as printed_pending (show real API errors — never silent)
    var saved = await window.tcSaveRegister('print', false);
    var msg = document.getElementById('tcSaveMsg');
    if (msg) {
      if (saved) {
        msg.innerHTML = '<span style="color:#b45309;font-weight:700;">⚠️ TC printed — Pending dispatch. Enter college, sent date and PO receipt, then Complete Register.</span>';
      } else {
        msg.innerHTML = '<span style="color:#991b1b;font-weight:700;">⚠️ Printed locally, but save failed. Fix the error and try Print again so it appears in TC Register.</span>';
      }
    }
    var box = document.getElementById('tcDispatchBox');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  window.tcSaveRegister = async function (mode, silent) {
    tcTickDateTime();
    var form = collectForm();
    if (!form.reg_no) { if (!silent) alert('Register Number required'); return null; }
    if (!form.tc_no) { if (!silent) alert('TC No. required'); return null; }

    var college = getVal('tc_sent_college') || form.sent_to_college || '';
    var sentDate = getVal('tc_sent_date') || form.tc_sent_date || '';
    var po = getVal('tc_po_receipt') || form.po_receipt || '';
    form.sent_to_college = college;
    form.tc_sent_date = sentDate;
    form.po_receipt = po;
    // Combined display string for register column
    var tcSentCombined = [college, sentDate].filter(Boolean).join(' · ');

    if (mode === 'complete') {
      if (!college || !sentDate || !po) {
        alert('⚠️ Cannot complete: enter TC sent to which college, TC sent date, and Post Office Receipt Number.');
        return null;
      }
    }

    var body = {
      action: mode === 'complete' ? 'complete' : (mode === 'print' ? 'print' : 'save_draft'),
      id: TC_STATE.registerId || undefined,
      regNo: form.reg_no,
      tcNo: form.tc_no,
      admissionRegNo: form.admission_reg_no,
      studentName: form.student_name,
      fatherName: form.father_name,
      motherName: form.mother_name,
      branch: form.branch || '',
      formData: form,
      certRequestId: TC_STATE.certRequestId || undefined,
      tcSent: tcSentCombined,
      postOfficeReceipt: po,
      status: mode === 'complete' ? 'completed' : (mode === 'print' ? 'printed_pending' : 'draft'),
    };

    var res = await apiQuiet('/api/tc', { method: 'POST', body: JSON.stringify(body) });
    if (res && res.__error) {
      alert('⚠️ ' + res.__error);
      return null;
    }
    if (!res || !res.entry) {
      alert('Failed to save TC register.');
      return null;
    }
    TC_STATE.registerId = res.entry.id;
    var rid = document.getElementById('tcRegisterId');
    if (rid) rid.value = String(res.entry.id);

    var msg = document.getElementById('tcSaveMsg');
    if (msg && !silent) {
      if (res.entry.status === 'completed') {
        msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ TC Register completed and saved.</span>';
      } else if (res.entry.status === 'printed_pending') {
        msg.innerHTML = '<span style="color:#b45309;font-weight:700;">⚠️ Saved as Printed – Pending dispatch. Fill TC Sent + PO Receipt to complete.</span>';
      } else {
        msg.innerHTML = '<span style="color:#1a4fa0;">Draft saved (#' + res.entry.id + ').</span>';
      }
    }
    if (typeof window.renderTcRegister === 'function') window.renderTcRegister();
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    return res.entry;
  };

  /* ---------- Register table ---------- */
  window.renderTcRegister = async function () {
    ensureTcPanels();
    var hosts = document.querySelectorAll('[data-tc-register-host="1"]');
    if (!hosts.length) return;
    hosts.forEach(function (h) {
      h.innerHTML = '<div class="card"><div class="card-hd"><h3>📒 TC Register</h3></div><div style="padding:20px;opacity:.7;">Loading…</div></div>';
    });

    var data = await apiQuiet('/api/tc?kind=register&_ts=' + Date.now());
    var rows = (data && data.register) ? data.register : [];

    var html = '<div class="card"><div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">📒 TC Register</h3>' +
      '<button type="button" class="btn ol" onclick="window.renderTcRegister&&window.renderTcRegister()">↻ Refresh</button>' +
      '</div>' +
      '<div style="padding:12px 16px;font-size:0.78rem;background:#fffbeb;border-bottom:1px solid var(--border);">' +
      'Pending rows need <strong>TC sent to college</strong>, <strong>TC sent date</strong> and <strong>Post Office Receipt No.</strong> to complete.' +
      '</div><div style="overflow-x:auto;"><table><thead><tr>' +
      '<th>TC No</th><th>Adm. Reg</th><th>Student</th><th>Reg No</th><th>Printed</th><th>Sent to college / date</th><th>PO Receipt</th><th>Status</th><th>Action</th>' +
      '</tr></thead><tbody>';

    if (!rows.length) {
      html += '<tr><td colspan="9" style="text-align:center;padding:24px;opacity:.7;">No TC register entries yet.</td></tr>';
    } else {
      html += rows.map(function (r) {
        var st = r.status;
        var badge = st === 'completed'
          ? '<span class="badge approved">Completed</span>'
          : st === 'printed_pending'
            ? '<span class="badge pending">⚠️ Pending dispatch</span>'
            : '<span class="badge info">Draft</span>';
        var printed = r.printed_at ? new Date(r.printed_at).toLocaleString('en-IN') : '—';
        var fd = r.form_data || {};
        if (typeof fd === 'string') { try { fd = JSON.parse(fd); } catch (e) { fd = {}; } }
        var collegeVal = fd.sent_to_college || '';
        var dateVal = fd.tc_sent_date || '';
        var actions = '';
        if (st !== 'completed') {
          actions =
            '<div style="display:flex;flex-direction:column;gap:4px;min-width:170px;">' +
            '<input type="text" id="tcRegCollege_' + r.id + '" placeholder="Sent to college" value="' + esc(collegeVal) + '" style="padding:4px 6px;font-size:0.75rem;border:1px solid #fca5a5;border-radius:4px;" />' +
            '<input type="date" id="tcRegDate_' + r.id + '" value="' + esc(dateVal) + '" style="padding:4px 6px;font-size:0.75rem;border:1px solid #fca5a5;border-radius:4px;" />' +
            '<input type="text" id="tcRegPo_' + r.id + '" placeholder="PO Receipt No" value="' + esc(r.post_office_receipt || '') + '" style="padding:4px 6px;font-size:0.75rem;border:1px solid #fca5a5;border-radius:4px;" />' +
            '<button type="button" class="btn gr" style="padding:3px 8px;font-size:0.72rem;" onclick="window.tcCompleteRegisterRow(' + r.id + ')">Complete</button>' +
            '</div>';
        } else {
          actions = '<span style="font-size:0.75rem;opacity:.7;">Locked</span>';
        }
        return '<tr>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.75rem;">' + esc(r.tc_no) + '</td>' +
          '<td>' + esc(r.admission_reg_no || '—') + '</td>' +
          '<td><strong>' + esc(r.student_name) + '</strong></td>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.75rem;">' + esc(r.reg_no) + '</td>' +
          '<td style="font-size:0.75rem;">' + esc(printed) + '</td>' +
          '<td style="font-size:0.75rem;">' + esc(r.tc_sent || '—') + '</td>' +
          '<td style="font-size:0.75rem;">' + esc(r.post_office_receipt || '—') + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' + actions + '</td></tr>';
      }).join('');
    }
    html += '</tbody></table></div></div>';

    hosts.forEach(function (h) { h.innerHTML = html; });
  };

  window.tcCompleteRegisterRow = async function (id) {
    var collegeEl = document.getElementById('tcRegCollege_' + id);
    var dateEl = document.getElementById('tcRegDate_' + id);
    var poEl = document.getElementById('tcRegPo_' + id);
    var college = collegeEl ? collegeEl.value.trim() : '';
    var sentDate = dateEl ? dateEl.value.trim() : '';
    var po = poEl ? poEl.value.trim() : '';
    if (!college || !sentDate || !po) {
      alert('⚠️ Enter college, TC sent date, and Post Office Receipt Number to complete.');
      return;
    }
    var sent = college + ' · ' + sentDate;
    var res = await apiQuiet('/api/tc', {
      method: 'PATCH',
      body: JSON.stringify({
        id: id,
        tcSent: sent,
        postOfficeReceipt: po,
        action: 'complete',
        status: 'completed',
        remarks: 'Sent to: ' + college + ' on ' + sentDate,
      }),
    });
    if (res && res.__error) { alert('⚠️ ' + res.__error); return; }
    if (!res || !res.ok) { alert('Failed to complete register entry.'); return; }
    alert('✅ TC Register entry completed.');
    window.renderTcRegister();
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  };

  /* ---------- Template editor (admin) ---------- */
  window.renderTcTemplateEditor = async function () {
    if (!isRootAdminUser()) {
      applyTcTemplateVisibility();
      alert('TC Template is available to Root Admin only.');
      return;
    }
    ensureTcPanels();
    await loadTemplate();
    var hosts = document.querySelectorAll('[data-tc-template-host="1"]');
    if (!hosts.length) return;

    var labels = (TC_STATE.template && TC_STATE.template.labels) || {};
    var header = (TC_STATE.template && TC_STATE.template.header) || {};
    var footer = (TC_STATE.template && TC_STATE.template.footer) || {};
    var hidden = hiddenRowSet();

    var sectionDefs = [
      { key: 'row1', title: '1. Student name' },
      { key: 'row2', title: '2. Father / Mother name' },
      { key: 'row3', title: '3. Date of birth' },
      { key: 'row4', title: '4. Admission date + Register No' },
      { key: 'row5', title: '5. Date of leaving' },
      { key: 'row6', title: '6. Class at leaving' },
      { key: 'row7', title: '7. Last semester' },
      { key: 'row8', title: '8. Qualified for promotion' },
      { key: 'row9', title: '9. All dues paid' },
      { key: 'row10', title: '10. Scholarship' },
      { key: 'row11', title: '11. Conduct' },
      { key: 'row12', title: '12. Religion / Caste' },
    ];

    var labelKeys = [
      'row1', 'row2_father', 'row2_mother', 'row3', 'row4_adm', 'row4_reg',
      'row5', 'row6', 'row7', 'row8', 'row9', 'row10', 'row11', 'row12_religion', 'row12_caste',
    ];
    var headerKeys = [
      'govt_kn', 'govt_en', 'dept_kn', 'dept_en', 'college_kn', 'college_en',
      'title_kn', 'title_en', 'adm_reg_label_kn', 'adm_reg_label_en', 'tc_no_label_kn', 'tc_no_label_en', 'emblem_url',
    ];
    // Principal only — no Clerk / ACM signature fields
    var footerKeys = [
      'place_kn', 'place_en', 'sign_right_kn', 'sign_right_en', 'note_kn', 'note_en',
    ];

    function rowEdit(section, key, obj) {
      var en = (obj[key] && obj[key].en) != null ? obj[key].en : (typeof obj[key] === 'string' ? obj[key] : '');
      var kn = (obj[key] && obj[key].kn) != null ? obj[key].kn : '';
      if (section !== 'labels') {
        en = obj[key] != null ? String(obj[key]) : '';
        return '<div class="fg" style="margin-bottom:8px;"><label>' + esc(key) + '</label>' +
          '<input type="text" data-tc-tpl="' + section + '.' + key + '" value="' + esc(en) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:7px;" /></div>';
      }
      return '<div style="display:grid;grid-template-columns:160px 1fr 1fr;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<div style="font-size:0.78rem;font-weight:700;">' + esc(key) + '</div>' +
        '<input type="text" data-tc-tpl="labels.' + key + '.kn" value="' + esc(kn) + '" placeholder="Kannada" style="padding:8px;border:1px solid var(--border);border-radius:7px;" />' +
        '<input type="text" data-tc-tpl="labels.' + key + '.en" value="' + esc(en) + '" placeholder="English" style="padding:8px;border:1px solid var(--border);border-radius:7px;" />' +
        '</div>';
    }

    var sectionChecks = sectionDefs.map(function (s) {
      var checked = hidden[s.key] ? '' : ' checked';
      return '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;font-size:0.82rem;cursor:pointer;">' +
        '<input type="checkbox" data-tc-section-show="' + s.key + '"' + checked + ' />' +
        '<span><strong>Show</strong> ' + esc(s.title) + '</span></label>';
    }).join('');

    var html = '<div class="card"><div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<h3 style="margin:0;">✏️ TC Template (Admin — paste exact Kannada here)</h3>' +
      '<button type="button" class="btn gr" onclick="window.tcSaveTemplate&&window.tcSaveTemplate()">💾 Save Template</button>' +
      '</div><div style="padding:16px;">' +
      '<div class="info-box" style="margin-bottom:14px;">Uncheck a section to <strong>remove it</strong> from Issue TC preview and A4 print. Serial numbers renumber automatically. Signature is <strong>Principal only</strong> (Clerk/ACM removed).</div>' +
      '<h4 style="margin:12px 0 8px;color:var(--navy);">Show / remove sections</h4>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-bottom:16px;">' + sectionChecks + '</div>' +
      '<h4 style="margin:12px 0 8px;color:var(--navy);">Header</h4>' +
      headerKeys.map(function (k) { return rowEdit('header', k, header); }).join('') +
      '<h4 style="margin:16px 0 8px;color:var(--navy);">Row labels (Kannada | English)</h4>' +
      '<div style="display:grid;grid-template-columns:160px 1fr 1fr;gap:8px;margin-bottom:6px;font-size:0.72rem;font-weight:700;opacity:.7;"><div>Key</div><div>Kannada</div><div>English</div></div>' +
      labelKeys.map(function (k) { return rowEdit('labels', k, labels); }).join('') +
      '<h4 style="margin:16px 0 8px;color:var(--navy);">Footer (Principal signature only)</h4>' +
      footerKeys.map(function (k) { return rowEdit('footer', k, footer); }).join('') +
      '<div id="tcTplMsg" style="margin-top:12px;font-size:0.85rem;"></div>' +
      '</div></div>';

    hosts.forEach(function (h) { h.innerHTML = html; });
  };

  window.tcSaveTemplate = async function () {
    if (!isRootAdminUser()) {
      alert('Only Root Admin can save the TC template.');
      return;
    }
    var labels = {};
    var header = {};
    var footer = {};
    document.querySelectorAll('[data-tc-tpl]').forEach(function (el) {
      var path = el.getAttribute('data-tc-tpl');
      var val = el.value;
      var parts = path.split('.');
      if (parts[0] === 'labels') {
        var key = parts[1];
        var side = parts[2];
        if (!labels[key]) labels[key] = { en: '', kn: '' };
        labels[key][side] = val;
      } else if (parts[0] === 'header') {
        header[parts[1]] = val;
      } else if (parts[0] === 'footer') {
        footer[parts[1]] = val;
      }
    });
    // Sections not checked = hidden
    var hiddenList = [];
    document.querySelectorAll('[data-tc-section-show]').forEach(function (cb) {
      if (!cb.checked) hiddenList.push(cb.getAttribute('data-tc-section-show'));
    });
    header.hidden_rows = hiddenList.join(',');
    if (!header.emblem_url) header.emblem_url = '/karnataka-emblem.png';
    // Clear leftover clerk signature keys
    footer.sign_left_en = '';
    footer.sign_left_kn = '';

    var res = await apiQuiet('/api/tc', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_template', labels: labels, header: header, footer: footer }),
    });
    var msg = document.getElementById('tcTplMsg');
    if (res && res.__error) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">⚠️ ' + esc(res.__error) + '</span>';
      alert('⚠️ ' + res.__error);
      return;
    }
    if (!res || !res.ok) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">Failed to save.</span>';
      return;
    }
    TC_STATE.template = { labels: labels, header: header, footer: footer };
    if (msg) {
      msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Template saved.' +
        (hiddenList.length ? ' Hidden sections: ' + esc(hiddenList.join(', ')) + '.' : ' All sections shown.') +
        ' Open Issue TC to see changes.</span>';
    }
  };

  /* ---------- Patch ACM queue actions for TC Proceed ---------- */
  function patchAcmPaintForProceed() {
    // Wrap acmPaintTables if present
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (typeof window.renderAcmModule !== 'function' && tries < 40) return;
      clearInterval(t);
      // Monkey-patch by observing rendered buttons: enhance after each renderAcmModule
      var orig = window.renderAcmModule;
      if (!orig || orig.__tcPatched) return;
      window.renderAcmModule = async function () {
        var r = await orig.apply(this, arguments);
        enhanceAcmActionsWithProceed();
        ensureTcPanels();
        return r;
      };
      window.renderAcmModule.__tcPatched = true;
      enhanceAcmActionsWithProceed();
      ensureTcPanels();
    }, 200);
  }

  function enhanceAcmActionsWithProceed() {
    // Find rows and inject Proceed for Transfer Certificate
    document.querySelectorAll('[data-acm-tbody="1"] tr').forEach(function (tr) {
      if (tr.getAttribute('data-tc-enhanced') === '1') return;
      var cells = tr.querySelectorAll('td');
      if (cells.length < 8) return;
      var typeText = (cells[4] && cells[4].textContent || '').toLowerCase();
      var isTc = typeText.indexOf('transfer') >= 0 || typeText.indexOf('tc') >= 0;
      if (!isTc) return;
      var regNo = (cells[2] && cells[2].textContent || '').trim();
      var actionCell = cells[7];
      if (!actionCell) return;
      // extract request id from existing onclick if present
      var btn = actionCell.querySelector('button[onclick*="acmUpdateRequest"]');
      var reqId = null;
      if (btn) {
        var m = String(btn.getAttribute('onclick') || '').match(/acmUpdateRequest\((\d+)/);
        if (m) reqId = Number(m[1]);
      }
      // also try from window._acmRequests
      if (!reqId && window._acmRequests) {
        var match = window._acmRequests.find(function (r) {
          return String(r.reg_no || '').toUpperCase() === regNo.toUpperCase() &&
            /transfer|tc/i.test(String(r.cert_type || ''));
        });
        if (match) reqId = match.id;
      }
      var proceed = document.createElement('button');
      proceed.className = 'btn';
      proceed.type = 'button';
      proceed.style.cssText = 'padding:4px 8px;font-size:0.72rem;background:#1a4fa0;color:#fff;margin-right:4px;';
      proceed.textContent = '▶ Proceed → Issue TC';
      proceed.onclick = function () {
        window.acmProceedTc(reqId, regNo);
      };
      actionCell.insertBefore(proceed, actionCell.firstChild);
      tr.setAttribute('data-tc-enhanced', '1');
    });
  }

  // Also enhance paint tables by wrapping if bridge exposes paint later
  // Boot
  function boot() {
    ensureTcPanels();
    patchAcmPaintForProceed();
    // If ACM already open
    if (document.getElementById('adACM') || document.getElementById('facACM')) {
      loadTemplate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 400); });
  } else {
    setTimeout(boot, 400);
  }

  // Expose for tab switchers
  window.ensureTcPanels = ensureTcPanels;
  window.TC_STATE = TC_STATE;
})();
