import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock: navigator.mediaDevices.getUserMedia & MediaRecorder
// ---------------------------------------------------------------------------

type DataAvailableHandler = (event: { data: Blob }) => void;
type StopHandler = () => void;
type ErrorHandler = () => void;

let mockMediaRecorderInstance: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  state: string;
  mimeType: string;
  ondataavailable: DataAvailableHandler | null;
  onstop: StopHandler | null;
  onerror: ErrorHandler | null;
};

const mockIsTypeSupported = vi.fn<(type: string) => boolean>();

function createMockMediaRecorder(
  _stream: MediaStream,
  options?: { mimeType?: string },
) {
  mockMediaRecorderInstance = {
    start: vi.fn(() => {
      mockMediaRecorderInstance.state = "recording";
    }),
    stop: vi.fn(() => {
      mockMediaRecorderInstance.state = "inactive";
      // Simulate async onstop callback
      queueMicrotask(() => {
        mockMediaRecorderInstance.onstop?.();
      });
    }),
    state: "inactive",
    mimeType: options?.mimeType || "audio/webm",
    ondataavailable: null,
    onstop: null,
    onerror: null,
  };
  return mockMediaRecorderInstance;
}

(
  createMockMediaRecorder as unknown as {
    isTypeSupported: typeof mockIsTypeSupported;
  }
).isTypeSupported = mockIsTypeSupported;

vi.stubGlobal(
  "MediaRecorder",
  Object.assign(createMockMediaRecorder, {
    isTypeSupported: mockIsTypeSupported,
  }),
);

const mockGetUserMedia = vi.fn<() => Promise<MediaStream>>();
vi.stubGlobal("navigator", {
  mediaDevices: {
    getUserMedia: mockGetUserMedia,
  },
});

// ---------------------------------------------------------------------------
// SUT (reset module state between tests via dynamic import)
// ---------------------------------------------------------------------------

// We need to re-import the module for each test to reset module-level state.
// Vitest's `vi.resetModules()` + dynamic import handles this.

async function importRecorder() {
  const mod = await import("../../src/lib/recorder");
  return mod;
}

