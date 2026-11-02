import { expect, test } from "vitest";
import { formatUptime } from "./uptime";

test("formats hours, minutes and seconds", () => {
  expect(formatUptime(0)).toBe("00:00:00");
  expect(formatUptime(59_999)).toBe("00:00:59");
  expect(formatUptime(7 * 3600_000 + 42 * 60_000 + 10_000)).toBe("07:42:10");
  expect(formatUptime(25 * 3600_000)).toBe("25:00:00");
  expect(formatUptime(-5)).toBe("00:00:00");
});
