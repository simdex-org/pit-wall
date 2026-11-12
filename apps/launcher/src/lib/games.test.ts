import { describe, expect, test } from "vitest";
import { Games, pickGame } from "./games";

const g = (acc: [boolean, boolean], ac: [boolean, boolean], lmu: [boolean, boolean] = [false, false]): Games => ({
  acc: { installed: acc[0], running: acc[1] },
  ac: { installed: ac[0], running: ac[1], app: "none", csp: true },
  lmu: { installed: lmu[0], running: lmu[1] },
});

describe("pickGame", () => {
  test("a typed choice always wins", () => {
    expect(pickGame(g([true, true], [true, false]), "ac")).toBe("ac");
    expect(pickGame(null, "acc")).toBe("acc");
  });

  test("auto follows the running game", () => {
    expect(pickGame(g([true, false], [true, true]), "auto")).toBe("ac");
    expect(pickGame(g([true, true], [true, false]), "auto")).toBe("acc");
  });

  test("auto falls back to the only game installed, then to ACC", () => {
    expect(pickGame(g([false, false], [true, false]), "auto")).toBe("ac");
    expect(pickGame(g([true, false], [true, false]), "auto")).toBe("acc");
    expect(pickGame(g([false, false], [false, false]), "auto")).toBe("acc");
    expect(pickGame(null, "auto")).toBe("acc");
  });

  test("Le Mans Ultimate: running, the only one installed, or chosen", () => {
    expect(pickGame(g([true, false], [true, false], [true, true]), "auto")).toBe("lmu");
    expect(pickGame(g([false, false], [false, false], [true, false]), "auto")).toBe("lmu");
    expect(pickGame(g([true, false], [false, false], [true, false]), "auto")).toBe("acc");
    expect(pickGame(g([true, true], [false, false], [true, false]), "lmu")).toBe("lmu");
  });
});
