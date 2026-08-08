/**
 * Tiny first-paint boot for private CMS entry.
 * Runs ASAP so the old public landing never flashes, even before legacy-bridge.js.
 */
(function () {
  try {
    document.documentElement.classList.add("cms-login-mode");
    if (document.body) document.body.classList.add("cms-login-mode");
    else {
      document.addEventListener("DOMContentLoaded", function () {
        document.documentElement.classList.add("cms-login-mode");
        if (document.body) document.body.classList.add("cms-login-mode");
      });
    }
  } catch (e) {
    /* ignore */
  }

  function lockShells() {
    try {
      ;["dbAdmin", "dbStudent", "dbFaculty", "dbPrincipal"].forEach(function (id) {
        var el = document.getElementById(id)
        if (!el) return
        el.classList.remove("show")
        el.setAttribute("data-auth-locked", "1")
        el.setAttribute("aria-hidden", "true")
      })
    } catch (e) {
      /* ignore */
    }
  }

  function injectGate() {
    try {
      lockShells()
      if (document.getElementById("cmsLoginGate")) return;
      var landing = document.getElementById("landingPage");
      if (!landing) return;

      var gate = document.createElement("div");
      gate.id = "cmsLoginGate";
      gate.innerHTML =
        '<div class="cms-shell">' +
        '<div class="cms-bg" aria-hidden="true">' +
        '<div class="cms-bg-overlay"></div>' +
        "</div>" +
        '<div class="cms-card">' +
        '<div class="cms-card-hd">' +
        '<img class="cms-logo" src="/images/college-logo.png" alt="Government Polytechnic Hubballi" ' +
        'onerror="this.style.display=\'none\'" />' +
        "<h1>Government Polytechnic Hubballi</h1>" +
        "<p>Management Information System<br>Dept. of Technical Education, Karnataka · Estd. 2009</p>" +
        '<div class="cms-badge">Secure CMS Login</div>' +
        "</div>" +
        '<div class="cms-card-bd">' +
        '<div class="cms-msg" style="color:#64748b;font-weight:600;">Loading secure sign-in…</div>' +
        '<div class="cms-foot" style="margin-top:12px;">Private portal — authorised users only.<br>' +
        '<a href="/student" style="display:inline-block;margin-top:6px;font-weight:700;">📱 Open Student Mobile App</a><br>' +
        '<span style="display:inline-block;margin-top:10px;font-size:0.72rem;opacity:.85;">Developed by <strong>Akshay Uppar</strong></span>' +
        "</div></div></div></div>";

      landing.insertBefore(gate, landing.firstChild);
      document.documentElement.classList.add("cms-login-mode");
      if (document.body) document.body.classList.add("cms-login-mode");

      // Hide marketing / demo chrome immediately
      try {
        document.querySelectorAll(".demo-bar, #demoBar").forEach(function (b) {
          b.style.display = "none";
        });
      } catch (e2) {
        /* ignore */
      }
    } catch (e) {
      console.warn("[cms-boot]", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectGate);
  } else {
    injectGate();
  }
  // Re-lock until real session opens a shell (prevents URL-only shell access)
  setTimeout(lockShells, 0);
  setTimeout(lockShells, 50);
  setTimeout(lockShells, 200);

  /** Block emoji in user-entered text (inputs / textareas / contenteditable). */
  function stripEmojiLocal(s) {
    try {
      return String(s == null ? "" : s)
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
        .replace(/\p{Extended_Pictographic}/gu, "");
    } catch (e) {
      return String(s == null ? "" : s).replace(
        /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/g,
        "",
      );
    }
  }

  function isTextEntry(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    var tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    var t = (el.type || "text").toLowerCase();
    return (
      t === "text" ||
      t === "search" ||
      t === "email" ||
      t === "tel" ||
      t === "url" ||
      !el.type
    );
  }

  function scrubField(el) {
    if (!isTextEntry(el)) return;
    if (el.isContentEditable) {
      var plain = el.innerText || el.textContent || "";
      var cleanedC = stripEmojiLocal(plain);
      if (cleanedC !== plain) el.innerText = cleanedC;
      return;
    }
    if (typeof el.value !== "string") return;
    var before = el.value;
    var cleaned = stripEmojiLocal(before);
    if (cleaned !== before) {
      var start = el.selectionStart;
      var end = el.selectionEnd;
      el.value = cleaned;
      try {
        if (typeof start === "number" && typeof end === "number") {
          var removed = before.length - cleaned.length;
          var pos = Math.max(0, Math.min(cleaned.length, (end || 0) - Math.max(0, removed)));
          el.setSelectionRange(pos, pos);
        }
      } catch (e2) {
        /* ignore */
      }
    }
  }

  document.addEventListener(
    "input",
    function (e) {
      scrubField(e.target);
    },
    true,
  );
  document.addEventListener(
    "paste",
    function (e) {
      var el = e.target;
      if (!isTextEntry(el) || el.isContentEditable) return;
      // Let paste land then scrub
      setTimeout(function () {
        scrubField(el);
      }, 0);
    },
    true,
  );
})();
