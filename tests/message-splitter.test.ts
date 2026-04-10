import { describe, expect, it } from "vitest";
import { splitMessage } from "../src/runtime/message-splitter.js";

describe("message-splitter", () => {
  it("returns short messages unchanged", () => {
    expect(splitMessage("hello", 10)).toEqual(["hello"]);
  });

  it("splits long messages by newline when possible", () => {
    const chunks = splitMessage("12345\n67890", 7);
    expect(chunks).toEqual(["12345", "\n67890"]);
  });
});
