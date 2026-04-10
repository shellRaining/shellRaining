const DEFAULT_MAX_MESSAGE_LENGTH = 4096;

export function splitMessage(text: string, maxLength: number = DEFAULT_MAX_MESSAGE_LENGTH): string[] {
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

    while (splitByNewline && splitIndex > 0 && remaining[splitIndex] === "\n" && remaining[splitIndex - 1] === "\n") {
      splitIndex -= 1;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
}
