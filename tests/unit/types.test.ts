import { describe, it, expect } from "vitest";
import type { HudStatus, HudState, TranscriptionResult } from "@/types";

describe("Type Definitions", () => {
  it("[P0] HudStatus accepts valid statuses", () => {
    // Given: all valid HUD statuses
    const validStatuses: HudStatus[] = [
      "idle",
      "recording",
      "transcribing",
      "success",
      "error",
    ];

    // Then: all statuses should be string values
    validStatuses.forEach((status) => {
      expect(typeof status).toBe("string");
    });
  });

  it("[P1] HudState has correct structure", () => {
    // Given: a valid HUD state
    const state: HudState = {
      status: "recording",
      message: "Recording...",
    };

    // Then: properties should be correctly typed
    expect(state.status).toBe("recording");
    expect(state.message).toBe("Recording...");
  });

  it("[P1] TranscriptionResult has correct structure", () => {
    // Given: a transcription result
    const result: TranscriptionResult = {
      text: "Hello world",
      duration: 1500,
    };

    // Then: properties should be correctly typed
    expect(result.text).toBe("Hello world");
    expect(result.duration).toBe(1500);
  });
});
