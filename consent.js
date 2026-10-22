// Cookie consent gate for Google Analytics. GA is not loaded until the
// visitor accepts. Choice is remembered in localStorage.
(function () {
  var KEY = "lineupr_consent";
  var GA_ID = "G-5N65WW6VB8";

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function store(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  function loadGA() {
    if (window.__lineuprGaLoaded) return;
    window.__lineuprGaLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    gtag("js", new Date());
    gtag("config", GA_ID);
  }

  // Withdrawing consent must actually stop tracking: drop the stored choice
  // and delete the GA cookies (_ga, _ga_<id>) on this host and its parent
  // domain. A page where GA already ran is reloaded so the script is gone.
  function clearGaCookies() {
    var host = location.hostname;
    var domains = ["", host, "." + host.replace(/^www\./, "")];
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (name !== "_ga" && name.indexOf("_ga_") !== 0) return;
      domains.forEach(function (d) {
        document.cookie = name + "=; Max-Age=0; path=/" + (d ? "; domain=" + d : "");
      });
    });
  }

  window.lineuprConsent = {
    get: stored,
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      clearGaCookies();
      if (window.__lineuprGaLoaded) { location.reload(); return; }
      showBanner();
    },
  };

  var consent = stored();
  if (consent === "granted") { loadGA(); return; }
  if (consent === "denied") { clearGaCookies(); return; }

  function showBanner() {
    if (document.getElementById("consentBanner")) return;

    var style = document.createElement("style");
    style.textContent =
      "#consentBanner{position:fixed;left:0;right:0;bottom:0;z-index:9999;" +
      "background:#1d1815;border-top:1px solid #382e25;color:#f2ece2;" +
      "font:13px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;padding:14px 16px;" +
      "display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;justify-content:space-between;" +
      "box-shadow:0 -4px 20px rgba(0,0,0,.4);}" +
      "#consentBanner p{margin:0;flex:1 1 280px;color:#a99d8c;}" +
      "#consentBanner a{color:#ffa53e;}" +
      "#consentBanner .cb-actions{display:flex;gap:8px;flex-shrink:0;}" +
      "#consentBanner button{font:inherit;font-weight:600;padding:8px 16px;border-radius:5px;" +
      "border:1px solid #382e25;background:transparent;color:#f2ece2;cursor:pointer;}" +
      // Accept and Decline are deliberately styled identically: rejecting
      // has to be as easy and as visible as accepting (Traficom guidance).

      "#consentBanner button:hover{opacity:.85;}";
    document.head.appendChild(style);

    var el = document.createElement("div");
    el.id = "consentBanner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Cookie consent");
    el.innerHTML =
      "<p>May we use Google Analytics cookies to measure how the site is used? " +
      "Google (USA) receives pseudonymous usage data only if you accept. No ads, no data selling. " +
      '<a href="/cookies.html">Cookie policy</a> · <a href="/privacy.html">Privacy</a></p>' +
      '<div class="cb-actions">' +
      '<button type="button" class="cb-decline">Decline</button>' +
      '<button type="button" class="cb-accept">Accept</button>' +
      "</div>";
    document.body.appendChild(el);

    el.querySelector(".cb-accept").addEventListener("click", function () {
      store("granted");
      loadGA();
      el.remove();
    });
    el.querySelector(".cb-decline").addEventListener("click", function () {
      store("denied");
      el.remove();
    });
  }

  if (document.body) showBanner();
  else document.addEventListener("DOMContentLoaded", showBanner);
})();
