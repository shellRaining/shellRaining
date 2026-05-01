/** Empty env/config strings mean "not configured" so lower-priority config can still apply. */
export function resolveConfigValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Invalid numeric env values are ignored instead of blocking startup with a bad override. */
export function parseOptionalNumber(value: string | undefined): number | undefined {
  const resolved = resolveConfigValue(value);
  if (!resolved) {
    return undefined;
  }

  const parsed = Number.parseInt(resolved, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Only explicit true/false strings override file/default config; other values are ignored. */
export function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const resolved = resolveConfigValue(value);
  if (!resolved) {
    return undefined;
  }

  const normalized = resolved.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

/** Env allowlists are comma-separated because shell env values cannot represent arrays directly. */
export function parseOptionalAllowedUsers(value: string | undefined): number[] | undefined {
  const resolved = resolveConfigValue(value);
  if (!resolved) {
    return undefined;
  }

  return resolved
    .split(",")
    .map((id) => Number.parseInt(id.trim(), 10))
    .filter((id) => !Number.isNaN(id));
}
