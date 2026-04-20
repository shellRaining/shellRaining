import type { SystemPromptContext } from "../types.js";

export function buildEnvironmentPrompt(context: SystemPromptContext): string {
  return `You are running inside ${context.environmentName}'s personal environment.`;
}
