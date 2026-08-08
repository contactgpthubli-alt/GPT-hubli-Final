/**
 * Signature stamp UI — show who approved / edited / verified anything.
 * Usage:
 *   window.gpthStamp.html({ action:'approved', by_name:'…', by_role:'exam', at:'…' })
 *   window.gpthStamp.line(stamp)  // compact one-line HTML
 *   window.gpthStamp.fromFields({ approved_by_name, approved_by_role, approved_at }, 'approved')
 */
(function () {
  'use strict';

  var ROLE_LABELS = {
    student: 'Student',
    faculty: 'Teaching Staff',
    teaching: 'Teaching Staff',
    hod: 'HOD',
    acm: 'ACM',
    exam: 'Exam Cell',
    principal: 'Principal',
    admin: 'Root Admin',
    registrar: 'Registrar',
    est: 'EST',
    library: 'Library Staff',
    placement: 'Placement Officer',
    nss: 'NSS Officer',
    yrc: 'Youth Red Cross',
    alumni: 'Alumni Officer',
    sports: 'Sports Officer',
    welfare: 'Student Welfare Officer',
    cash: 'Cash Officer',
    accounts: 'Accounts',
    stores: 'Stores',
    studentassoc: 'Student Association',
  };

  var VERBS = {
    approved: 'Approved by',
    rejected: 'Rejected by',
    edited: 'Edited by',
    submitted: 'Submitted by',
    verified: 'Verified by',
    created: 'Created by',
    updated: 'Updated by',
    deleted: 'Deleted by',
    transferred: 'Transferred by',
    released: 'Released by',
    accepted: 'Accepted by',
    cancelled: 'Cancelled by',
    paid: 'Marked paid by',
    waived: 'Waived by',
    removed: 'Removed by',
    flagged: 'Flagged by',
  };

  function esc(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function roleLabel(role) {
    var r = String(role || '').toLowerCase().trim();
    return ROLE_LABELS[r] || (role ? String(role) : 'Staff');
  }

  function verb(action) {
    var a = String(action || 'updated').toLowerCase();
    return VERBS[a] || a.charAt(0).toUpperCase() + a.slice(1) + ' by';
  }

  function whenIn(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return String(iso).slice(0, 16);
    }
  }

  function normalize(raw, fallbackAction) {
    if (!raw) return null;
    if (typeof raw === 'string') {
      return { action: fallbackAction || 'updated', by_name: raw, by_role: '', at: '' };
    }
    var o = raw;
    var name = String(
      o.by_name || o.by || o.name || o.actor || o.approved_by_name || o.verified_by_name ||
      o.edited_by_name || o.paid_marked_by_name || o.created_by_name || o.released_by_name ||
      o.accepted_by_name || o.cancelled_by_name || o.updated_by_name || '',
    ).trim();
    if (!name) return null;
    var role = String(
      o.by_role || o.role || o.actor_role || o.approved_by_role || o.verifier_role || o.by_role_label || '',
    ).toLowerCase();
    var at = String(
      o.at || o.when || o.approved_at || o.verified_at || o.edited_at || o.paid_marked_at ||
      o.created_at || o.released_at || o.accepted_at || o.cancelled_at || o.updated_at || '',
    );
    return {
      action: String(o.action || fallbackAction || 'updated'),
      by_name: name,
      by_role: role,
      by_role_label: o.by_role_label || roleLabel(role),
      at: at,
      note: o.note != null ? String(o.note) : o.reason != null ? String(o.reason) : null,
    };
  }

  /** Compact one-line HTML (tables / list rows). */
  function line(raw, fallbackAction) {
    var s = normalize(raw, fallbackAction);
    if (!s) return '';
    var when = whenIn(s.at);
    return (
      '<span class="gpth-stamp-line" title="Signature stamp">' +
      '<strong>' + esc(verb(s.action)) + '</strong> ' +
      esc(s.by_name) +
      ' <span class="gpth-stamp-role">(' + esc(s.by_role_label || roleLabel(s.by_role)) + ')</span>' +
      (when ? ' · <span class="gpth-stamp-when">' + esc(when) + '</span>' : '') +
      '</span>'
    );
  }

  /** Full “signature block” card. */
  function html(raw, fallbackAction) {
    var s = normalize(raw, fallbackAction);
    if (!s) return '';
    var when = whenIn(s.at);
    var tone =
      s.action === 'rejected' || s.action === 'cancelled' || s.action === 'deleted'
        ? 'reject'
        : s.action === 'approved' || s.action === 'verified' || s.action === 'accepted' || s.action === 'paid'
          ? 'ok'
          : 'edit';
    return (
      '<div class="gpth-stamp gpth-stamp--' + tone + '" role="note" aria-label="Signature stamp">' +
      '<div class="gpth-stamp-hd">' + esc(verb(s.action)) + '</div>' +
      '<div class="gpth-stamp-name">' + esc(s.by_name) + '</div>' +
      '<div class="gpth-stamp-meta">' +
      '<span class="gpth-stamp-role">' + esc(s.by_role_label || roleLabel(s.by_role)) + '</span>' +
      (when ? '<span class="gpth-stamp-when">' + esc(when) + '</span>' : '') +
      '</div>' +
      (s.note ? '<div class="gpth-stamp-note">' + esc(s.note) + '</div>' : '') +
      '</div>'
    );
  }

  /** Build from common loose field names on a row/object. */
  function fromFields(row, action) {
    if (!row) return null;
    var act = action || 'updated';
    if (act === 'approved') {
      return normalize(
        {
          action: 'approved',
          by_name: row.approved_by_name,
          by_role: row.approved_by_role,
          at: row.approved_at,
        },
        'approved',
      );
    }
    if (act === 'rejected') {
      return normalize(
        {
          action: 'rejected',
          by_name: row.rejected_by_name || row.approved_by_name,
          by_role: row.rejected_by_role || row.approved_by_role,
          at: row.rejected_at || row.approved_at,
        },
        'rejected',
      );
    }
    if (act === 'verified') {
      return normalize(
        {
          action: 'verified',
          by_name: row.verified_by_name,
          by_role: row.verifier_role || row.verified_by_role,
          at: row.verified_at,
        },
        'verified',
      );
    }
    if (act === 'edited') {
      return normalize(
        {
          action: 'edited',
          by_name: row.edited_by_name,
          by_role: row.edited_by_role,
          at: row.edited_at,
        },
        'edited',
      );
    }
    if (act === 'paid') {
      return normalize(
        {
          action: 'paid',
          by_name: row.paid_marked_by_name,
          by_role: row.paid_marked_by_role,
          at: row.paid_marked_at,
        },
        'paid',
      );
    }
    return normalize(row, act);
  }

  function injectStyles() {
    if (document.getElementById('gpth-stamp-css')) return;
    var css = document.createElement('style');
    css.id = 'gpth-stamp-css';
    css.textContent =
      '.gpth-stamp{margin:8px 0;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#f8fafc;font-size:0.82rem;line-height:1.4;max-width:360px;}' +
      '.gpth-stamp--ok{border-color:#86efac;background:#f0fdf4;}' +
      '.gpth-stamp--reject{border-color:#fca5a5;background:#fef2f2;}' +
      '.gpth-stamp--edit{border-color:#93c5fd;background:#eff6ff;}' +
      '.gpth-stamp-hd{font-size:0.68rem;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;opacity:0.75;margin-bottom:2px;}' +
      '.gpth-stamp-name{font-weight:800;color:#0f172a;font-size:0.95rem;}' +
      '.gpth-stamp-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px;font-size:0.78rem;color:#334155;}' +
      '.gpth-stamp-role{font-weight:700;}' +
      '.gpth-stamp-when{opacity:0.85;}' +
      '.gpth-stamp-note{margin-top:6px;font-size:0.78rem;opacity:0.9;font-style:italic;}' +
      '.gpth-stamp-line{font-size:0.78rem;color:#334155;}' +
      '.gpth-stamp-line .gpth-stamp-role{font-weight:600;opacity:0.9;}';
    (document.head || document.documentElement).appendChild(css);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }

  window.gpthStamp = {
    html: html,
    line: line,
    normalize: normalize,
    fromFields: fromFields,
    roleLabel: roleLabel,
    verb: verb,
    when: whenIn,
  };

  console.log('[gpth-stamp] signature stamps ready');
})();
