declare module "telegramify" {
  export function renderTelegramRichText(ast: unknown): {
    text: string;
    entities: Array<{ type: string; offset: number; length: number; language?: string }>;
    segments: Array<unknown>;
  };
}

declare module "@chat-adapter/telegram" {
  import type { Adapter } from "chat";

  export function createTelegramAdapter(config?: unknown): Adapter<unknown, unknown>;
}
