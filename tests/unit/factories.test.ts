import { describe, it, expect } from "vitest";
import {
  createTranscriptionRecord,
  createVocabularyEntry,
} from "../support/factories";

describe("Data Factories", () => {
  it("[P1] createTranscriptionRecord generates valid record", () => {
    // When: creating a transcription record with defaults
    const record = createTranscriptionRecord();

    // Then: required fields should be present
    expect(record.id).toBeDefined();
    expect(record.rawText).toBeDefined();
    expect(record.recordingDurationMs).toBeGreaterThan(0);
    expect(record.transcriptionDurationMs).toBeGreaterThan(0);
    expect(["hold", "toggle"]).toContain(record.triggerMode);
  });

  it("[P1] createTranscriptionRecord accepts overrides", () => {
    // Given: specific override values
    const overrides = {
      rawText: "custom text",
      triggerMode: "hold" as const,
      wasEnhanced: true,
    };

    // When: creating with overrides
    const record = createTranscriptionRecord(overrides);

    // Then: overrides should be applied
    expect(record.rawText).toBe("custom text");
    expect(record.triggerMode).toBe("hold");
    expect(record.wasEnhanced).toBe(true);
    expect(record.processedText).toBeDefined();
  });

  it("[P1] createVocabularyEntry generates valid entry", () => {
    // When: creating a vocabulary entry with defaults
    const entry = createVocabularyEntry();

    // Then: required fields should be present
    expect(entry.id).toBeDefined();
    expect(entry.term).toBeDefined();
    expect(entry.createdAt).toBeDefined();
  });

  it("[P1] createVocabularyEntry accepts overrides", () => {
    // When: creating with a custom term
    const entry = createVocabularyEntry({ term: "Whisper" });

    // Then: override should be applied
    expect(entry.term).toBe("Whisper");
  });
});
