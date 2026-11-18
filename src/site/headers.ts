// The response headers for every file, written into dist/_headers. This is the whole server-side security policy:
// there is no server code, so there is nothing else to configure and nothing else that can go wrong on the server.

/** What the page may load and do. Everything comes from this origin, and the script may not connect anywhere at all. */
export const CONTENT_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  // The page's script has nowhere to send a log to: fetch, XHR, WebSocket, EventSource and beacons are all refused.
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  // No HTML string can be turned into markup by script, in browsers that enforce this. The page's own script
  // creates no policy to get around it (a test reads the built script to make sure). `trusted-types 'none'` is
  // left out on purpose: browser extensions that create a policy of their own would log an error on every visit.
  "require-trusted-types-for 'script'",
].join("; ");

export const SECURITY_HEADERS: [string, string][] = [
  ["Content-Security-Policy", CONTENT_POLICY],
  ["Strict-Transport-Security", "max-age=31536000"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "no-referrer"],
  ["Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["Cross-Origin-Resource-Policy", "same-origin"],
  ["X-Frame-Options", "DENY"],
  // no-transform: the delivery network must not add anything to the pages (an analytics script, for one).
  ["Cache-Control", "no-cache, no-transform"],
];

export function headersFile(preview: boolean): string {
  const all = [...SECURITY_HEADERS, ...(preview ? ([["X-Robots-Tag", "noindex, nofollow"]] as [string, string][]) : [])];
  // Styles, script and typeface carry no page text for anyone to add to, so they may be compressed in transit.
  return `/*\n${all.map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n\n/assets/*\n  ! Cache-Control\n  Cache-Control: no-cache\n`;
}
