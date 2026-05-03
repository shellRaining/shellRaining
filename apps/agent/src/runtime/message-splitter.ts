const DEFAULT_MAX_MESSAGE_LENGTH = 4096;

/**
 * Splits `text` into chunks that fit within `maxLength` (Telegram's 4096-char limit).
 *
 * Splitting strategy, in priority order:
 * 1. Newline closest to `maxLength` (but not below `maxLength / 2`).
 * 2. Space closest to `maxLength`.
 * 3. Hard cut at `maxLength`.
 *
 * Consecutive blank lines at the split boundary are collapsed into the preceding chunk
 * to avoid leading with an empty line in the next chunk.
 */
export function splitMessage(
  text: string,
  maxLength: number = DEFAULT_MAX_MESSAGE_LENGTH,
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    const splitByNewline = splitIndex !== -1 && splitIndex >= maxLength / 2;
    if (!splitByNewline) {
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    if (splitByNewline) {
      while (
        splitIndex > 0 &&
        remaining[splitIndex] === "\n" &&
        remaining[splitIndex - 1] === "\n"
      ) {
        splitIndex -= 1;
      }
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
}
