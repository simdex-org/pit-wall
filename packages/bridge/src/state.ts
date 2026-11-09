import { cleanConfig } from "./config.js";
import type { Field } from "./broadcast/field.js";
import type { FieldSource } from "./broadcast/client.js";
import type { Mfd } from "./pit/mfd.js";
import type { Telemetry } from "./telemetry/telemetry.js";
import type { Rec } from "./util.js";

export const STATE: Rec = {
  reading: null, summary: null, t_reading: 0, t_summary: 0, ver: 0, pit_job: null, laps: [], past: [], laps_ver: 0,
  field: null, field_ver: 0, t_field: 0, entries: null, entries_ver: 0, log: [], log_seq: 0, lap: 0,
  pit_log: [], pit_log_ver: 0, config: cleanConfig({}), config_ver: 0, config_t: 0, pit_remote: null,
  bc: { state: "off", msg: "", port: 0 },
};

export const PIT: { mfd: (Mfd & { close?(): void }) | null; key: string; open: boolean; busy: boolean; doing: string; closed_at: number } =
  { mfd: null, key: "", open: false, busy: false, doing: "", closed_at: 0 };

export const FIELD: { f: Field | null; src: FieldSource | null } = { f: null, src: null };

export const CTX: { hint: Rec | null; mandatory: number | null; loss_ms: number | null } = { hint: null, mandatory: null, loss_ms: null };

export const TEL: { t: Telemetry | null } = { t: null };

export const FAST = { n: 0 };

export function log(sev: number, cat: string, text: string, lap?: number): void {
  STATE.log_seq++;
  STATE.log.push({ seq: STATE.log_seq, t: Math.round(Date.now()) / 1000, lap: lap ?? STATE.lap, sev, cat, text });
  if (STATE.log.length > 500) STATE.log.splice(0, STATE.log.length - 500);
  STATE.ver++;
}

export function setJob(job: Rec): void {
  STATE.pit_job = { ...job, t: Date.now() / 1000 };
  STATE.ver++;
}

const said = new Set<string>();
export function fieldErr(e: unknown): void {
  const k = `${e instanceof Error ? e.constructor.name : "Error"}: ${e instanceof Error ? e.message : e}`.slice(0, 200);
  if (!said.has(k)) {
    said.add(k);
    log(2, "FIELD", `Field timing error, skipped: ${k}`);
    console.error(e);
  }
}
