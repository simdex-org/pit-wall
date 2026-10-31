// Serves the page's files. Every response says no-cache (browsers otherwise show an old version after an update); an
// unchanged file is answered with a short 304.
import { createReadStream, statSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

// Windows' registry can map .js to text/plain, and browsers refuse a module served so; so the table is ours.
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json", ".txt": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(text);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): void {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, "bad request"); }
  if (rel === "/") rel = "/index.html";
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, "not found"); // no walking out of the folder
  let st;
  try { st = statSync(file); } catch { return send(res, 404, "not found"); }
  if (!st.isFile()) return send(res, 404, "not found");
  const since = req.headers["if-modified-since"];
  if (since && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, { "Cache-Control": "no-cache" });
    return void res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": st.size,
    "Last-Modified": st.mtime.toUTCString(), "Cache-Control": "no-cache" });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}
