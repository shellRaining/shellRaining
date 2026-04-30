import { describe, expect, it } from "vitest";
import { getSessionDirectoryForScope, getThreadKeyFromId } from "../src/pi/session-store.js";

describe("session-store", () => {
  it("normalizes thread ids into safe keys", () => {
    expect(getThreadKeyFromId("telegram:123:456")).toBe("telegram__123__456");
  });

  it("creates agent-scoped session directory paths", () => {
    expect(
      getSessionDirectoryForScope("/base", { agentId: "default", threadKey: "telegram__123" }),
    ).toBe("/base/sessions/default/telegram__123");
  });
});
