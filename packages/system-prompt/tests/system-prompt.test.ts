import { describe, expect, it } from "vitest";
import { buildShellRainingSystemPrompt } from "../src/index.js";
import type { SystemPromptContext } from "../src/index.js";

function createContext(): SystemPromptContext {
  return {
    environmentName: "shellRaining",
    skills: {
      enabled: true,
      readToolName: "read",
    },
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

  it("renders skill usage guidance without embedding a catalog", () => {
    const result = buildShellRainingSystemPrompt(createContext());

    expect(result).toContain("## Skills");
    expect(result).toContain("Pi may append an <available_skills> catalog later");
    expect(result).toContain("read that skill's SKILL.md with the read tool");
    expect(result).not.toContain("<skill>");
  });

  it("omits skill guidance when skills are disabled", () => {
    const context = createContext();
    context.skills = { enabled: false, readToolName: "read" };

    const result = buildShellRainingSystemPrompt(context);

    expect(result).not.toContain("## Skills");
    expect(result).not.toContain("<available_skills>");
  });
});
