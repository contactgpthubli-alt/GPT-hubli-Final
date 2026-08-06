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
})();