describe("recorder.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUserMedia.mockReset();
    mockIsTypeSupported.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // detectSupportedMimeType (tested via startRecording behaviour)
  // ========================================================================

  describe("detectSupportedMimeType (via startRecording)", () => {
    it("[P0] should use the first supported MIME type from the candidate list", async () => {
      // Given: only audio/mp4 is supported (the 3rd candidate)
      mockIsTypeSupported.mockImplementation(
        (type: string) => type === "audio/mp4",
      );
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording } = await importRecorder();

      // When: microphone is initialized and recording starts
      await initializeMicrophone();
      startRecording();

      // Then: MediaRecorder should be created with audio/mp4
      expect(mockIsTypeSupported).toHaveBeenCalledWith(
        "audio/webm;codecs=opus",
      );
      expect(mockIsTypeSupported).toHaveBeenCalledWith("audio/webm");
      expect(mockIsTypeSupported).toHaveBeenCalledWith("audio/mp4");
      expect(mockMediaRecorderInstance.mimeType).toBe("audio/mp4");
    });

    it("[P0] should prefer audio/webm;codecs=opus when supported", async () => {
      // Given: all MIME types are supported
      mockIsTypeSupported.mockReturnValue(true);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording } = await importRecorder();

      // When: recording starts
      await initializeMicrophone();
      startRecording();

      // Then: should pick the first candidate
      expect(mockMediaRecorderInstance.mimeType).toBe("audio/webm;codecs=opus");
    });

    it("[P0] should create MediaRecorder without mimeType option when none is supported", async () => {
      // Given: no MIME types are supported
      mockIsTypeSupported.mockReturnValue(false);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording } = await importRecorder();

      // When: recording starts
      await initializeMicrophone();
      startRecording();

      // Then: MediaRecorder should be constructed without explicit mimeType
      // (fallback: the constructor receives empty spread from empty string)
      expect(mockMediaRecorderInstance.start).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // initializeMicrophone
  // ========================================================================

  describe("initializeMicrophone", () => {
    it("[P0] should request user media with correct audio constraints", async () => {
      // Given: getUserMedia resolves with a stream
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone } = await importRecorder();

      // When: initializing the microphone
      await initializeMicrophone();

      // Then: should call getUserMedia with audio constraints
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
    });

    it("[P0] should be idempotent - not request media again if already initialized", async () => {
      // Given: a stream is already obtained
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone } = await importRecorder();

      // When: calling initialize twice
      await initializeMicrophone();
      await initializeMicrophone();

      // Then: getUserMedia should only be called once
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });

    it("[P0] should propagate getUserMedia rejection", async () => {
      // Given: getUserMedia rejects (e.g., permission denied)
      mockGetUserMedia.mockRejectedValue(new DOMException("Permission denied"));

      const { initializeMicrophone } = await importRecorder();

      // When/Then: initialization should throw
      await expect(initializeMicrophone()).rejects.toThrow("Permission denied");
    });
  });

  // ========================================================================
  // startRecording
  // ========================================================================

  describe("startRecording", () => {
    it("[P0] should throw if microphone is not initialized", async () => {
      // Given: microphone has NOT been initialized
      const { startRecording } = await importRecorder();

      // When/Then: starting recording should throw
      expect(() => startRecording()).toThrow(
        "Microphone not initialized. Call initializeMicrophone() first.",
      );
    });

    it("[P0] should call MediaRecorder.start() when microphone is initialized", async () => {
      // Given: microphone is initialized
      mockIsTypeSupported.mockReturnValue(true);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording } = await importRecorder();
      await initializeMicrophone();

      // When: starting recording
      startRecording();

      // Then: MediaRecorder.start should be called
      expect(mockMediaRecorderInstance.start).toHaveBeenCalledTimes(1);
    });

    it("[P0] should reset audio chunks on each new recording", async () => {
      // Given: microphone is initialized; first recording produces data
      mockIsTypeSupported.mockReturnValue(true);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording, stopRecording } =
        await importRecorder();
      await initializeMicrophone();

      // When: start first recording, feed some data, stop, start again
      startRecording();
      mockMediaRecorderInstance.ondataavailable?.({
        data: new Blob(["chunk1"]),
      });
      const blob1 = await stopRecording();

      // Then: first blob should contain the data
      expect(blob1.size).toBeGreaterThan(0);

      // When: start a second recording with no data
      startRecording();

      // Then: stopping with no data should reject with empty recording error
      await expect(stopRecording()).rejects.toThrow(
        "錄音資料為空，未擷取到任何音訊",
      );
    });
  });

  // ========================================================================
  // stopRecording
  // ========================================================================

  describe("stopRecording", () => {
    it("[P0] should reject if no active recording exists", async () => {
      // Given: no recording has been started
      const { stopRecording } = await importRecorder();

      // When/Then: stopping should reject
      await expect(stopRecording()).rejects.toThrow(
        "No active recording to stop.",
      );
    });

    it("[P0] should resolve with a Blob containing recorded audio chunks", async () => {
      // Given: microphone initialized, recording started, data available
      mockIsTypeSupported.mockReturnValue(false);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording, stopRecording } =
        await importRecorder();
      await initializeMicrophone();
      startRecording();

      // Simulate data chunks
      mockMediaRecorderInstance.ondataavailable?.({
        data: new Blob(["part-a"]),
      });
      mockMediaRecorderInstance.ondataavailable?.({
        data: new Blob(["part-b"]),
      });

      // When: stopping
      const audioBlob = await stopRecording();

      // Then: Blob should be assembled from chunks
      expect(audioBlob).toBeInstanceOf(Blob);
      expect(audioBlob.size).toBe(
        new Blob(["part-a"]).size + new Blob(["part-b"]).size,
      );
    });

    it("[P0] should use the mediaRecorder mimeType as the Blob type", async () => {
      // Given: mediaRecorder has mimeType = audio/webm;codecs=opus
      mockIsTypeSupported.mockImplementation(
        (t: string) => t === "audio/webm;codecs=opus",
      );
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording, stopRecording } =
        await importRecorder();
      await initializeMicrophone();
      startRecording();

      mockMediaRecorderInstance.ondataavailable?.({ data: new Blob(["x"]) });

      // When: stopping
      const audioBlob = await stopRecording();

      // Then: Blob type should match the recorder's mimeType
      expect(audioBlob.type).toBe("audio/webm;codecs=opus");
    });

    it("[P0] should ignore data events with size 0", async () => {
      // Given: recording started
      mockIsTypeSupported.mockReturnValue(false);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording, stopRecording } =
        await importRecorder();
      await initializeMicrophone();
      startRecording();

      // Simulate empty data event and one real event
      mockMediaRecorderInstance.ondataavailable?.({ data: new Blob([]) });
      mockMediaRecorderInstance.ondataavailable?.({
        data: new Blob(["real-data"]),
      });

      // When: stopping
      const audioBlob = await stopRecording();

      // Then: only the non-empty chunk should be included
      expect(audioBlob.size).toBe(new Blob(["real-data"]).size);
    });

    it("[P0] should reject when MediaRecorder fires onerror", async () => {
      // Given: recording started
      mockIsTypeSupported.mockReturnValue(false);
      const fakeStream = { id: "fake-stream" } as unknown as MediaStream;
      mockGetUserMedia.mockResolvedValue(fakeStream);

      const { initializeMicrophone, startRecording, stopRecording } =
        await importRecorder();
      await initializeMicrophone();
      startRecording();

      // Override stop to trigger onerror instead of onstop
      mockMediaRecorderInstance.stop.mockImplementation(() => {
        mockMediaRecorderInstance.state = "inactive";
        queueMicrotask(() => {
          mockMediaRecorderInstance.onerror?.();
        });
      });

      // When/Then: stopping should reject
      await expect(stopRecording()).rejects.toThrow(
        "MediaRecorder error during stop.",
      );
    });
  });
});
