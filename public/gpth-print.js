/**
 * Reliable HTML print for browser + Capacitor Android WebView.
 * Exposes: window.gpthPrintHtml(html, options?)
 */
(function () {
  "use strict";

  var SHELL_ID = "gpth-print-shell";
  var SURFACE_ID = "gpth-print-surface";
  var STYLE_ID = "gpth-print-injected-style";
  var PRINT_MODE_CLASS = "gpth-print-mode";

  function isMobileShell() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function") {
        if (window.Capacitor.isNativePlatform()) return true;
      }
    } catch (e) { /* ignore */ }
    var ua = navigator.userAgent || "";
    if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return true;
    try {
      return window.matchMedia && window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900;
    } catch (e2) {
      return false;
    }
  }

  function withBase(html) {
    var origin = window.location.origin || "";
    if (!origin || html.indexOf("<base ") !== -1) return html;
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, '<head$1><base href="' + origin + '/">');
    }
    return '<!DOCTYPE html><html><head><base href="' + origin + '/"><meta charset="utf-8"></head><body>' + html + "</body></html>";
  }

  function extractParts(html) {
    var styles = [];
    var re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    var m;
    while ((m = re.exec(html))) styles.push(m[1]);
    var bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      styles: styles.join("\n"),
      body: bodyMatch ? bodyMatch[1] : html,
      title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Print",
    };
  }

  function escapeText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scopeStyles(css, scope) {
    if (!css || !String(css).trim()) return "";
    try {
      var parts = css.split("}");
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var chunk = parts[i].trim();
        if (!chunk) continue;
        if (chunk.charAt(0) === "@") {
          out.push(chunk + "}");
          continue;
        }
        var idx = chunk.indexOf("{");
        if (idx === -1) {
          out.push(chunk + "}");
          continue;
        }
        var selectors = chunk.slice(0, idx).trim();
        var body = chunk.slice(idx);
        var scoped = selectors
          .split(",")
          .map(function (sel) {
            var s = sel.trim();
            if (!s) return s;
            if (s === "html" || s === "body") return scope;
            if (s.indexOf("html ") === 0 || s.indexOf("body ") === 0) {
              return scope + " " + s.replace(/^(html|body)\s+/, "");
            }
            return scope + " " + s;
          })
          .join(", ");
        out.push(scoped + body + "}");
      }
      return out.join("\n");
    } catch (e) {
      return css;
    }
  }

  function removeShell() {
    var shell = document.getElementById(SHELL_ID);
    if (shell) shell.remove();
    var st = document.getElementById(STYLE_ID);
    if (st) st.remove();
    document.body.classList.remove(PRINT_MODE_CLASS);
    document.documentElement.classList.remove(PRINT_MODE_CLASS);
  }

  function triggerDownload(html, filename) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = /\.html$/i.test(filename) ? filename : filename + ".html";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 4000);
  }

  function triggerShare(html, title, filename) {
    return new Promise(function (resolve) {
      try {
        var name = /\.html$/i.test(filename) ? filename : filename + ".html";
        var file = new File([html], name, { type: "text/html" });
        var data = { files: [file], title: title, text: title };
        if (navigator.canShare && navigator.canShare(data) && navigator.share) {
          navigator.share(data).then(function () { resolve(true); }).catch(function (err) {
            if (err && err.name === "AbortError") resolve(true);
            else resolve(false);
          });
          return;
        }
        if (navigator.share) {
          navigator.share({ title: title, text: title }).then(function () { resolve(true); }).catch(function () {
            resolve(false);
          });
          return;
        }
      } catch (e) { /* fall through */ }
      resolve(false);
    });
  }

  function doMainWindowPrint() {
    document.body.classList.add(PRINT_MODE_CLASS);
    document.documentElement.classList.add(PRINT_MODE_CLASS);
    function cleanup() {
      document.body.classList.remove(PRINT_MODE_CLASS);
      document.documentElement.classList.remove(PRINT_MODE_CLASS);
      window.removeEventListener("afterprint", cleanup);
    }
    window.addEventListener("afterprint", cleanup);
    setTimeout(cleanup, 60000);
    try {
      window.focus();
      window.print();
    } catch (e) {
      cleanup();
    }
  }

  /**
   * @param {string} html
   * @param {{ title?: string, filename?: string, autoPrint?: boolean }} [options]
   */
  window.gpthPrintHtml = function (html, options) {
    if (!html || typeof document === "undefined") return;
    options = options || {};
    var fullHtml = withBase(html);
    var parts = extractParts(fullHtml);
    var title = options.title || parts.title || "Print";
    var filename =
      options.filename ||
      String(title).replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 48) ||
      "document";
    if (!/\.html$/i.test(filename)) filename += ".html";

    removeShell();

    var shell = document.createElement("div");
    shell.id = SHELL_ID;
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("aria-label", title);
    shell.innerHTML =
      '<div class="gpth-print-toolbar" data-no-print="1">' +
      '<button type="button" class="gpth-print-btn gpth-print-close" data-action="close" aria-label="Close">✕</button>' +
      '<div class="gpth-print-title">' + escapeText(title) + "</div>" +
      '<div class="gpth-print-actions">' +
      '<button type="button" class="gpth-print-btn gpth-print-primary" data-action="print">🖨️ Print</button>' +
      '<button type="button" class="gpth-print-btn" data-action="share">Share</button>' +
      '<button type="button" class="gpth-print-btn" data-action="download">Save</button>' +
      "</div></div>" +
      '<div class="gpth-print-hint" data-no-print="1">' +
      "Preview below. Tap <strong>Print</strong> for the system dialog. " +
      "On some phones use <strong>Share</strong> → open in Chrome → Print." +
      "</div>" +
      '<div id="' + SURFACE_ID + '" class="gpth-print-surface"></div>';

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#" + SHELL_ID + "{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#0f172a;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;}" +
      "#" + SHELL_ID + " .gpth-print-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top));background:#0f2d5c;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25);}" +
      "#" + SHELL_ID + " .gpth-print-title{flex:1 1 auto;min-width:0;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      "#" + SHELL_ID + " .gpth-print-actions{display:flex;gap:6px;flex-wrap:wrap;}" +
      "#" + SHELL_ID + " .gpth-print-btn{appearance:none;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;min-height:40px;}" +
      "#" + SHELL_ID + " .gpth-print-btn.gpth-print-primary{background:#38bdf8;border-color:#38bdf8;color:#0f172a;}" +
      "#" + SHELL_ID + " .gpth-print-btn.gpth-print-close{min-width:40px;padding:8px 10px;}" +
      "#" + SHELL_ID + " .gpth-print-hint{flex:0 0 auto;padding:8px 12px;font-size:12px;line-height:1.35;background:#1e293b;color:#e2e8f0;}" +
      "#" + SHELL_ID + " .gpth-print-surface{flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;background:#fff;color:#0f172a;padding:12px;margin:0;}" +
      "#" + SHELL_ID + " .gpth-print-surface *{max-width:100%;}" +
      "#" + SHELL_ID + " .gpth-print-doc{background:#fff;color:#0f172a;min-height:100%;max-width:210mm;margin:0 auto;}" +
      scopeStyles(parts.styles, "#" + SHELL_ID + " .gpth-print-doc") +
      "@media print{" +
      "html." + PRINT_MODE_CLASS + ",body." + PRINT_MODE_CLASS + "{background:#fff!important;margin:0!important;padding:0!important;height:auto!important;overflow:visible!important;}" +
      "body." + PRINT_MODE_CLASS + " > *:not(#" + SHELL_ID + "){display:none!important;}" +
      "#" + SHELL_ID + "{position:static!important;inset:auto!important;display:block!important;background:#fff!important;height:auto!important;overflow:visible!important;z-index:auto!important;}" +
      "#" + SHELL_ID + ' [data-no-print="1"]{display:none!important;}' +
      "#" + SHELL_ID + " .gpth-print-surface{overflow:visible!important;padding:0!important;margin:0!important;max-width:none!important;}" +
      "#" + SHELL_ID + " .gpth-print-doc{max-width:none!important;margin:0!important;}" +
      "}";

    document.head.appendChild(style);
    document.body.appendChild(shell);

    var surface = shell.querySelector("#" + SURFACE_ID);
    var docWrap = document.createElement("div");
    docWrap.className = "gpth-print-doc";
    docWrap.innerHTML = parts.body;
    surface.appendChild(docWrap);

    function close() {
      removeShell();
      window.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);

    shell.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
      if (!t) return;
      var action = t.getAttribute("data-action");
      if (action === "close") close();
      if (action === "print") doMainWindowPrint();
      if (action === "download") triggerDownload(fullHtml, filename);
      if (action === "share") {
        triggerShare(fullHtml, title, filename).then(function (ok) {
          if (!ok) triggerDownload(fullHtml, filename);
        });
      }
    });

    // Always try system print shortly after open (preview remains if dialog missing)
    setTimeout(function () {
      try { doMainWindowPrint(); } catch (e) { /* keep preview */ }
    }, 450);
  };
})();
