import { describe, expect, it } from "vitest";
import { buildServiceProfileContext } from "../src/runtime/service-profile.js";

describe("service-profile", () => {
  it("renders a prompt block with known service endpoints", () => {
    const result = buildServiceProfileContext({
      apiBaseUrl: "https://api.shellraining.xyz",
      crawlUrl: "https://crawl.shellraining.xyz",
      vikunjaUrl: "https://todo.shellraining.xyz",
    });

    expect(result).toContain("api.shellraining.xyz");
    expect(result).toContain("crawl.shellraining.xyz");
    expect(result).toContain("todo.shellraining.xyz");
  });

  it("renders Telegram attachment handling guidance", () => {
    const result = buildServiceProfileContext({
      apiBaseUrl: "https://api.shellraining.xyz",
      crawlUrl: "https://crawl.shellraining.xyz",
      vikunjaUrl: "https://todo.shellraining.xyz",
    });

    expect(result).toContain("[Telegram attachments]");
    expect(result).toContain("Do not claim you read an attachment before reading it");
    expect(result).toContain("~/.shellRaining/inbox/");
  });
});
