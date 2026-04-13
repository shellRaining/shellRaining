export interface SttConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface TranscribeAudioInput {
  config: SttConfig;
  data: Buffer;
  filename: string;
  mimeType?: string;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end--;
  }
  return value.slice(0, end);
}

export async function transcribeAudio(input: TranscribeAudioInput): Promise<string | undefined> {
  const baseUrl = input.config.baseUrl?.trim();
  if (!baseUrl) {
    return undefined;
  }

  const form = new FormData();
  form.append("model", input.config.model?.trim() || "whisper-1");
  form.append(
    "file",
    new Blob([new Uint8Array(input.data)], {
      type: input.mimeType || "application/octet-stream",
    }),
    input.filename,
  );

  const headers = input.config.apiKey?.trim()
    ? { Authorization: `Bearer ${input.config.apiKey.trim()}` }
    : undefined;

  const response = await fetch(`${trimTrailingSlashes(baseUrl)}/v1/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`STT transcription failed: ${response.status}${body ? ` ${body}` : ""}`);
  }

  const payload = (await response.json()) as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : undefined;
}
