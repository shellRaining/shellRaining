import { buildEnvironmentPrompt } from "./fragments/environment.js";
import { buildSkillsPrompt } from "./fragments/skills.js";
import { buildTelegramInputPrompt } from "./fragments/telegram-input.js";
import { buildTelegramOutputPrompt } from "./fragments/telegram-output.js";
import type { SystemPromptContext } from "./types.js";

export function buildShellRainingSystemPrompt(context: SystemPromptContext): string {
  return [
    buildEnvironmentPrompt(context),
    buildSkillsPrompt(context),
    buildTelegramInputPrompt(context),
    buildTelegramOutputPrompt(context),
  ]
    .filter(Boolean)
    .join("\n");
}
