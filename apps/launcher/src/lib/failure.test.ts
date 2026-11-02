import { describe, expect, test } from "vitest";
import { failureMessage } from "./failure";

describe("failureMessage", () => {
  test("names the address when this PC does not have it", () => {
    const lines = ["Cannot serve on 192.168.1.24:8765: listen EADDRNOTAVAIL: address not available"];
    expect(failureMessage(lines, " 192.168.1.24 ", "8765")).toMatch(/does not have the address 192\.168\.1\.24\./);
  });
  test("names the port when it is taken or refused", () => {
    expect(failureMessage(["listen EADDRINUSE"], "1.2.3.4", " 8765 ")).toMatch(/Port 8765 is already in use/);
    expect(failureMessage(["listen EACCES"], "1.2.3.4", "80")).toMatch(/does not allow port 80/);
  });
  test("falls back to the log", () => {
    expect(failureMessage(["something else"], "1.2.3.4", "8765")).toMatch(/log say why/);
  });
});
