export interface WaveformPayload {
  levels: number[];
}

export interface StopRecordingResult {
  recordingDurationMs: number;
}

export interface TranscriptionResult {
  rawText: string;
  transcriptionDurationMs: number;
  noSpeechProbability: number;
}
