import { describe, expect, it } from "vitest";
import { isUserAllowed } from "../src/runtime/access-control.js";

describe("access-control", () => {
  it("allows all users when allowlist is empty", () => {
    expect(isUserAllowed([], "123")).toBe(true);
  });

  it("allows only configured user ids", () => {
    expect(isUserAllowed([123], "123")).toBe(true);
    expect(isUserAllowed([123], "456")).toBe(false);
  });
});
