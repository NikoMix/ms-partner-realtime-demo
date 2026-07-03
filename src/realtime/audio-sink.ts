export interface RealtimeAudioSink {
  enqueue(base64Pcm16: string): void
  clear(): void
}
