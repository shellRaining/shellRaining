import type { Config } from "../config.js";

export interface ServiceProfile {
  apiBaseUrl: string;
  crawlUrl: string;
  /** Vikunja (self-hosted task manager) URL. */
  vikunjaUrl: string;
}

export function createServiceProfile(config: Config): ServiceProfile {
  return {
    apiBaseUrl: config.serviceProfile.apiBaseUrl,
    crawlUrl: config.serviceProfile.crawlUrl,
    vikunjaUrl: config.serviceProfile.vikunjaUrl,
  };
}

/**
 * Builds a system-prompt fragment telling the Pi agent about available
 * self-hosted service endpoints and how to handle Telegram attachments.
 */
export function buildServiceProfileContext(profile: ServiceProfile): string {
  return [
    "You are running inside shellRaining's personal environment.",
    `Primary model/API gateway: ${profile.apiBaseUrl}`,
    `Web crawling/search service: ${profile.crawlUrl}`,
    `Task management service: ${profile.vikunjaUrl}`,
    "Telegram input attachments are saved locally under ~/.shellRaining/inbox/ and are referenced with absolute paths.",
    "When the user sends [Telegram attachments], inspect the listed files only when needed for the request.",
    "Do not claim you read an attachment before reading it.",
    "For PDFs, spreadsheets, office documents, archives, and other non-text files, use bash or existing tools to inspect or convert them as needed.",
    "Prefer these service endpoints when a skill needs the user's self-hosted infrastructure.",
  ].join("\n");
}
