import { createReadStream, statSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { FRAME_PATH, secure } from "./headers.js";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".map": "application/json", ".txt": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, secure({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" }));
  res.end(text);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): void {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, "bad request"); }
  if (rel === "/") rel = "/index.html";
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, "not found");
  let st;
  try { st = statSync(file); } catch { return send(res, 404, "not found"); }
  if (!st.isFile()) return send(res, 404, "not found");
  const frame = rel === FRAME_PATH;
  const since = req.headers["if-modified-since"];
  if (since && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, secure({ "Cache-Control": "no-cache" }, frame));
    return void res.end();
  }
  res.writeHead(200, secure({ "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": st.size,
    "Last-Modified": st.mtime.toUTCString(), "Cache-Control": "no-cache" }, frame));
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}
