// Cloudflare Pages advanced mode: all requests pass through this allowlisted router.
// Fetch clean Pages paths (not .html paths) to avoid Pages' .html -> clean URL redirects.
const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.razorpay.com; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.onesignal.com https://connect.facebook.net https://checkout.razorpay.com https://www.google.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net https://*.onesignal.com wss://*.onesignal.com https://api.emailjs.com https://checkout.razorpay.com https://api.razorpay.com https://graph.facebook.com https://www.facebook.com https://www.google.com https://www.recaptcha.net; frame-src https://*.firebaseapp.com https://api.razorpay.com https://checkout.razorpay.com https://www.google.com https://www.recaptcha.net; worker-src 'self' blob: https://cdn.onesignal.com; manifest-src 'self' blob: data:; media-src 'self' blob: https:; upgrade-insecure-requests";
const SECURITY = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()",
};
const DOCUMENTS = new Set(["dj", "enquiry", "index", "menu", "music", "qr-poster", "rules-test", "table", "wallet"]);
const FILES = new Set(["/event-media.css", "/event-media.js", "/wallet.js", "/robots.txt", "/sitemap.xml", "/HOD-CLUB-FOOD-AND-DRINK.pdf"]);
const WALLET_PARAMS = ["wallet", "verify", "topup", "ref"];
const RETIRED = new Set(["/scanner", "/index.legacy"]);

function routePath(rawPath) {
  let path = rawPath;
  // Decode repeatedly before any asset lookup, so double-encoded retired names
  // cannot reach Pages' asset resolver through a different spelling.
  for (let i = 0; i < 8; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return null;
    }
    if (decoded === path) break;
    path = decoded;
  }
  // Never forward residual encodings, alternate separators, or path traversal.
  if (path.includes("%") || path.includes("\\") || path.includes("\0") || path.includes("//") || /\/(?:\.|\.\.)(?:\/|$)/.test(path)) return null;
  return path;
}

function response(body, status, extra = {}) {
  return new Response(body, { status, headers: { ...extra, ...SECURITY, "Cache-Control": "private, no-store, max-age=0" } });
}

export default {
  async fetch(request, env) {
    const head = request.method === "HEAD";
    if (request.method !== "GET" && !head) {
      return response(null, 405, { Allow: "GET, HEAD" });
    }
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return response(null, 400);
    }
    const path = routePath(url.pathname);
    if (path === null) return response(null, 400);

    const alias = path.toLowerCase().replace(/\/+$/, "").replace(/\.html$/, "");
    if (RETIRED.has(alias)) {
      return response(null, 301, { Location: "/" });
    }

    let assetPath;
    if (path === "/" || path === "/index" || path === "/index/" || path === "/index.html") {
      assetPath = path === "/" && WALLET_PARAMS.some((key) => url.searchParams.has(key)) ? "/wallet" : "/";
    } else if (path === "/wallet" || path === "/wallet/" || path === "/wallet.html") {
      assetPath = "/wallet";
    } else if (FILES.has(path)) {
      assetPath = path;
    } else {
      const doc = path.match(/^\/([a-z-]+)(?:\.html|\/)?$/);
      if (doc && DOCUMENTS.has(doc[1])) assetPath = `/${doc[1]}`;
    }
    if (!assetPath) return response(null, 404);

    // Do not send user queries, authorization or cookies to the asset binding.
    // The external URL (and its exact percent-encoded query) is never redirected.
    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetPath;
    assetUrl.search = "";
    assetUrl.hash = "";
    let asset;
    try {
      if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") throw new Error("ASSETS binding unavailable");
      asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET", redirect: "manual" }));
    } catch {
      return response(null, 503);
    }
    // A missing asset is an outage, never a reason to serve the homepage.
    if (asset.status !== 200) return response(null, 503);
    const headers = new Headers(asset.headers);
    for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.delete("Set-Cookie");
    // No conditional/range forwarding: do not claim an asset was cached or partial.
    headers.delete("ETag");
    headers.delete("Content-Length");
    return new Response(head ? null : asset.body, { status: 200, headers });
  },
};