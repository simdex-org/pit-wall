import { describe, expect, test } from "vitest";
import { accKeys, keyCode } from "../src/pit/acc-keys.js";

const entry = (actionType: string, key: string, bShift = false) => ({ actionType, key: { key, bShift, bCtrl: false, bAlt: false, bCmd: false } });
const controls = (list: unknown[]) => "﻿" + JSON.stringify({ keyboardSettings: { raceCommandButtonList: list } });

describe("ACC's MFD keys", () => {
  test("ACC's defaults when nothing is bound or the file is unreadable", () => {
    const d = { pit: "P", up: "Up", down: "Down", left: "Left", right: "Right", close: "Insert" };
    expect(accKeys(controls([]))).toEqual(d);
    expect(accKeys("not json")).toEqual(d);
  });

  test("bindings replace the defaults; None, modifiers, Up/Down and other actions are skipped", () => {
    const keys = accKeys(controls([
      entry("SetMfdPitstop", "One"), entry("Up", "Q"), entry("Down", "A"), entry("Left", "E"), entry("Right", "D"),
      entry("CycleHudMfd", "None"), entry("CycleHudMfd", "Two"), entry("Up", "W", true), entry("KeyboardGas", "W"),
    ]));
    expect(keys).toEqual({ pit: "One", up: "Up", down: "Down", left: "E", right: "D", close: "Two" });
  });

  test("Unreal key names map to virtual keys, with the extended flag where Windows needs it", () => {
    expect(keyCode("One")).toEqual({ vk: 0x31, ext: false });
    expect(keyCode("Zero").vk).toBe(0x30);
    expect(keyCode("q")).toEqual({ vk: 0x51, ext: false });
    expect([keyCode("F1").vk, keyCode("f24").vk]).toEqual([0x70, 0x87]);
    expect(keyCode("Insert")).toEqual({ vk: 0x2d, ext: true });
    expect(keyCode("Left")).toEqual({ vk: 0x25, ext: true });
    expect(keyCode("NumPadThree").vk).toBe(0x63);
    expect(() => keyCode("pit")).toThrow();
  });
});
