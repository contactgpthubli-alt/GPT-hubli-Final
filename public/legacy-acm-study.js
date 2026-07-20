/* =============================================================
 * GPT Hubli — Study & Studying Certificates (ACM Module)
 * Same workflow as TC: Issue form, A4 print, Register, Proceed
 * ============================================================= */
(function () {
  'use strict';

  var STUDY_STATE = {
    study: { template: null, registerId: null, certRequestId: null, form: {} },
    studying: { template: null, registerId: null, certRequestId: null, form: {} },
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

  function isRootAdminUser() {
    return !!(window.currentUser && window.currentUser.role === 'admin');
  }

  function st(kind) {
    return STUDY_STATE[kind] || STUDY_STATE.study;
  }

  function L(kind, key) {
    var labels = (st(kind).template && st(kind).template.labels) || {};
    return labels[key] != null ? String(labels[key]) : '';
  }

  function H(kind, key) {
    var header = (st(kind).template && st(kind).template.header) || {};
    return header[key] != null ? String(header[key]) : '';
  }

  function F(kind, key) {
    var footer = (st(kind).template && st(kind).template.footer) || {};
    return footer[key] != null ? String(footer[key]) : '';
  }

  function pickExtra(extra, keys) {
    if (!extra || typeof extra !== 'object') return '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (extra[k] != null && String(extra[k]).trim() !== '') return String(extra[k]).trim();
      var found = Object.keys(extra).find(function (ek) {
        return ek.replace(/\s+/g, ' ').trim().toLowerCase() === k.replace(/\s+/g, ' ').trim().toLowerCase();
      });
      if (found && extra[found] != null && String(extra[found]).trim() !== '') return String(extra[found]).trim();
    }
    return '';
  }

  /** Prefer the ACM shell the user is actually looking at (adACM vs facACM).
   *  Both shells exist in the DOM with duplicate field IDs — reading the wrong
   *  one made Print / Send think the form was empty after the user filled it. */
  function activeAcmRoot() {
    var ad = document.getElementById('adACM');
    var fac = document.getElementById('facACM');
    function isVisible(el) {
      if (!el) return false;
      try {
        var st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
      } catch (e) {
        if (el.style && el.style.display === 'none') return false;
      }
      return true;
    }
    if (isVisible(ad)) return ad;
    if (isVisible(fac)) return fac;
    // Fallback: section marked active by legacy showSec
    if (ad && ad.classList && ad.classList.contains('active')) return ad;
    if (fac && fac.classList && fac.classList.contains('active')) return fac;
    if (ad) return ad;
    return fac || document;
  }

  function activeStudyHost(kind) {
    var hostAttr = kind === 'studying' ? 'data-studying-form-host' : 'data-study-form-host';
    var root = activeAcmRoot();
    if (root && root.querySelector) {
      var inRoot = root.querySelector('[' + hostAttr + '="1"]');
      if (inRoot) return inRoot;
    }
    // Prefer a host whose panel is not display:none
    var hosts = document.querySelectorAll('[' + hostAttr + '="1"]');
    for (var i = 0; i < hosts.length; i++) {
      var panel = hosts[i].closest('[id$="AcmStudy"], [id$="AcmStudying"]') || hosts[i].parentElement;
      if (panel) {
        try {
          if (window.getComputedStyle(panel).display !== 'none') return hosts[i];
        } catch (e2) { /* ignore */ }
      }
    }
    return hosts[0] || null;
  }

  /** Resolve a form control inside the active Issue Study/Studying host only. */
  function formEl(kind, id) {
    var host = activeStudyHost(kind);
    if (host) {
      var scoped = host.querySelector('[id="' + id + '"]');
      if (scoped) return scoped;
    }
    // Last resort: first visible element with that id
    var all = document.querySelectorAll('[id="' + id + '"]');
    for (var i = 0; i < all.length; i++) {
      try {
        if (window.getComputedStyle(all[i]).display !== 'none') return all[i];
      } catch (e3) { /* ignore */ }
    }
    return all[0] || document.getElementById(id);
  }

  function getVal(kindOrId, maybeId) {
    // getVal(id) or getVal(kind, id)
    var kind = null;
    var id = kindOrId;
    if (maybeId != null && (kindOrId === 'study' || kindOrId === 'studying')) {
      kind = kindOrId;
      id = maybeId;
    }
    var el = kind ? formEl(kind, id) : (function () {
      var root = activeAcmRoot();
      if (root && root.querySelector) {
        var r = root.querySelector('[id="' + id + '"]');
        if (r) return r;
      }
      return document.getElementById(id);
    })();
    if (!el) return '';
    if (el.tagName === 'SPAN' || el.tagName === 'DIV') return String(el.textContent || '').trim();
    return String(el.value != null ? el.value : '').trim();
  }

  function setVal(a, b, c) {
    // setVal(id, v) or setVal(kind, id, v)
    var kind = null;
    var id;
    var v;
    if (arguments.length >= 3) {
      kind = a;
      id = b;
      v = c;
    } else {
      id = a;
      v = b;
    }
    var el = kind ? formEl(kind, id) : (function () {
      var root = activeAcmRoot();
      if (root && root.querySelector) {
        var r = root.querySelector('[id="' + id + '"]');
        if (r) return r;
      }
      return document.getElementById(id);
    })();
    if (el) el.value = v == null ? '' : String(v);
  }

  function setText(kind, id, v) {
    var el = formEl(kind, id);
    if (el) el.textContent = v == null ? '' : String(v);
  }

  function pfx(kind) {
    return kind === 'studying' ? 'syg' : 'sty';
  }

  function titleOf(kind) {
    return kind === 'studying' ? 'Studying Certificate' : 'Study Certificate';
  }

  /* ---------- tabs ---------- */
  function ensureStudyPanels() {
    ensureRoot('adACM', 'showAdACMTab', 'ad');
    ensureRoot('facACM', 'showFacACMTab', 'fac');
    applyStudyTemplateVisibility();
  }

  function applyStudyTemplateVisibility() {
    var allow = isRootAdminUser();
    document.querySelectorAll('[data-study-tab="template-study"], [data-study-tab="template-studying"]').forEach(function (btn) {
      btn.style.display = allow ? '' : 'none';
    });
    ;['adAcmStudyTpl', 'facAcmStudyTpl', 'adAcmStudyingTpl', 'facAcmStudyingTpl'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (!allow) { el.style.display = 'none'; }
    });
  }

  function ensureRoot(rootId, showFn, prefix) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var tabs = root.querySelector('.tabs');
    if (!tabs) return;
    if (document.getElementById(prefix + 'AcmStudy')) return;

    function addTab(attr, label, panelId, onOpen) {
      var btn = document.createElement('button');
      btn.className = 'tab';
      btn.type = 'button';
      btn.setAttribute('data-study-tab', attr);
      btn.textContent = label;
      btn.onclick = function () {
        window[showFn](panelId, btn);
        if (onOpen) onOpen();
      };
      tabs.appendChild(btn);
      return btn;
    }

    function addPanel(id, hostAttr) {
      var div = document.createElement('div');
      div.id = id;
      div.style.display = 'none';
      div.innerHTML = '<div ' + hostAttr + '="1"></div>';
      root.appendChild(div);
    }

    addTab('issue-study', '📋 Issue Study', prefix + 'AcmStudy', function () {
      window.mountStudyForm && window.mountStudyForm('study');
    });
    addTab('issue-studying', '🎓 Issue Studying', prefix + 'AcmStudying', function () {
      window.mountStudyForm && window.mountStudyForm('studying');
    });
    addTab('register-study', '📒 Study/Studying Register', prefix + 'AcmStudyReg', function () {
      window.renderStudyRegister && window.renderStudyRegister();
    });

    if (isRootAdminUser()) {
      addTab('template-study', '✏️ Study Template', prefix + 'AcmStudyTpl', function () {
        if (!isRootAdminUser()) return;
        window.renderStudyTemplateEditor && window.renderStudyTemplateEditor('study');
      });
      addTab('template-studying', '✏️ Studying Template', prefix + 'AcmStudyingTpl', function () {
        if (!isRootAdminUser()) return;
        window.renderStudyTemplateEditor && window.renderStudyTemplateEditor('studying');
      });
    }

    addPanel(prefix + 'AcmStudy', 'data-study-form-host');
    addPanel(prefix + 'AcmStudying', 'data-studying-form-host');
    addPanel(prefix + 'AcmStudyReg', 'data-study-register-host');
    if (isRootAdminUser()) {
      addPanel(prefix + 'AcmStudyTpl', 'data-study-template-host');
      addPanel(prefix + 'AcmStudyingTpl', 'data-studying-template-host');
    }
  }

  async function loadTemplate(kind) {
    var data = await apiQuiet('/api/acm-certs?kind=template&cert_kind=' + encodeURIComponent(kind) + '&_ts=' + Date.now());
    if (data && data.template) {
      st(kind).template = {
        labels: data.template.labels || {},
        header: data.template.header || {},
        footer: data.template.footer || {},
      };
    } else if (!st(kind).template) {
      st(kind).template = {
        labels: {},
        header: { emblem_url: '/karnataka-emblem.png' },
        footer: {},
      };
    }
    return st(kind).template;
  }

  /* ---------- form HTML ---------- */
  function field(id, ph, ro) {
    return '<input type="text" id="' + id + '" ' +
      (ro ? 'readonly style="background:#f8fafc;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;"' :
        'style="width:100%;padding:8px;border:1px solid #94a3b8;border-radius:6px;"') +
      ' placeholder="' + esc(ph || '') + '" />';
  }

  function buildFormHtml(kind) {
    var p = pfx(kind);
    var emblem = H(kind, 'emblem_url') || '/karnataka-emblem.png';
    var isStudying = kind === 'studying';
    var titleEn = L(kind, 'title_en') || (isStudying ? 'STUDYING CERTIFICATE' : 'STUDY CERTIFICATE');
    var titleKn = L(kind, 'title_kn') || (isStudying ? 'ಅಧ್ಯಯನ ಮಾಡುತ್ತಿರುವ ಪ್ರಮಾಣಪತ್ರ' : 'ಅಧ್ಯಯನ ಪ್ರಮಾಣಪತ್ರ');
    var color = isStudying ? '#b45309' : '#065f46';
    var ynCond = '<option value="">-- Select --</option><option>Satisfactory</option><option>Good</option><option>Unsatisfactory</option>';
    var semOpts = ['', '1st Sem', '2nd Sem', '3rd Sem', '4th Sem', '5th Sem', '6th Sem'].map(function (s) {
      return '<option value="' + s + '">' + (s || '-- Semester --') + '</option>';
    }).join('');

    var middleFields = isStudying
      ? (
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0;">' +
        '<div class="fg" style="margin:0;"><label>Current Semester *</label>' +
        '<select id="' + p + '_semester" style="width:100%;padding:8px;border:1px solid #94a3b8;border-radius:6px;">' + semOpts + '</select></div>' +
        '<div class="fg" style="margin:0;"><label>Current Year</label>' + field(p + '_year', 'e.g. 2nd Year') + '</div>' +
        '<div class="fg" style="margin:0;"><label>Academic Year *</label>' + field(p + '_acad_year', 'e.g. 2025–26') + '</div>' +
        '<div class="fg" style="margin:0;"><label>Character / Conduct *</label>' +
        '<select id="' + p + '_character" style="width:100%;padding:8px;border:1px solid #94a3b8;border-radius:6px;">' + ynCond + '</select></div>' +
        '</div>'
      )
      : (
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0;">' +
        '<div class="fg" style="margin:0;"><label>Studied From (Academic Year) *</label>' + field(p + '_from_year', 'e.g. 2022–23') + '</div>' +
        '<div class="fg" style="margin:0;"><label>Studied To (Academic Year) *</label>' + field(p + '_to_year', 'e.g. 2024–25') + '</div>' +
        '<div class="fg" style="margin:0;"><label>Class / Semesters completed</label>' + field(p + '_period_note', 'e.g. I to VI Semester') + '</div>' +
        '<div class="fg" style="margin:0;"><label>Character / Conduct *</label>' +
        '<select id="' + p + '_character" style="width:100%;padding:8px;border:1px solid #94a3b8;border-radius:6px;">' + ynCond + '</select></div>' +
        '</div>'
      );

    return '' +
      '<div class="card" style="padding:0;overflow:hidden;">' +
      '<div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">' + (isStudying ? '🎓' : '📋') + ' Issue ' + esc(titleOf(kind)) + '</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button type="button" class="btn ol" onclick="window.studyClearForm&&window.studyClearForm(\'' + kind + '\')">Clear</button>' +
      '<button type="button" class="btn gr" onclick="window.studyPrintA4&&window.studyPrintA4(\'' + kind + '\')">🖨️ Print A4</button>' +
      '<button type="button" class="btn" id="' + p + '_send_btn" style="background:#1d4ed8;color:#fff;" onclick="window.studySendToStudent&&window.studySendToStudent(\'' + kind + '\')">📤 Send to Student</button>' +
      '</div></div>' +
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border);background:#eff6ff;">' +
      '<div style="font-size:0.78rem;color:#1e3a8a;margin-bottom:8px;">Enter <strong>Register Number</strong> to auto-fetch (photo + details). Certificate No. is ACM-only. Use <strong>Print A4</strong> anytime. Use <strong>Send to Student</strong> so they can print from their portal.</div>' +
      '<div id="' + p + '_msg" style="font-size:0.82rem;"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">' +
      '<div class="fg" style="margin:0;"><label>Quick load Register No.</label>' +
      '<input type="text" id="' + p + '_quick" placeholder="Reg no + Enter" style="width:100%;padding:8px;border:1.5px solid #f59e0b;border-radius:8px;" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.studyFetchByReg&&window.studyFetchByReg(\'' + kind + '\',this.value);}" /></div>' +
      '<div class="fg" style="margin:0;"><label>Linked Cert Request</label>' +
      '<input type="text" id="' + p + '_linked" readonly style="width:100%;padding:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;" placeholder="—" /></div>' +
      '<div class="fg" style="margin:0;"><label>Register entry ID</label>' +
      '<input type="text" id="' + p + '_regid" readonly style="width:100%;padding:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;" placeholder="New" /></div>' +
      '</div></div>' +

      // A4 sheet
      '<div id="' + p + '_sheet" style="max-width:210mm;margin:16px auto;padding:14mm 16mm;background:#fff;color:#0f172a;border:1px solid #cbd5e1;box-shadow:0 4px 24px rgba(0,0,0,.08);font-family:\'Times New Roman\',Times,serif;">' +

      '<div style="text-align:center;margin-bottom:12px;">' +
      '<img src="' + esc(emblem) + '" alt="Emblem" style="width:72px;height:72px;object-fit:contain;display:block;margin:0 auto 6px;" />' +
      '<div style="font-size:0.95rem;font-weight:700;">' + esc(H(kind, 'govt_kn') || 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ') + '</div>' +
      '<div style="font-size:0.82rem;font-weight:700;letter-spacing:.04em;">' + esc(H(kind, 'govt_en') || 'GOVERNMENT OF KARNATAKA') + '</div>' +
      '<div style="font-size:0.78rem;margin-top:2px;">' + esc(H(kind, 'dept_en') || 'Department of Technical Education') + '</div>' +
      '<div style="font-size:1.05rem;font-weight:800;margin-top:6px;color:' + color + ';">' + esc(H(kind, 'college_en') || 'GOVERNMENT POLYTECHNIC, HUBBALLI') + '</div>' +
      '<div style="font-size:0.9rem;font-weight:700;">' + esc(H(kind, 'college_kn') || 'ಸರ್ಕಾರಿ ಪಾಲಿಟೆಕ್ನಿಕ್, ಹುಬ್ಬಳ್ಳಿ') + '</div>' +
      '<div style="margin-top:12px;font-size:1.15rem;font-weight:800;text-decoration:underline;color:' + color + ';">' + esc(titleEn) + '</div>' +
      '<div style="font-size:0.95rem;font-weight:700;">' + esc(titleKn) + '</div>' +
      '</div>' +

      '<div style="display:flex;justify-content:space-between;gap:16px;margin:12px 0 14px;font-size:0.88rem;align-items:flex-start;">' +
      '<div style="flex:1;"><div style="font-weight:600;margin-bottom:4px;">' +
      esc(L(kind, 'cert_no_label_kn') || '') + (L(kind, 'cert_no_label_kn') ? '<br>' : '') +
      esc(L(kind, 'cert_no_label_en') || 'Certificate No.') + '</div>' +
      field(p + '_cert_no', 'ACM enters certificate number') + '</div>' +
      '<div style="text-align:center;flex-shrink:0;">' +
      '<div style="font-size:0.72rem;font-weight:700;margin-bottom:4px;opacity:.75;">Student Photo</div>' +
      '<div id="' + p + '_photo_box" style="width:100px;height:120px;border:1.5px solid #334155;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden;">' +
      '<span style="font-size:0.68rem;opacity:.55;padding:4px;">Auto from profile</span></div>' +
      '<input type="hidden" id="' + p + '_photo" value="" />' +
      '</div></div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '<div class="fg" style="margin:0;"><label>Register No. *</label>' +
      '<div style="display:flex;gap:6px;">' +
      '<input type="text" id="' + p + '_reg_no" placeholder="Type reg no to fetch" style="flex:1;padding:8px;border:2px solid ' + color + ';border-radius:6px;font-family:JetBrains Mono,monospace;font-weight:700;" ' +
      'onblur="window.studyFetchByReg&&window.studyFetchByReg(\'' + kind + '\',this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.studyFetchByReg&&window.studyFetchByReg(\'' + kind + '\',this.value);}" />' +
      '<button type="button" class="btn ol" style="padding:4px 10px;font-size:0.75rem;" onclick="window.studyFetchByReg&&window.studyFetchByReg(\'' + kind + '\',document.getElementById(\'' + p + '_reg_no\').value)">Fetch</button>' +
      '</div></div>' +
      '<div class="fg" style="margin:0;"><label>Full Name *</label>' + field(p + '_name', 'Auto from profile') + '</div>' +
      '<div class="fg" style="margin:0;"><label>Father Name</label>' + field(p + '_father', 'Auto from profile') + '</div>' +
      '<div class="fg" style="margin:0;"><label>Mother Name</label>' + field(p + '_mother', 'Auto from profile') + '</div>' +
      '<div class="fg" style="margin:0;grid-column:1/-1;"><label>Branch / Course *</label>' + field(p + '_branch', 'Auto from profile') + '</div>' +
      '</div>' +

      middleFields +

      '<div class="fg" style="margin:10px 0 0;"><label>Purpose *</label>' +
      field(p + '_purpose', 'e.g. Higher education / Scholarship / Bank loan') + '</div>' +

      // Live certificate prose preview (paragraph style with space before body text)
      '<div style="margin-top:28px;padding:18px 16px;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;font-size:0.92rem;line-height:1.75;text-align:justify;text-indent:2em;" id="' + p + '_prose">' +
      '<em style="opacity:.65;text-indent:0;display:inline-block;">Fill fields above — certificate wording updates here.</em></div>' +

      '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;font-size:0.85rem;">' +
      '<div>' +
      '<div>' + esc(F(kind, 'place_kn') || 'ಸ್ಥಳ: ಹುಬ್ಬಳ್ಳಿ') + '</div>' +
      '<div>' + esc(F(kind, 'place_en') || 'Place: Hubballi') + '</div>' +
      '<div style="margin-top:8px;"><strong>Date:</strong> <span id="' + p + '_print_date">—</span></div>' +
      '<div><strong>Time:</strong> <span id="' + p + '_print_time">—</span></div>' +
      '</div>' +
      '<div style="text-align:center;min-width:180px;">' +
      '<div style="height:56px;"></div>' +
      '<div style="border-top:1px solid #334155;padding-top:4px;font-size:0.78rem;">' +
      esc(F(kind, 'sign_right_kn') || 'ಪ್ರಾಂಶುಪಾಲರು') + '<br>' + esc(F(kind, 'sign_right_en') || 'Principal') +
      '</div></div></div>' +
      '<div style="margin-top:12px;font-size:0.75rem;opacity:.75;font-style:italic;">' +
      esc(F(kind, 'note_kn') || '') + (F(kind, 'note_kn') ? ' · ' : '') + esc(F(kind, 'note_en') || '') +
      '</div>' +
      '</div>' + // end A4 sheet
      '</div>';
  }

  function extractPhoto(extra) {
    if (!extra || typeof extra !== 'object') return '';
    var keys = ['Profile Photo', 'profile_photo', 'photo', 'Photo'];
    for (var i = 0; i < keys.length; i++) {
      var v = extra[keys[i]];
      if (typeof v === 'string' && v.indexOf('data:image/') === 0) return v;
    }
    var found = Object.keys(extra).find(function (k) {
      return /profile\s*photo|^photo$/i.test(k) && typeof extra[k] === 'string' && String(extra[k]).indexOf('data:image/') === 0;
    });
    return found ? String(extra[found]) : '';
  }

  function setPhotoUI(kind, photoUrl) {
    var p = pfx(kind);
    var box = formEl(kind, p + '_photo_box');
    var hid = formEl(kind, p + '_photo');
    if (hid) hid.value = photoUrl || '';
    if (!box) return;
    if (photoUrl && photoUrl.indexOf('data:image/') === 0) {
      box.innerHTML = '<img src="' + photoUrl.replace(/"/g, '&quot;') + '" alt="Student" style="width:100%;height:100%;object-fit:cover;" />';
    } else {
      box.innerHTML = '<span style="font-size:0.68rem;opacity:.55;padding:4px;text-align:center;">No profile photo</span>';
    }
  }

  function updateSendBtn(kind, entry) {
    var p = pfx(kind);
    var btn = formEl(kind, p + '_send_btn');
    if (!btn) return;
    var already = entry && entry.sent_to_student;
    btn.style.display = '';
    btn.disabled = !!already;
    btn.textContent = already ? '✅ Sent to Student' : '📤 Send to Student';
    btn.style.opacity = already ? '0.85' : '1';
  }

  function tickDateTime(kind) {
    var p = pfx(kind);
    var now = new Date();
    var dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setText(kind, p + '_print_date', dateStr);
    setText(kind, p + '_print_time', timeStr);
  }

  function updateProse(kind) {
    var p = pfx(kind);
    var box = formEl(kind, p + '_prose');
    if (!box) return;
    var name = getVal(kind, p + '_name') || '_______________';
    var father = getVal(kind, p + '_father') || '_______________';
    var reg = getVal(kind, p + '_reg_no') || '_______________';
    var branch = getVal(kind, p + '_branch') || '_______________';
    var character = getVal(kind, p + '_character') || '_______________';
    var purpose = getVal(kind, p + '_purpose') || '_______________';
    var html = '';
    if (kind === 'studying') {
      var sem = getVal(kind, p + '_semester') || '_______________';
      var year = getVal(kind, p + '_year');
      var acad = getVal(kind, p + '_acad_year') || '_______________';
      html =
        '<div style="margin-bottom:6px;font-size:0.8rem;opacity:.75;">' + esc(L(kind, 'body_prefix_kn') || '') + '</div>' +
        esc(L(kind, 'body_prefix_en') || 'This is to certify that') +
        ' <strong>Sri / Kum. ' + esc(name) + '</strong> ' +
        esc(L(kind, 'son_daughter_en') || 'S/o / D/o') + ' <strong>' + esc(father) + '</strong>, ' +
        esc(L(kind, 'reg_label_en') || 'bearing Register No.') + ' <strong>' + esc(reg) + '</strong>, ' +
        esc(L(kind, 'is_student_en') || 'is a bonafide student of this institution presently studying in') +
        ' <strong>' + esc(sem) + (year ? ' (' + esc(year) + ')' : '') + '</strong> ' +
        esc(L(kind, 'of_diploma_en') || 'of the Diploma course in') + ' <strong>' + esc(branch) + '</strong> ' +
        esc(L(kind, 'academic_year_en') || 'during the academic year') + ' <strong>' + esc(acad) + '</strong>. ' +
        esc(L(kind, 'character_en') || 'His / Her character and conduct is') + ' <strong>' + esc(character) + '</strong>. ' +
        esc(L(kind, 'purpose_en') || 'This certificate is issued on his/her request for the purpose of') +
        ' <strong>' + esc(purpose) + '</strong>. ' +
        esc(L(kind, 'records_en') || 'The above particulars are true and correct as per the records of this institution.');
    } else {
      var fromY = getVal(kind, p + '_from_year') || '_______________';
      var toY = getVal(kind, p + '_to_year') || '_______________';
      var period = getVal(kind, p + '_period_note');
      html =
        '<div style="margin-bottom:6px;font-size:0.8rem;opacity:.75;">' + esc(L(kind, 'body_prefix_kn') || '') + '</div>' +
        esc(L(kind, 'body_prefix_en') || 'This is to certify that') +
        ' <strong>Sri / Kum. ' + esc(name) + '</strong> ' +
        esc(L(kind, 'son_daughter_en') || 'S/o / D/o') + ' <strong>' + esc(father) + '</strong>, ' +
        esc(L(kind, 'reg_label_en') || 'bearing Register No.') + ' <strong>' + esc(reg) + '</strong>, ' +
        esc(L(kind, 'was_student_en') || 'was a bonafide student of this institution and has studied the Diploma course in') +
        ' <strong>' + esc(branch) + '</strong> ' +
        esc(L(kind, 'during_en') || 'during the academic year(s)') +
        ' <strong>' + esc(fromY) + '</strong> ' + esc(L(kind, 'to_en') || 'to') + ' <strong>' + esc(toY) + '</strong>' +
        (period ? ' (' + esc(period) + ')' : '') + '. ' +
        esc(L(kind, 'character_en') || 'His / Her character and conduct during the period of study was') +
        ' <strong>' + esc(character) + '</strong>. ' +
        esc(L(kind, 'purpose_en') || 'This certificate is issued on his/her request for the purpose of') +
        ' <strong>' + esc(purpose) + '</strong>. ' +
        esc(L(kind, 'records_en') || 'The above particulars are true and correct as per the records of this institution.');
    }
    box.innerHTML = html;
  }

  function bindLive(kind) {
    var p = pfx(kind);
    var sheet = formEl(kind, p + '_sheet');
    if (!sheet) return;
    sheet.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('input', function () { updateProse(kind); });
      el.addEventListener('change', function () { updateProse(kind); });
    });
    updateProse(kind);
  }

  window.mountStudyForm = async function (kind) {
    kind = kind === 'studying' ? 'studying' : 'study';
    ensureStudyPanels();
    await loadTemplate(kind);
    var hostAttr = kind === 'studying' ? 'data-studying-form-host' : 'data-study-form-host';
    var html = buildFormHtml(kind);
    // Mount into active shell first so IDs resolve correctly; then mirror to other hosts
    var active = activeStudyHost(kind);
    if (active) {
      active.innerHTML = html;
    }
    document.querySelectorAll('[' + hostAttr + '="1"]').forEach(function (host) {
      if (host !== active) host.innerHTML = html;
    });
    tickDateTime(kind);
    bindLive(kind);
    if (st(kind).form && st(kind).form.reg_no) applyForm(kind, st(kind).form);
    var p = pfx(kind);
    if (st(kind).registerId) setVal(kind, p + '_regid', String(st(kind).registerId));
    if (st(kind).certRequestId) setVal(kind, p + '_linked', 'Req #' + st(kind).certRequestId);
    updateSendBtn(kind, st(kind).registerId ? { sent_to_student: false } : null);
  };

  function collectForm(kind) {
    var p = pfx(kind);
    var f = {
      cert_no: getVal(kind, p + '_cert_no'),
      reg_no: getVal(kind, p + '_reg_no'),
      student_name: getVal(kind, p + '_name'),
      father_name: getVal(kind, p + '_father'),
      mother_name: getVal(kind, p + '_mother'),
      branch: getVal(kind, p + '_branch'),
      character: getVal(kind, p + '_character'),
      purpose: getVal(kind, p + '_purpose'),
      photo: getVal(kind, p + '_photo') || (st(kind).form && st(kind).form.photo) || '',
      sent_to_college: '',
      sent_date: '',
      po_receipt: '',
      print_date: getVal(kind, p + '_print_date') || '',
      print_time: getVal(kind, p + '_print_time') || '',
    };
    if (kind === 'studying') {
      f.semester = getVal(kind, p + '_semester');
      f.year = getVal(kind, p + '_year');
      f.acad_year = getVal(kind, p + '_acad_year');
    } else {
      f.from_year = getVal(kind, p + '_from_year');
      f.to_year = getVal(kind, p + '_to_year');
      f.period_note = getVal(kind, p + '_period_note');
    }
    return f;
  }

  function applyForm(kind, f) {
    if (!f) return;
    var p = pfx(kind);
    setVal(kind, p + '_cert_no', f.cert_no);
    setVal(kind, p + '_reg_no', f.reg_no);
    setVal(kind, p + '_quick', f.reg_no);
    setVal(kind, p + '_name', f.student_name);
    setVal(kind, p + '_father', f.father_name);
    setVal(kind, p + '_mother', f.mother_name);
    setVal(kind, p + '_branch', f.branch);
    setVal(kind, p + '_character', f.character);
    setVal(kind, p + '_purpose', f.purpose);
    if (kind === 'studying') {
      setVal(kind, p + '_semester', f.semester);
      setVal(kind, p + '_year', f.year);
      setVal(kind, p + '_acad_year', f.acad_year);
    } else {
      setVal(kind, p + '_from_year', f.from_year);
      setVal(kind, p + '_to_year', f.to_year);
      setVal(kind, p + '_period_note', f.period_note);
    }
    setPhotoUI(kind, f.photo || '');
    updateProse(kind);
  }

  window.studyClearForm = function (kind) {
    kind = kind === 'studying' ? 'studying' : 'study';
    st(kind).registerId = null;
    st(kind).certRequestId = null;
    st(kind).form = {};
    window.mountStudyForm(kind);
  };

  window.studyFetchByReg = async function (kind, reg) {
    kind = kind === 'studying' ? 'studying' : 'study';
    var p = pfx(kind);
    reg = String(reg || '').trim();
    if (!reg) { alert('Enter Register Number'); return; }
    setVal(kind, p + '_reg_no', reg);
    setVal(kind, p + '_quick', reg);

    var list = window._acmStudentsCache;
    if (!list || !list.length) {
      var data = await apiQuiet('/api/students?_ts=' + Date.now());
      list = (data && data.students) ? data.students : [];
      window._acmStudentsCache = list;
    }
    var stu = list.find(function (s) {
      return String(s.reg_no || '').toUpperCase() === reg.toUpperCase();
    }) || list.find(function (s) {
      return String(s.reg_no || '').toUpperCase().indexOf(reg.toUpperCase()) >= 0;
    });
    if (!stu) {
      alert('Student not found for: ' + reg);
      return;
    }
    var extra = stu.extra || {};
    if (typeof extra === 'string') {
      try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
    }
    var name = stu.name || pickExtra(extra, ['Student (As per SSLC)', 'Student (As per Aadhar)', 'Name']) || '';
    var father = stu.father || pickExtra(extra, ['Father Name', "Father's Name"]) || '';
    var mother = pickExtra(extra, ['Mother Name', "Mother's Name"]) || '';
    var branch = stu.dept || pickExtra(extra, ['Branch']) || '';
    var year = stu.year || pickExtra(extra, ['Current Year']) || '';
    var photo = extractPhoto(extra);

    var form = Object.assign({}, st(kind).form || {}, {
      reg_no: stu.reg_no || reg,
      student_name: name,
      father_name: father,
      mother_name: mother,
      branch: branch,
      photo: photo,
      cert_no: getVal(kind, p + '_cert_no'),
      character: getVal(kind, p + '_character'),
      purpose: getVal(kind, p + '_purpose'),
    });
    if (kind === 'studying') {
      form.year = year;
      form.semester = getVal(kind, p + '_semester');
      form.acad_year = getVal(kind, p + '_acad_year') || academicYearGuess();
      // semester guess
      var y = String(year).toLowerCase();
      if (!form.semester) {
        if (y.indexOf('1') === 0) form.semester = '2nd Sem';
        else if (y.indexOf('2') === 0) form.semester = '4th Sem';
        else if (y.indexOf('3') === 0) form.semester = '6th Sem';
      }
    } else {
      form.from_year = getVal(kind, p + '_from_year');
      form.to_year = getVal(kind, p + '_to_year');
      form.period_note = getVal(kind, p + '_period_note') || (year ? ('Up to ' + year) : '');
    }
    st(kind).form = form;
    applyForm(kind, form);
    tickDateTime(kind);
  };

  function academicYearGuess() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth(); // 0-based
    // academic year typically Jun–May
    if (m >= 5) return y + '–' + String(y + 1).slice(2);
    return (y - 1) + '–' + String(y).slice(2);
  }

  /* ---------- Proceed ---------- */
  window.acmProceedStudy = async function (certReqId, regNo, kind) {
    kind = kind === 'studying' ? 'studying' : 'study';
    ensureStudyPanels();
    st(kind).certRequestId = certReqId || null;
    st(kind).registerId = null;

    if (certReqId && window.api && window.api.patch) {
      try {
        await window.api.patch('/api/cert-requests', {
          id: certReqId,
          status: 'processing',
          remarks: titleOf(kind) + ' Proceed — opened issue form at ACM.',
        });
      } catch (e) { /* ignore */ }
    }

    var useAd = !!document.getElementById('adAcmStudy') || !!document.getElementById('adACM');
    var prefix = useAd ? 'ad' : 'fac';
    var showFn = useAd ? 'showAdACMTab' : 'showFacACMTab';
    var panelId = prefix + (kind === 'studying' ? 'AcmStudying' : 'AcmStudy');
    var btn = document.querySelector('#' + prefix + 'ACM [data-study-tab="issue-' + kind + '"]');
    if (!document.getElementById(prefix + 'ACM') || (document.getElementById(prefix + 'ACM').offsetParent === null && document.getElementById('adACM'))) {
      if (typeof window.showSec === 'function') {
        var link = document.querySelector('[onclick*="adACM"]');
        window.showSec('adACM', link);
      }
      prefix = 'ad';
      showFn = 'showAdACMTab';
      panelId = kind === 'studying' ? 'adAcmStudying' : 'adAcmStudy';
      btn = document.querySelector('#adACM [data-study-tab="issue-' + kind + '"]');
    }
    if (typeof window[showFn] === 'function') window[showFn](panelId, btn);
    await window.mountStudyForm(kind);
    if (regNo) await window.studyFetchByReg(kind, regNo);
    var p = pfx(kind);
    if (st(kind).certRequestId) setVal(kind, p + '_linked', 'Req #' + st(kind).certRequestId);
    var sheet = formEl(kind, p + '_sheet');
    if (sheet) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  };

  /* ---------- Print ---------- */
  function buildPrintHtml(kind, form) {
    var emblem = H(kind, 'emblem_url') || '/karnataka-emblem.png';
    var isStudying = kind === 'studying';
    var titleEn = L(kind, 'title_en') || (isStudying ? 'STUDYING CERTIFICATE' : 'STUDY CERTIFICATE');
    var titleKn = L(kind, 'title_kn') || '';
    var body = '';
    if (isStudying) {
      body =
        (L(kind, 'body_prefix_en') || 'This is to certify that') +
        ' <strong>Sri / Kum. ' + esc(form.student_name) + '</strong> ' +
        (L(kind, 'son_daughter_en') || 'S/o / D/o') + ' <strong>' + esc(form.father_name) + '</strong>, ' +
        (L(kind, 'reg_label_en') || 'bearing Register No.') + ' <strong>' + esc(form.reg_no) + '</strong>, ' +
        (L(kind, 'is_student_en') || 'is a bonafide student of this institution presently studying in') +
        ' <strong>' + esc(form.semester || '') + (form.year ? ' (' + esc(form.year) + ')' : '') + '</strong> ' +
        (L(kind, 'of_diploma_en') || 'of the Diploma course in') + ' <strong>' + esc(form.branch) + '</strong> ' +
        (L(kind, 'academic_year_en') || 'during the academic year') + ' <strong>' + esc(form.acad_year || '') + '</strong>. ' +
        (L(kind, 'character_en') || 'His / Her character and conduct is') + ' <strong>' + esc(form.character) + '</strong>. ' +
        (L(kind, 'purpose_en') || 'This certificate is issued on his/her request for the purpose of') +
        ' <strong>' + esc(form.purpose) + '</strong>. ' +
        (L(kind, 'records_en') || 'The above particulars are true and correct as per the records of this institution.');
    } else {
      body =
        (L(kind, 'body_prefix_en') || 'This is to certify that') +
        ' <strong>Sri / Kum. ' + esc(form.student_name) + '</strong> ' +
        (L(kind, 'son_daughter_en') || 'S/o / D/o') + ' <strong>' + esc(form.father_name) + '</strong>, ' +
        (L(kind, 'reg_label_en') || 'bearing Register No.') + ' <strong>' + esc(form.reg_no) + '</strong>, ' +
        (L(kind, 'was_student_en') || 'was a bonafide student of this institution and has studied the Diploma course in') +
        ' <strong>' + esc(form.branch) + '</strong> ' +
        (L(kind, 'during_en') || 'during the academic year(s)') +
        ' <strong>' + esc(form.from_year || '') + '</strong> ' + (L(kind, 'to_en') || 'to') +
        ' <strong>' + esc(form.to_year || '') + '</strong>' +
        (form.period_note ? ' (' + esc(form.period_note) + ')' : '') + '. ' +
        (L(kind, 'character_en') || 'His / Her character and conduct during the period of study was') +
        ' <strong>' + esc(form.character) + '</strong>. ' +
        (L(kind, 'purpose_en') || 'This certificate is issued on his/her request for the purpose of') +
        ' <strong>' + esc(form.purpose) + '</strong>. ' +
        (L(kind, 'records_en') || 'The above particulars are true and correct as per the records of this institution.');
    }

    var photo = form.photo && String(form.photo).indexOf('data:image/') === 0
      ? String(form.photo)
      : '';
    // Note: photo is a data URL — inject raw for print (not HTML-escaped)
    var photoBlock = photo
      ? '<div class="photo"><img src="' + photo.replace(/"/g, '') + '" alt="Student photo" /></div>'
      : '';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(titleEn) + ' - ' + esc(form.reg_no) + '</title>' +
      '<style>' +
      '@page{size:A4;margin:14mm;}' +
      'body{font-family:"Times New Roman",Times,serif;color:#000;margin:0;padding:8mm;line-height:1.65;}' +
      '.hdr{text-align:center;margin-bottom:10px;}' +
      '.hdr img.emblem{width:70px;height:70px;object-fit:contain;}' +
      '.meta-row{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0 8px;font-size:13px;}' +
      '.photo{width:100px;height:120px;border:1px solid #000;overflow:hidden;flex-shrink:0;}' +
      '.photo img{width:100%;height:100%;object-fit:cover;display:block;}' +
      /* Paragraph style: clear gap after photo/cert-no, justified body with first-line indent */
      '.body{font-size:14px;text-align:justify;margin-top:28px;padding-top:6px;line-height:1.75;text-indent:2.5em;}' +
      '.body p{margin:0 0 12px 0;text-indent:2.5em;text-align:justify;}' +
      '.body:after{content:"";display:table;clear:both;}' +
      '.foot{display:flex;justify-content:space-between;margin-top:48px;font-size:12.5px;}' +
      '.sig{text-align:center;min-width:160px;}' +
      '.sig .line{border-top:1px solid #000;margin-top:48px;padding-top:4px;}' +
      '</style></head><body>' +
      '<div class="hdr">' +
      '<img class="emblem" src="' + esc(emblem) + '" alt="Emblem" />' +
      '<div style="font-size:14px;font-weight:700;">' + esc(H(kind, 'govt_kn') || 'ಕರ್ನಾಟಕ ಸರ್ಕಾರ') + '</div>' +
      '<div style="font-size:12px;font-weight:700;">' + esc(H(kind, 'govt_en') || 'GOVERNMENT OF KARNATAKA') + '</div>' +
      '<div style="font-size:11px;">' + esc(H(kind, 'dept_en') || 'Department of Technical Education') + '</div>' +
      '<div style="font-size:15px;font-weight:800;margin-top:4px;">' + esc(H(kind, 'college_en') || 'GOVERNMENT POLYTECHNIC, HUBBALLI') + '</div>' +
      '<div style="font-size:13px;font-weight:700;">' + esc(H(kind, 'college_kn') || '') + '</div>' +
      '<div style="font-size:16px;font-weight:800;text-decoration:underline;margin-top:10px;">' + esc(titleEn) + '</div>' +
      (titleKn ? '<div style="font-size:14px;font-weight:700;">' + esc(titleKn) + '</div>' : '') +
      '</div>' +
      '<div class="meta-row">' +
      '<div><strong>' + esc(L(kind, 'cert_no_label_en') || 'Certificate No.') + ':</strong> ' + esc(form.cert_no) + '</div>' +
      photoBlock +
      '</div>' +
      '<div class="body"><p>' + body + '</p></div>' +
      '<div class="foot">' +
      '<div>' + esc(F(kind, 'place_en') || 'Place: Hubballi') +
      '<br><strong>Date:</strong> ' + esc(form.print_date) +
      '<br><strong>Time:</strong> ' + esc(form.print_time) + '</div>' +
      '<div class="sig"><div class="line">' +
      esc(F(kind, 'sign_right_kn') || 'ಪ್ರಾಂಶುಪಾಲರು') + '<br>' +
      esc(F(kind, 'sign_right_en') || 'Principal') +
      '</div></div></div>' +
      '<div style="margin-top:12px;font-size:11px;font-style:italic;">' + esc(F(kind, 'note_en') || '') + '</div>' +
      '</body></html>';
  }

  /** Used by ACM and student portal print */
  window.buildStudyPrintHtml = buildPrintHtml;
  window.studyDoPrintHtml = function (html) {
    // Mobile WebView cannot print zero-size iframes — use shared full-screen preview
    if (typeof window.gpthPrintHtml === 'function') {
      window.gpthPrintHtml(html, { title: 'Certificate', filename: 'study-certificate.html' });
      return;
    }
    var iframe = document.getElementById('studyPrintFrame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'studyPrintFrame';
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
  };

  window.studyPrintA4 = async function (kind) {
    kind = kind === 'studying' ? 'studying' : 'study';
    tickDateTime(kind);
    var form = collectForm(kind);
    if (!form.reg_no) { alert('Register Number is required.'); return; }
    if (!form.cert_no) { alert('Certificate No. is required (ACM enters this).'); return; }
    if (!form.student_name) { alert('Student name is empty. Fetch by Register Number first.'); return; }
    if (!form.branch) { alert('Branch / Course is required.'); return; }
    if (!form.character) { alert('Select Character / Conduct.'); return; }
    if (!form.purpose) { alert('Enter Purpose.'); return; }
    if (kind === 'studying') {
      if (!form.semester) { alert('Select Current Semester.'); return; }
      if (!form.acad_year) { alert('Enter Academic Year.'); return; }
    } else {
      if (!form.from_year || !form.to_year) { alert('Enter studied From and To academic years.'); return; }
    }

    st(kind).form = form;
    var p = pfx(kind);
    var msg = formEl(kind, p + '_msg');

    // Always print from the filled form first (ACM desk copy)
    window.studyDoPrintHtml(buildPrintHtml(kind, form));

    // Then save as completed so Send to Student works (show errors — never silent)
    var saved = await window.studySaveRegister(kind, 'complete', false);
    updateSendBtn(kind, saved);
    if (msg) {
      if (saved) {
        msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Printed &amp; saved. Click <strong>Send to Student</strong> to release for student printout.</span>';
      } else {
        msg.innerHTML = '<span style="color:#991b1b;font-weight:700;">⚠️ Printed locally, but save failed. Fix the error above and try Print again before Send to Student.</span>';
      }
    }
  };

  window.studySendToStudent = async function (kind) {
    kind = kind === 'studying' ? 'studying' : 'study';
    var p = pfx(kind);
    var msg = formEl(kind, p + '_msg');

    // Save/complete first (shows field/API errors)
    var entry = await window.studySaveRegister(kind, 'complete', false);
    if (!entry) {
      alert('Could not save certificate. Fill Certificate No., fetch student by Register No., and complete required fields, then try again.');
      return;
    }
    var id = entry.id || st(kind).registerId;
    if (!id) {
      alert('Certificate was not saved (no register id). Try Print A4 once, then Send to Student.');
      return;
    }
    var res = await apiQuiet('/api/acm-certs', {
      method: 'POST',
      body: JSON.stringify({ action: 'send_to_student', id: id }),
    });
    if (res && res.__error) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;font-weight:700;">⚠️ ' + esc(res.__error) + '</span>';
      alert('⚠️ ' + res.__error);
      return;
    }
    if (!res || !res.ok) {
      alert('Failed to send certificate to student.');
      return;
    }
    updateSendBtn(kind, res.entry);
    if (msg) {
      msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Sent to student portal. Student can print from Certificates → My Requests.</span>';
    }
    alert('✅ Certificate released to student.\n\nThey can open Certificates → My Requests → Print.');
    if (typeof window.renderStudyRegister === 'function') window.renderStudyRegister();
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
  };

  window.studySaveRegister = async function (kind, mode, silent) {
    kind = kind === 'studying' ? 'studying' : 'study';
    tickDateTime(kind);
    var form = collectForm(kind);
    if (!form.reg_no) { if (!silent) alert('Register Number required'); return null; }
    if (!form.cert_no) { if (!silent) alert('Certificate No. required'); return null; }
    if (!form.student_name) { if (!silent) alert('Student name required — fetch by Register No.'); return null; }

    // Study/Studying: no college/PO gate — print or complete both mark completed
    var action = (mode === 'print' || mode === 'complete') ? 'complete' : 'save_draft';
    var status = (mode === 'print' || mode === 'complete') ? 'completed' : 'draft';

    // Avoid bloating DB with huge photo if already on student profile (keep small data URLs)
    var formData = Object.assign({}, form);
    if (formData.photo && String(formData.photo).length > 120000) {
      // keep a flag so print still works from memory; store path marker only
      formData.photo_kept_local = true;
      // still store photo for student re-print if moderate; drop only if enormous
      if (String(formData.photo).length > 400000) formData.photo = '';
    }

    var body = {
      action: action,
      id: st(kind).registerId || undefined,
      certKind: kind,
      regNo: form.reg_no,
      certNo: form.cert_no,
      studentName: form.student_name,
      fatherName: form.father_name,
      motherName: form.mother_name,
      branch: form.branch,
      formData: formData,
      certRequestId: st(kind).certRequestId || undefined,
      sentToCollege: '',
      sentDate: '',
      postOfficeReceipt: '',
      status: status,
      skipDispatch: true,
    };

    var res = await apiQuiet('/api/acm-certs', { method: 'POST', body: JSON.stringify(body) });
    var p = pfx(kind);
    var msg = formEl(kind, p + '_msg');
    if (res && res.__error) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;font-weight:700;">⚠️ ' + esc(res.__error) + '</span>';
      if (!silent) alert('⚠️ ' + res.__error);
      return null;
    }
    if (!res || !res.entry) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;font-weight:700;">⚠️ Failed to save certificate.</span>';
      if (!silent) alert('Failed to save certificate.');
      return null;
    }
    st(kind).registerId = res.entry.id;
    setVal(kind, p + '_regid', String(res.entry.id));
    updateSendBtn(kind, res.entry);
    if (msg && !silent) {
      if (res.entry.sent_to_student) {
        msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Already sent to student. ACM Print still available.</span>';
      } else if (res.entry.status === 'completed') {
        msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Saved. Click <strong>Send to Student</strong> when ready.</span>';
      } else {
        msg.innerHTML = '<span style="color:#1a4fa0;">Draft saved (#' + res.entry.id + ').</span>';
      }
    }
    if (typeof window.renderStudyRegister === 'function') window.renderStudyRegister();
    if (typeof window.renderAcmModule === 'function') window.renderAcmModule();
    return res.entry;
  };

  /* ---------- Register ---------- */
  window.renderStudyRegister = async function () {
    ensureStudyPanels();
    var hosts = document.querySelectorAll('[data-study-register-host="1"]');
    if (!hosts.length) return;
    hosts.forEach(function (h) {
      h.innerHTML = '<div class="card"><div class="card-hd"><h3>📒 Study / Studying Certificate Register</h3></div><div style="padding:20px;opacity:.7;">Loading…</div></div>';
    });

    var data = await apiQuiet('/api/acm-certs?kind=register&_ts=' + Date.now());
    var rows = (data && data.register) ? data.register : [];

    var html = '<div class="card"><div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<h3 style="margin:0;">📒 Study / Studying Certificate Register</h3>' +
      '<button type="button" class="btn ol" onclick="window.renderStudyRegister&&window.renderStudyRegister()">↻ Refresh</button>' +
      '</div>' +
      '<div style="padding:12px 16px;font-size:0.78rem;background:#eff6ff;border-bottom:1px solid var(--border);">' +
      'Use <strong>Send to Student</strong> after issuing. ACM can re-print anytime. (No college / PO receipt step for Study &amp; Studying.)' +
      '</div><div style="overflow-x:auto;"><table><thead><tr>' +
      '<th>Type</th><th>Cert No</th><th>Student</th><th>Reg No</th><th>Issued</th><th>Status</th><th>Student portal</th><th>Action</th>' +
      '</tr></thead><tbody>';

    if (!rows.length) {
      html += '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.7;">No entries yet.</td></tr>';
    } else {
      html += rows.map(function (r) {
        var stLabel = r.cert_kind === 'studying' ? 'Studying' : 'Study';
        var badge = r.status === 'completed'
          ? '<span class="badge approved">Issued</span>'
          : r.status === 'printed_pending'
            ? '<span class="badge pending">Printed</span>'
            : '<span class="badge info">Draft</span>';
        var printed = r.printed_at || r.updated_at
          ? new Date(r.printed_at || r.updated_at).toLocaleString('en-IN')
          : '—';
        var studentBadge = r.sent_to_student
          ? '<span class="badge approved">Sent</span>'
          : '<span class="badge pending">Not sent</span>';
        var actions =
          '<div style="display:flex;flex-direction:column;gap:4px;min-width:140px;">' +
          (!r.sent_to_student
            ? '<button type="button" class="btn" style="padding:3px 8px;font-size:0.72rem;background:#1d4ed8;color:#fff;" onclick="window.studySendToStudentById(' + r.id + ')">📤 Send to Student</button>'
            : '<span style="font-size:0.72rem;color:#065f46;font-weight:600;">✅ On student portal</span>') +
          '<button type="button" class="btn ol" style="padding:3px 8px;font-size:0.72rem;" onclick="window.studyReprintEntry(' + r.id + ')">🖨️ ACM Print</button>' +
          '</div>';
        return '<tr>' +
          '<td><strong>' + esc(stLabel) + '</strong></td>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.75rem;">' + esc(r.cert_no) + '</td>' +
          '<td><strong>' + esc(r.student_name) + '</strong></td>' +
          '<td style="font-family:JetBrains Mono,monospace;font-size:0.75rem;">' + esc(r.reg_no) + '</td>' +
          '<td style="font-size:0.75rem;">' + esc(printed) + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' + studentBadge + '</td>' +
          '<td>' + actions + '</td></tr>';
      }).join('');
    }
    html += '</tbody></table></div></div>';
    hosts.forEach(function (h) { h.innerHTML = html; });
  };

  window.studySendToStudentById = async function (id) {
    // Ensure status is completed before / while sending
    await apiQuiet('/api/acm-certs', {
      method: 'PATCH',
      body: JSON.stringify({ id: id, action: 'complete', status: 'completed', skipDispatch: true }),
    });
    var res = await apiQuiet('/api/acm-certs', {
      method: 'POST',
      body: JSON.stringify({ action: 'send_to_student', id: id }),
    });
    if (res && res.__error) { alert('⚠️ ' + res.__error); return; }
    if (!res || !res.ok) { alert('Failed to send to student.'); return; }
    alert('✅ Certificate sent to student portal for print.');
    window.renderStudyRegister();
  };

  window.studyReprintEntry = async function (id) {
    // Reload register to find entry
    var data = await apiQuiet('/api/acm-certs?kind=register&_ts=' + Date.now());
    var rows = (data && data.register) ? data.register : [];
    var entry = rows.find(function (r) { return Number(r.id) === Number(id); });
    if (!entry) {
      alert('Entry not found.');
      return;
    }
    var kind = entry.cert_kind === 'studying' ? 'studying' : 'study';
    await loadTemplate(kind);
    var form = entry.form_data || {};
    if (typeof form === 'string') {
      try { form = JSON.parse(form); } catch (e) { form = {}; }
    }
    form.cert_no = form.cert_no || entry.cert_no;
    form.reg_no = form.reg_no || entry.reg_no;
    form.student_name = form.student_name || entry.student_name;
    form.father_name = form.father_name || entry.father_name;
    form.mother_name = form.mother_name || entry.mother_name;
    form.branch = form.branch || entry.branch;
    if (!form.photo) {
      // try fetch photo from students cache
      var list = window._acmStudentsCache || [];
      var stu = list.find(function (s) {
        return String(s.reg_no || '').toUpperCase() === String(entry.reg_no || '').toUpperCase();
      });
      if (stu) {
        var extra = stu.extra || {};
        if (typeof extra === 'string') {
          try { extra = JSON.parse(extra); } catch (e2) { extra = {}; }
        }
        form.photo = extractPhoto(extra);
      }
    }
    if (!form.print_date) {
      form.print_date = entry.printed_at
        ? new Date(entry.printed_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    if (!form.print_time) {
      form.print_time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    window.studyDoPrintHtml(buildPrintHtml(kind, form));
  };

  /* ---------- Template editor (admin) ---------- */
  window.renderStudyTemplateEditor = async function (kind) {
    if (!isRootAdminUser()) {
      alert('Templates are available to Root Admin only.');
      return;
    }
    kind = kind === 'studying' ? 'studying' : 'study';
    ensureStudyPanels();
    await loadTemplate(kind);
    var hostAttr = kind === 'studying' ? 'data-studying-template-host' : 'data-study-template-host';
    var hosts = document.querySelectorAll('[' + hostAttr + '="1"]');
    if (!hosts.length) return;

    var labels = (st(kind).template && st(kind).template.labels) || {};
    var header = (st(kind).template && st(kind).template.header) || {};
    var footer = (st(kind).template && st(kind).template.footer) || {};

    var labelKeys = Object.keys(labels).length
      ? Object.keys(labels)
      : (kind === 'studying'
        ? ['title_en', 'title_kn', 'cert_no_label_en', 'cert_no_label_kn', 'body_prefix_en', 'body_prefix_kn', 'son_daughter_en', 'reg_label_en', 'is_student_en', 'of_diploma_en', 'academic_year_en', 'character_en', 'purpose_en', 'records_en']
        : ['title_en', 'title_kn', 'cert_no_label_en', 'cert_no_label_kn', 'body_prefix_en', 'body_prefix_kn', 'son_daughter_en', 'reg_label_en', 'was_student_en', 'during_en', 'to_en', 'character_en', 'purpose_en', 'records_en']);

    var headerKeys = ['govt_kn', 'govt_en', 'dept_kn', 'dept_en', 'college_kn', 'college_en', 'emblem_url'];
    var footerKeys = ['place_kn', 'place_en', 'sign_right_kn', 'sign_right_en', 'note_kn', 'note_en'];

    function editRow(section, key, obj) {
      var val = obj[key] != null ? String(obj[key]) : '';
      return '<div class="fg" style="margin-bottom:8px;"><label>' + esc(key) + '</label>' +
        '<input type="text" data-study-tpl="' + kind + '.' + section + '.' + key + '" value="' + esc(val) + '" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:7px;" /></div>';
    }

    var html = '<div class="card"><div class="card-hd" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<h3 style="margin:0;">✏️ ' + esc(titleOf(kind)) + ' Template (Admin)</h3>' +
      '<button type="button" class="btn gr" onclick="window.studySaveTemplate&&window.studySaveTemplate(\'' + kind + '\')">💾 Save Template</button>' +
      '</div><div style="padding:16px;">' +
      '<div class="info-box" style="margin-bottom:14px;">Paste exact Kannada / English wording. Principal signature only. ACM staff cannot edit templates.</div>' +
      '<h4 style="margin:12px 0 8px;color:var(--navy);">Header</h4>' +
      headerKeys.map(function (k) { return editRow('header', k, header); }).join('') +
      '<h4 style="margin:16px 0 8px;color:var(--navy);">Certificate text labels</h4>' +
      labelKeys.map(function (k) { return editRow('labels', k, labels); }).join('') +
      '<h4 style="margin:16px 0 8px;color:var(--navy);">Footer</h4>' +
      footerKeys.map(function (k) { return editRow('footer', k, footer); }).join('') +
      '<div id="studyTplMsg_' + kind + '" style="margin-top:12px;font-size:0.85rem;"></div>' +
      '</div></div>';

    hosts.forEach(function (h) { h.innerHTML = html; });
  };

  window.studySaveTemplate = async function (kind) {
    if (!isRootAdminUser()) {
      alert('Only Root Admin can save templates.');
      return;
    }
    kind = kind === 'studying' ? 'studying' : 'study';
    var labels = {};
    var header = {};
    var footer = {};
    document.querySelectorAll('[data-study-tpl^="' + kind + '."]').forEach(function (el) {
      var path = el.getAttribute('data-study-tpl').split('.');
      // kind.section.key
      var section = path[1];
      var key = path.slice(2).join('.');
      if (section === 'labels') labels[key] = el.value;
      else if (section === 'header') header[key] = el.value;
      else if (section === 'footer') footer[key] = el.value;
    });
    if (!header.emblem_url) header.emblem_url = '/karnataka-emblem.png';

    var res = await apiQuiet('/api/acm-certs', {
      method: 'POST',
      body: JSON.stringify({ action: 'save_template', certKind: kind, labels: labels, header: header, footer: footer }),
    });
    var msg = document.getElementById('studyTplMsg_' + kind);
    if (res && res.__error) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">⚠️ ' + esc(res.__error) + '</span>';
      alert('⚠️ ' + res.__error);
      return;
    }
    if (!res || !res.ok) {
      if (msg) msg.innerHTML = '<span style="color:#991b1b;">Failed to save.</span>';
      return;
    }
    st(kind).template = { labels: labels, header: header, footer: footer };
    if (msg) msg.innerHTML = '<span style="color:#065f46;font-weight:700;">✅ Template saved.</span>';
  };

  /* ---------- Wire Proceed into ACM queue ---------- */
  function enhanceQueueActions() {
    document.querySelectorAll('[data-acm-tbody="1"] tr').forEach(function (tr) {
      if (tr.getAttribute('data-study-enhanced') === '1') return;
      var cells = tr.querySelectorAll('td');
      if (cells.length < 8) return;
      var typeText = (cells[4] && cells[4].textContent || '').toLowerCase();
      var isStudying = typeText.indexOf('studying') >= 0;
      var isStudy = !isStudying && typeText.indexOf('study') >= 0;
      if (!isStudy && !isStudying) return;
      var regNo = (cells[2] && cells[2].textContent || '').trim();
      var actionCell = cells[7];
      if (!actionCell) return;
      var reqId = null;
      var btn = actionCell.querySelector('button[onclick*="acmUpdateRequest"], button[onclick*="acmProceed"]');
      if (btn) {
        var m = String(btn.getAttribute('onclick') || '').match(/\((\d+)/);
        if (m) reqId = Number(m[1]);
      }
      if (!reqId && window._acmRequests) {
        var match = window._acmRequests.find(function (r) {
          return String(r.reg_no || '').toUpperCase() === regNo.toUpperCase() &&
            (isStudying ? /studying/i.test(String(r.cert_type || '')) : /study/i.test(String(r.cert_type || '')) && !/studying/i.test(String(r.cert_type || '')));
        });
        if (match) reqId = match.id;
      }
      var kind = isStudying ? 'studying' : 'study';
      var proceed = document.createElement('button');
      proceed.className = 'btn';
      proceed.type = 'button';
      proceed.style.cssText = 'padding:4px 8px;font-size:0.72rem;background:' + (isStudying ? '#b45309' : '#065f46') + ';color:#fff;margin-right:4px;';
      proceed.textContent = isStudying ? '▶ Proceed → Studying' : '▶ Proceed → Study';
      proceed.onclick = function () {
        window.acmProceedStudy(reqId, regNo, kind);
      };
      actionCell.insertBefore(proceed, actionCell.firstChild);
      tr.setAttribute('data-study-enhanced', '1');
    });
  }

  function patchRender() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (typeof window.renderAcmModule !== 'function' && tries < 50) return;
      clearInterval(t);
      var orig = window.renderAcmModule;
      if (!orig || orig.__studyPatched) {
        enhanceQueueActions();
        ensureStudyPanels();
        return;
      }
      window.renderAcmModule = async function () {
        var r = await orig.apply(this, arguments);
        enhanceQueueActions();
        ensureStudyPanels();
        return r;
      };
      window.renderAcmModule.__studyPatched = true;
      enhanceQueueActions();
      ensureStudyPanels();
    }, 200);
  }

  function boot() {
    ensureStudyPanels();
    patchRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 500); });
  } else {
    setTimeout(boot, 500);
  }

  window.ensureStudyPanels = ensureStudyPanels;
  window.STUDY_STATE = STUDY_STATE;
})();
