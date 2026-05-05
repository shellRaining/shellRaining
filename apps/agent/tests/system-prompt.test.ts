import { describe, expect, it } from "vitest";
import { buildShellRainingSystemPrompt } from "../src/system-prompt/index.js";
import type { SystemPromptContext } from "../src/system-prompt/index.js";

function createContext(): SystemPromptContext {
  return {
    environmentName: "shellRaining",
    telegram: {
      inboxDir: "~/.shellRaining/inbox/",
      outputStyle: "chat",
    },
  };
}

describe("system-prompt", () => {
  it("renders Telegram input and output guidance", () => {
    const result = buildShellRainingSystemPrompt(createContext());

    expect(result).toContain("[Telegram attachments]");
    expect(result).toContain("Do not claim you read an attachment before reading it");
    expect(result).toContain("~/.shellRaining/inbox/");
    expect(result).toContain("Telegram output is a chat surface");
    expect(result).toContain("Avoid Markdown tables in Telegram replies");
    expect(result).toContain("do not intentionally split a sentence");
  });

  it("does not render shellRaining-specific skills guidance", () => {
    const result = buildShellRainingSystemPrompt(createContext());

    expect(result).not.toContain("## Skills");
    expect(result).not.toContain("Pi may append an <available_skills> catalog later");
    expect(result).not.toContain("read that skill's SKILL.md with the read tool");
  });
});
