/**
 * Checks whether a Telegram user is allowed to interact with the bot.
 *
 * An **empty** `allowedUsers` array means **all** users are permitted (open mode).
 * This is the inverse of a typical "blocklist" mental model — it exists so that
 * the bot works out-of-box without configuring user IDs.
 *
 * Returns `false` when `userId` is missing or not a valid number.
 */
export function isUserAllowed(allowedUsers: number[], userId: string | undefined): boolean {
  if (allowedUsers.length === 0) {
    return true;
  }

  if (!userId) {
    return false;
  }

  const parsed = Number.parseInt(userId, 10);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return allowedUsers.includes(parsed);
}
