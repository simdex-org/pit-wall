import { describe, expect, test } from "vitest";
import { Games, pickGame } from "./games";

const g = (acc: [boolean, boolean], ac: [boolean, boolean]): Games => ({
  acc: { installed: acc[0], running: acc[1] },
  ac: { installed: ac[0], running: ac[1], app: "none", csp: true },
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
});
