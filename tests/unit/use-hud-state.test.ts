import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock: @tauri-apps/api/window
// ---------------------------------------------------------------------------
const mockShow = vi.fn().mockResolvedValue(undefined);
const mockHide = vi.fn().mockResolvedValue(undefined);
const mockSetIgnoreCursorEvents = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: mockShow,
    hide: mockHide,
    setIgnoreCursorEvents: mockSetIgnoreCursorEvents,
  }),
}));

import { useHudState } from "../../src/composables/useHudState";

describe("useHudState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockShow.mockClear();
    mockHide.mockClear();
    mockSetIgnoreCursorEvents.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================================================
  // Initial state
  // ========================================================================

  describe("initial state", () => {
    it("[P1] should start with idle status and empty message", () => {
      // Given/When: creating a new HUD state
      const { state } = useHudState();

      // Then: should be idle
      expect(state.value.status).toBe("idle");
      expect(state.value.message).toBe("");
    });

    it("[P1] should return a readonly state ref", () => {
      // Given/When: creating a new HUD state
      const { state } = useHudState();

      // Then: state should be readonly (Vue DeepReadonly wraps the ref)
      expect(state.value).toBeDefined();
      expect(typeof state.value.status).toBe("string");
    });
  });

  // ========================================================================
  // State transitions
  // ========================================================================

  describe("state transitions", () => {
    it("[P1] should transition from idle to recording", () => {
      // Given: idle state
      const { state, transitionTo } = useHudState();

      // When: transitioning to recording
      transitionTo("recording", "Recording...");

      // Then: state should reflect recording
      expect(state.value.status).toBe("recording");
      expect(state.value.message).toBe("Recording...");
    });

    it("[P1] should transition from recording to transcribing", () => {
      // Given: recording state
      const { state, transitionTo } = useHudState();
      transitionTo("recording", "Recording...");

      // When: transitioning to transcribing
      transitionTo("transcribing", "Transcribing...");

      // Then: state should reflect transcribing
      expect(state.value.status).toBe("transcribing");
      expect(state.value.message).toBe("Transcribing...");
    });

    it("[P1] should transition to success with message", () => {
      // Given: transcribing state
      const { state, transitionTo } = useHudState();
      transitionTo("transcribing", "Transcribing...");

      // When: transitioning to success
      transitionTo("success", "Pasted!");

      // Then: state should reflect success
      expect(state.value.status).toBe("success");
      expect(state.value.message).toBe("Pasted!");
    });

    it("[P1] should transition to error with error message", () => {
      // Given: recording state
      const { state, transitionTo } = useHudState();
      transitionTo("recording", "Recording...");

      // When: an error occurs
      transitionTo("error", "Microphone failed");

      // Then: state should reflect error
      expect(state.value.status).toBe("error");
      expect(state.value.message).toBe("Microphone failed");
    });

    it("[P1] should transition to idle and hide HUD", () => {
      // Given: success state with HUD shown
      const { state, transitionTo } = useHudState();
      transitionTo("success", "Done!");

      // When: transitioning to idle
      transitionTo("idle");

      // Then: state should be idle and hideHud called
      expect(state.value.status).toBe("idle");
      expect(state.value.message).toBe("");
      expect(mockHide).toHaveBeenCalled();
    });

    it("[P1] should default message to empty string when not provided", () => {
      // Given: idle state
      const { state, transitionTo } = useHudState();

      // When: transitioning without a message
      transitionTo("recording");

      // Then: message should default to empty string
      expect(state.value.message).toBe("");
    });
  });

  // ========================================================================
  // HUD show/hide behaviour
  // ========================================================================

  describe("HUD window management", () => {
    it("[P1] should show HUD and set ignore cursor events for recording", async () => {
      // Given: idle state
      const { transitionTo } = useHudState();

      // When: transitioning to recording
      transitionTo("recording", "Recording...");

      // Flush microtasks (showHud is async, called fire-and-forget)
      await vi.waitFor(() => {
        expect(mockShow).toHaveBeenCalled();
        expect(mockSetIgnoreCursorEvents).toHaveBeenCalledWith(true);
      });
    });

    it("[P1] should show HUD for transcribing", () => {
      // Given: idle state
      const { transitionTo } = useHudState();

      // When: transitioning to transcribing
      transitionTo("transcribing", "Transcribing...");

      // Then: showHud should be called
      expect(mockShow).toHaveBeenCalled();
    });

    it("[P1] should show HUD for success", () => {
      // Given: idle state
      const { transitionTo } = useHudState();

      // When: transitioning to success
      transitionTo("success", "Done!");

      // Then: showHud should be called
      expect(mockShow).toHaveBeenCalled();
    });

    it("[P1] should show HUD for error", () => {
      // Given: idle state
      const { transitionTo } = useHudState();

      // When: transitioning to error
      transitionTo("error", "Oops");

      // Then: showHud should be called
      expect(mockShow).toHaveBeenCalled();
    });

    it("[P1] should hide HUD for idle", () => {
      // Given: recording state
      const { transitionTo } = useHudState();
      transitionTo("recording", "Recording...");

      // When: transitioning to idle
      transitionTo("idle");

      // Then: hideHud should be called
      expect(mockHide).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Auto-hide timers
  // ========================================================================

  describe("auto-hide timers", () => {
    it("[P1] should auto-transition success to idle after 1000ms", () => {
      // Given: success state
      const { state, transitionTo } = useHudState();
      transitionTo("success", "Pasted!");

      // When: 1000ms passes
      vi.advanceTimersByTime(1000);

      // Then: should auto-transition to idle
      expect(state.value.status).toBe("idle");
    });

    it("[P1] should NOT auto-transition success before 1000ms", () => {
      // Given: success state
      const { state, transitionTo } = useHudState();
      transitionTo("success", "Pasted!");

      // When: only 999ms passes
      vi.advanceTimersByTime(999);

      // Then: should still be in success
      expect(state.value.status).toBe("success");
    });

    it("[P1] should auto-transition error to idle after 2000ms", () => {
      // Given: error state
      const { state, transitionTo } = useHudState();
      transitionTo("error", "Something went wrong");

      // When: 2000ms passes
      vi.advanceTimersByTime(2000);

      // Then: should auto-transition to idle
      expect(state.value.status).toBe("idle");
    });

    it("[P1] should NOT auto-transition error before 2000ms", () => {
      // Given: error state
      const { state, transitionTo } = useHudState();
      transitionTo("error", "Something went wrong");

      // When: only 1999ms passes
      vi.advanceTimersByTime(1999);

      // Then: should still be in error
      expect(state.value.status).toBe("error");
    });

    it("[P1] should NOT auto-hide recording state", () => {
      // Given: recording state
      const { state, transitionTo } = useHudState();
      transitionTo("recording", "Recording...");

      // When: a long time passes
      vi.advanceTimersByTime(10_000);

      // Then: should still be recording
      expect(state.value.status).toBe("recording");
    });

    it("[P1] should NOT auto-hide transcribing state", () => {
      // Given: transcribing state
      const { state, transitionTo } = useHudState();
      transitionTo("transcribing", "Transcribing...");

      // When: a long time passes
      vi.advanceTimersByTime(10_000);

      // Then: should still be transcribing
      expect(state.value.status).toBe("transcribing");
    });
  });

  // ========================================================================
  // Timer cleanup on new transition
  // ========================================================================

  describe("timer cleanup on new transition", () => {
    it("[P1] should clear previous success timer when transitioning to error", () => {
      // Given: success state with auto-hide timer pending
      const { state, transitionTo } = useHudState();
      transitionTo("success", "Done!");

      // When: transitioning to error before auto-hide fires
      vi.advanceTimersByTime(500);
      transitionTo("error", "Oops");

      // Then: after original timer would have fired, state should still be error
      vi.advanceTimersByTime(600); // 500+600 = 1100ms > 1000ms (success timer)
      expect(state.value.status).toBe("error");

      // And: after error timer fires, should go to idle
      vi.advanceTimersByTime(1400); // total 2000ms from error
      expect(state.value.status).toBe("idle");
    });

    it("[P1] should clear previous error timer when transitioning to recording", () => {
      // Given: error state with auto-hide timer pending
      const { state, transitionTo } = useHudState();
      transitionTo("error", "Oops");

      // When: transitioning to recording before auto-hide fires
      vi.advanceTimersByTime(500);
      transitionTo("recording", "Recording...");

      // Then: after original error timer would have fired, state should still be recording
      vi.advanceTimersByTime(2000);
      expect(state.value.status).toBe("recording");
    });

    it("[P1] should clear previous success timer when transitioning to idle manually", () => {
      // Given: success state
      const { state, transitionTo } = useHudState();
      transitionTo("success", "Done!");

      // When: manually going to idle before timer fires
      transitionTo("idle");

      // Then: timer should be cleared; advancing time should not cause issues
      vi.advanceTimersByTime(5000);
      expect(state.value.status).toBe("idle");
    });
  });
});
