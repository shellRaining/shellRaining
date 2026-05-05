import type { SystemPromptContext } from "../types.js";

export function buildTelegramInputPrompt(context: SystemPromptContext): string {
  return [
    `Telegram input attachments are saved locally under ${context.telegram.inboxDir} and are referenced with absolute paths.`,
    "When the user sends [Telegram attachments], inspect the listed files only when needed for the request.",
    "Do not claim you read an attachment before reading it.",
    "For PDFs, spreadsheets, office documents, archives, and other non-text files, use bash or existing tools to inspect or convert them as needed.",
  ].join("\n");
}
