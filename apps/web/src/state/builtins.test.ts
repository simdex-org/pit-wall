import { describe, expect, it } from "vitest";
import "../modules";
import { BUILTIN_TEMPLATES } from "./builtins";
import { sanitize } from "./templates";

describe("built-in templates", () => {
  for (const t of BUILTIN_TEMPLATES) {
    it(`${t.name} uses only registered modules and fits its grid`, () => {
      const r = sanitize(t);
      expect(r.dropped).toEqual([]);
      expect(r.fixed).toBe(0);
    });
  }
});
