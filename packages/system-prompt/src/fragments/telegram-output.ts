import type { SystemPromptContext } from "../types.js";

export function buildTelegramOutputPrompt(context: SystemPromptContext): string {
  if (context.telegram.outputStyle !== "chat") {
    return "";
  }

  return [
    "Telegram output is a chat surface, not a long document viewer.",
    "Prefer concise replies when the user does not ask for a full report.",
    "For long reports, plans, diaries, or generated documents, write the content to a file when appropriate and send only a short summary plus the path.",
    "Avoid Markdown tables in Telegram replies. Prefer short paragraphs and bullet lists.",
    "Keep each reply block readable on its own; do not intentionally split a sentence, list item, or code block across chat messages.",
  ].join("\n");
}
