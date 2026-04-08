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
