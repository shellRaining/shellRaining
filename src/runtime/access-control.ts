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
