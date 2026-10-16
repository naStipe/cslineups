// Cloudflare Turnstile widget loader, shared by the sign-in/sign-up modal
// and the admin sign-in gate. The site key is public by design — the actual
// verification (and the secret key) happens server-side inside Supabase Auth
// once CAPTCHA protection is turned on for the project.
const SITE_KEY = "0x4AAAAAAE8Eo9x01tOdsOjD";

let scriptPromise = null;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const el = document.createElement("script");
    el.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    el.async = true;
    el.onload = () => resolve(window.turnstile);
    el.onerror = () => reject(new Error("Couldn't load the verification widget."));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

// Renders one widget into `container` and hands back a token accessor.
// Turnstile tokens are single-use and expire after a few minutes, so callers
// must `reset()` after every submit attempt (success or failure).
export function mountTurnstile(container) {
  const el = typeof container === "string" ? document.getElementById(container) : container;
  let widgetId = null;
  let token = null;

  loadScript().then(turnstile => {
    widgetId = turnstile.render(el, {
      sitekey: SITE_KEY,
      callback: (t) => { token = t; },
      "expired-callback": () => { token = null; },
      "error-callback": () => { token = null; },
    });
  }).catch(() => { /* submit will fail with "complete the challenge" below */ });

  return {
    getToken: () => token,
    reset: () => {
      token = null;
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    },
  };
}
