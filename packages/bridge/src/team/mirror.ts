import { cleanConfig } from "../config.js";
import { log, STATE, TEL } from "../state.js";
import { isObj, Rec } from "../util.js";
import { following, meet, Peer } from "./link.js";

// Both bridges see the field, so only the car's own lines are copied
const FIELD_CATS = new Set(["FIELD", "RC", "TEAM"]);

// A teammate's payload: settings newer than ours win; while their driver has the car, their car data becomes ours
export function receive(p: Peer, d: Rec, first: boolean): void {
  const t = isObj(d.team) ? d.team : {};
  if (typeof t.name === "string") p.name = t.name.slice(0, 60);
  meet(t.mates);
  if (!!t.driving !== p.driving) { p.driving = !!t.driving; STATE.ver++; }
  if (isObj(d.config) && typeof t.config_t === "number" && t.config_t > STATE.config_t) {
    try { STATE.config = cleanConfig(d.config); STATE.config_t = t.config_t; STATE.config_ver++; STATE.ver++; } catch { }
  }
  if (following() !== p) return;
  if (isObj(t.hist) && Array.isArray(t.hist.laps) && Array.isArray(t.hist.stops)) TEL.t?.adopt(t.hist);
  const now = Date.now() / 1000;
  if (d.reading) { STATE.reading = d.reading; STATE.t_reading = now - (d.reading_age_ms ?? 0) / 1000; }
  if (d.summary) { STATE.summary = d.summary; STATE.t_summary = now - (d.summary_age_ms ?? 0) / 1000; }
  if (Array.isArray(d.laps)) { STATE.laps = d.laps; if (Array.isArray(d.past)) STATE.past = d.past; STATE.laps_ver++; }
  if (Array.isArray(d.pit_log)) { STATE.pit_log = d.pit_log; STATE.pit_log_ver++; }
  STATE.pit_job = d.pit_job ?? null;
  STATE.pit_remote = d.pit ?? null;
  if (!first && Array.isArray(d.log)) for (const l of d.log) if (isObj(l) && !FIELD_CATS.has(l.cat)) log(l.sev, String(l.cat), String(l.text), l.lap);
  STATE.ver++;
}
