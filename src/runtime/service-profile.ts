import type { Config } from "../config.js";

export interface ServiceProfile {
  apiBaseUrl: string;
  crawlUrl: string;
  vikunjaUrl: string;
}

export function createServiceProfile(config: Config): ServiceProfile {
  return {
    apiBaseUrl: config.serviceProfile.apiBaseUrl,
    crawlUrl: config.serviceProfile.crawlUrl,
    vikunjaUrl: config.serviceProfile.vikunjaUrl,
  };
}

export function buildServiceProfileContext(profile: ServiceProfile): string {
  return [
    "You are running inside shellRaining's personal environment.",
    `Primary model/API gateway: ${profile.apiBaseUrl}`,
    `Web crawling/search service: ${profile.crawlUrl}`,
    `Task management service: ${profile.vikunjaUrl}`,
    "Prefer these service endpoints when a skill needs the user's self-hosted infrastructure.",
  ].join("\n");
}
