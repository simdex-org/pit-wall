// Finds, reads and switches on ACC's broadcasting.json.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import koffi from "koffi";

/** ACC's Config folder, under the user's real Documents folder: OneDrive and folder redirection move it away from ~/Documents. */
export function accConfigDir(): string {
  let docs = join(homedir(), "Documents");
  try {
    const shell32 = koffi.load("shell32.dll");
    const GUID = koffi.struct("GUID", { d1: "uint32", d2: "uint16", d3: "uint16", d4: koffi.array("uint8", 8) });
    const get = shell32.func("int __stdcall SHGetKnownFolderPath(const GUID *id, uint32 flags, void *token, _Out_ str16 *out)");
    const out: (string | null)[] = [null];
    // FOLDERID_Documents
    const id = { d1: 0xfdd39ad0, d2: 0x238f, d3: 0x46af, d4: [0xad, 0xb4, 0x6c, 0x85, 0x48, 0x03, 0x69, 0xc7] };
    if (get(id, 0, null, out) === 0 && out[0]) docs = out[0];
  } catch { /* not Windows */ }
  return join(docs, "Assetto Corsa Competizione", "Config");
}

const cfgPath = (path?: string): string => path ?? join(accConfigDir(), "broadcasting.json");

type Enc = "bom" | "utf-16-le" | "utf-8";
function decode(b: Buffer): [string, Enc] {
  if (b[0] === 0xff && b[1] === 0xfe) return [b.subarray(2).toString("utf16le"), "bom"];
  if (b[1] === 0) return [b.toString("utf16le"), "utf-16-le"];
  return [b.toString("utf-8").replace(/^﻿/, ""), "utf-8"];
}

export interface BroadcastConfig { port: number; password: string; command_password: string; path: string }

/** ACC's broadcasting.json. Throws on a missing or unreadable file. */
export function readConfig(path?: string): BroadcastConfig {
  const p = cfgPath(path);
  const j = JSON.parse(decode(readFileSync(p))[0]);
  return { port: Number(j.updListenerPort) || 0, password: String(j.connectionPassword || ""), command_password: String(j.commandPassword || ""), path: p };
}

/** Switch ACC's broadcasting port on, keeping the file's encoding (ACC writes UTF-16LE without a BOM). Backs it up first. */
export function enable(port = 9000, path?: string): string {
  const p = cfgPath(path);
  const dir = dirname(p);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return `ACC's settings folder is not at ${dir}. Open ACC once, to the main menu, so it creates it; then run this again.`;
  }
  if (!existsSync(p)) { // ACC writes it on its first run; until then write the one ACC would, UTF-16LE
    writeFileSync(p, Buffer.from(JSON.stringify({ updListenerPort: 0, connectionPassword: "", commandPassword: "" }, null, 4), "utf16le"));
  }
  const [text, enc] = decode(readFileSync(p));
  const j = JSON.parse(text);
  j.updListenerPort = Math.trunc(port);
  if (!j.connectionPassword) j.connectionPassword = randomBytes(6).toString("hex");
  copyFileSync(p, p + ".bak");
  const out = JSON.stringify(j, null, 4);
  writeFileSync(p, enc === "bom" ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(out, "utf16le")])
    : enc === "utf-16-le" ? Buffer.from(out, "utf16le") : Buffer.from(out, "utf-8"));
  return `Broadcasting on port ${port} in ${p} (backup: broadcasting.json.bak). Restart ACC for this to take effect.`;
}
