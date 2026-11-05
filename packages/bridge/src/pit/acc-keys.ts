import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accConfigDir } from "../broadcast/config.js";
import type { Key } from "./mfd.js";

export interface KeyCode { vk: number; ext: boolean }

// ACC moves the pit page up and down with the arrow keys whatever Up and Down are bound to, so only the arrows go up and down
const ACTIONS: Record<string, Key> = { SetMfdPitstop: "pit", Left: "left", Right: "right", CycleHudMfd: "close" };
const DEFAULTS: Record<Key, string> = { pit: "P", up: "Up", down: "Down", left: "Left", right: "Right", close: "Insert" };
const DIGITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const NAMED: Record<string, KeyCode> = {
  Up: { vk: 0x26, ext: true }, Down: { vk: 0x28, ext: true }, Left: { vk: 0x25, ext: true }, Right: { vk: 0x27, ext: true },
  Insert: { vk: 0x2d, ext: true }, Delete: { vk: 0x2e, ext: true }, Home: { vk: 0x24, ext: true }, End: { vk: 0x23, ext: true },
  PageUp: { vk: 0x21, ext: true }, PageDown: { vk: 0x22, ext: true }, SpaceBar: { vk: 0x20, ext: false }, Enter: { vk: 0x0d, ext: false },
  Tab: { vk: 0x09, ext: false }, BackSpace: { vk: 0x08, ext: false },
};

// An Unreal key name as ACC stores it (Q, One, F5, Insert, NumPadOne) as a Windows virtual key
export function keyCode(name: string): KeyCode {
  if (NAMED[name]) return NAMED[name]!;
  if (/^[A-Za-z]$/.test(name)) return { vk: name.toUpperCase().charCodeAt(0), ext: false };
  if (/^[0-9]$/.test(name)) return { vk: 0x30 + Number(name), ext: false };
  const fn = /^F(\d+)$/i.exec(name);
  if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24) return { vk: 0x6f + Number(fn[1]), ext: false };
  if (DIGITS.includes(name)) return { vk: 0x30 + DIGITS.indexOf(name), ext: false };
  const pad = /^NumPad(\w+)$/.exec(name);
  if (pad && DIGITS.includes(pad[1]!)) return { vk: 0x60 + DIGITS.indexOf(pad[1]!), ext: false };
  throw new Error(`Pit Wall cannot press ACC key '${name}'`);
}

// The keyboard keys ACC has for the pitstop page, cycling the MFD and changing a value; ACC's own default where nothing is set
export function accKeys(controlsJson?: string): Record<Key, string> {
  const keys = { ...DEFAULTS };
  if (controlsJson === undefined) {
    try { controlsJson = readFileSync(join(accConfigDir(), "controls.json"), "utf-8"); } catch { return keys; }
  }
  let list: { actionType?: string; key?: { key?: string; bShift?: boolean; bCtrl?: boolean; bAlt?: boolean } }[] = [];
  try { list = JSON.parse(controlsJson.replace(/^﻿/, "")).keyboardSettings?.raceCommandButtonList ?? []; } catch { return keys; }
  for (const e of list) {
    const k = ACTIONS[e.actionType ?? ""], name = e.key?.key;
    if (k && name && name !== "None" && !e.key?.bShift && !e.key?.bCtrl && !e.key?.bAlt) keys[k] = name;
  }
  return keys;
}
