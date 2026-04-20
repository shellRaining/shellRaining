import type { SystemPromptContext } from "../types.js";

export function buildSkillsPrompt(context: SystemPromptContext): string {
  const skills = context.skills;
  if (!skills?.enabled) {
    return "";
  }

  return [
    "## Skills",
    "Pi may append an <available_skills> catalog later in this system prompt.",
    "Before doing non-trivial work, scan the available skill descriptions.",
    `If the user names a skill, or one skill clearly matches the task, read that skill's SKILL.md with the ${skills.readToolName} tool before acting and follow it.`,
    "If multiple skills could apply, choose the most specific one first. Do not read more than one skill up front unless the first skill explicitly requires another one.",
    "If no skill clearly applies, continue normally without reading skills.",
    "When a skill references relative paths, resolve them relative to that skill directory.",
  ].join("\n");
}
