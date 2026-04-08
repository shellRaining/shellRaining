import { describe, expect, it } from "vitest";
import { getSessionDirectoryForThread, getThreadKeyFromId } from "../src/pi/session-store.js";

describe("session-store", () => {
  it("normalizes thread ids into safe keys", () => {
    expect(getThreadKeyFromId("telegram:123:456")).toBe("telegram__123__456");
  });

  it("creates stable session directory paths", () => {
    expect(getSessionDirectoryForThread("/base", "telegram__123")).toBe("/base/sessions/telegram__123");
  });
});
