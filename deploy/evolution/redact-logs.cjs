// libsignal logs full SessionEntry objects outside Evolution's LOG_LEVEL filter.
// Load before the application with NODE_OPTIONS to keep key material out of logs.
"use strict";
const sensitive = /^(?:private(?:key)?|privkey|rootkey|chainkey|messagekeys|identitykey|signedprekey|prekey|access_token|apikey|api_key|authorization|password|secret)$/i;
function clean(value, seen = new WeakSet()) {
  if (typeof value === "string") return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[redacted]")
    .replace(/((?:apikey|access_token|password|secret)[=:]\s*)[^\s&,]+/gi, "$1[redacted]");
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return "[binary redacted]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (value instanceof Error) return clean(value.stack || value.message, seen);
  if (Array.isArray(value)) return value.map(item => clean(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? "[redacted]" : clean(item, seen)]));
}
for (const method of ["log", "info", "warn", "error", "debug", "dir"]) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (args.some(arg => typeof arg === "string" && /(?:Closing (?:open )?session|SessionEntry|Session already closed)/i.test(arg))) return;
    original(...args.map(arg => clean(arg)));
  };
}
