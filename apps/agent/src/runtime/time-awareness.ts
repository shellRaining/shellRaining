import { DateTime } from "luxon";

const CURRENT_TIME_PREFIX = "Current time:";
const TIMESTAMP_PREFIX_PATTERN = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2} .+\]\s/;
const CURRENT_TIME_LINE_PATTERN =
  /(^|\n)Current time: [A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2} .+ \/ \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/;

function formatWeekday(now: DateTime): string {
  return now.setLocale("en").toFormat("ccc");
}

function formatTimestamp(now: DateTime): string {
  return now.toFormat("yyyy-MM-dd HH:mm");
}

function resolveNow(nowMs?: number, timeZone = "UTC"): DateTime {
  return DateTime.fromMillis(nowMs ?? Date.now(), { zone: timeZone });
}

function resolveDefaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function injectPromptTimestampPrefix(
  message: string,
  options?: { nowMs?: number; timeZone?: string },
): string {
  const base = message.trim();
  if (!base) {
    return base;
  }
  if (TIMESTAMP_PREFIX_PATTERN.test(base)) {
    return base;
  }
  if (CURRENT_TIME_LINE_PATTERN.test(base)) {
    return base;
  }

  const timeZone = options?.timeZone ?? resolveDefaultTimeZone();
  const now = resolveNow(options?.nowMs, timeZone);
  const resolved = now.isValid ? now : resolveNow(options?.nowMs, "UTC");
  const zoneLabel = now.isValid ? timeZone : "UTC";
  return `[${formatWeekday(resolved)} ${formatTimestamp(resolved)} ${zoneLabel}] ${base}`;
}

export function appendCurrentTimeLine(
  message: string,
  options?: { nowMs?: number; timeZone?: string },
): string {
  const base = message.trimEnd();
  if (!base || CURRENT_TIME_LINE_PATTERN.test(base)) {
    return base;
  }

  const timeZone = options?.timeZone ?? resolveDefaultTimeZone();
  const localNow = resolveNow(options?.nowMs, timeZone);
  const resolvedLocal = localNow.isValid ? localNow : resolveNow(options?.nowMs, "UTC");
  const localZoneLabel = localNow.isValid ? timeZone : "UTC";
  const utcNow = resolvedLocal.toUTC();
  const timeLine =
    `${CURRENT_TIME_PREFIX} ${formatWeekday(resolvedLocal)} ${formatTimestamp(resolvedLocal)} ${localZoneLabel} / ` +
    `${formatTimestamp(utcNow)} UTC`;
  return `${base}\n${timeLine}`;
}
