import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("stt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns undefined when STT base URL is not configured", async () => {
    const { transcribeAudio } = await import("../src/runtime/stt.js");

    const result = await transcribeAudio({
      config: {},
      data: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts audio to the OpenAI-compatible transcriptions endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "整理会议纪要" }),
    });

    const { transcribeAudio } = await import("../src/runtime/stt.js");
    const result = await transcribeAudio({
      config: {
        apiKey: "secret",
        baseUrl: "https://stt.shellraining.xyz/",
        model: "faster-whisper-large-v3",
      },
      data: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });

    expect(result).toBe("整理会议纪要");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://stt.shellraining.xyz/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer secret" });
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("faster-whisper-large-v3");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throws a clear error when STT returns a non-OK response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "service unavailable",
    });

    const { transcribeAudio } = await import("../src/runtime/stt.js");

    await expect(transcribeAudio({
      config: { baseUrl: "https://stt.shellraining.xyz" },
      data: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    })).rejects.toThrow("STT transcription failed: 503 service unavailable");
  });
});
