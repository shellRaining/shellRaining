import { buildEnvironmentPrompt } from "./fragments/environment.js";
import { buildTelegramInputPrompt } from "./fragments/telegram-input.js";
import { buildTelegramOutputPrompt } from "./fragments/telegram-output.js";
import type { SystemPromptContext } from "./types.js";

export function buildShellRainingSystemPrompt(context: SystemPromptContext): string {
  return [
    buildEnvironmentPrompt(context),
    buildTelegramInputPrompt(context),
    buildTelegramOutputPrompt(context),
    ...(context.extraSections ?? []),
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n");
}
