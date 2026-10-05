export interface SignalCleanupStatus {
  readonly clean: boolean;
  readonly reliable: boolean;
  readonly isolationSecure: boolean;
  readonly humDetected: boolean;
  readonly humFrequency: 50 | 60 | null;
  readonly humLevelDbfs: number | null;
  readonly noiseFloorDbfs: number | null;
  readonly ingressNoiseFloorDbfs: number | null;
  readonly peakDbfs: number | null;
  readonly auditedAt: number | null;
  readonly reason: string;
}

export interface SignalFrame {
  samples: Float32Array;
  spectrum: Float32Array;
  sampleRate: number;
}

export function inspectSignalFrame(frame: SignalFrame): {
  rmsDbfs: number;
  peakDbfs: number;
  noiseFloorDbfs: number;
  humDetected: boolean;
  humFrequency: 50 | 60 | null;
  humLevelDbfs: number;
};

export class SignalCleanupPipeline {
  constructor(context: AudioContext, options: {
    routingGuard: {
      connectLive(input: AudioNode, output: AudioNode): unknown;
      connectUtility(node: AudioNode): unknown;
      tap(input: AudioNode, analyser: AudioNode): unknown;
      assertNoUtilityLeak(): { ok: boolean };
      release(node: AudioNode): void;
    };
    assertIsolation: () => boolean;
    recorderAnalysers: AnalyserNode[];
  });
  connectSignalChain(inputNode: AudioNode, outputNode: AudioNode): void;
  auditSignal(): SignalCleanupStatus;
  getStatus(): SignalCleanupStatus;
  destroy(): void;
}
