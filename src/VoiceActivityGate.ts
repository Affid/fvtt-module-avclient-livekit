import { getModuleAssetRoute } from "./utils/helpers";

const WORKLET = "worklets/voice-activity-gate.js";
const PROCESSOR = "livekit-voice-activity-gate";

/**
 * How the gate decides when to send audio: with `auto`, the threshold follows
 * the background noise; otherwise `threshold` (in dBFS) is used.
 */
export interface VoiceGateSettings {
  auto: boolean;
  threshold: number;
}

/**
 * The gate's state, reported about every 16 ms: the input level and the
 * threshold in use (in dBFS), and whether audio is being sent.
 */
export interface VoiceGateReport {
  db: number;
  open: boolean;
  threshold: number;
}

/**
 * The voice activity gate could not be started, e.g. its worklet failed to
 * load.
 */
export class VoiceGateError extends Error {
  constructor(cause: unknown) {
    super("The voice activity gate could not be started", { cause });
    this.name = "VoiceGateError";
  }
}

/**
 * A Discord-style voice activity gate running in an AudioWorklet (see
 * public/worklets/voice-activity-gate.js). It silences the microphone while
 * the level is below the threshold. Its settings can be changed while it
 * runs.
 *
 * An analysis-only gate has no output and only reports, e.g. to show the
 * input level while the microphone's own gate isn't running.
 */
export default class VoiceActivityGate {
  /** Every running gate, so that setting changes reach all of them */
  static readonly instances = new Set<VoiceActivityGate>();

  /** The latest report */
  report?: VoiceGateReport;

  private constructor(
    readonly node: AudioWorkletNode,
    private readonly onReport?: (report: VoiceGateReport) => void,
  ) {
    node.port.onmessage = (event: MessageEvent<VoiceGateReport>) => {
      this.report = event.data;
      this.onReport?.(event.data);
    };
    VoiceActivityGate.instances.add(this);
  }

  static async create(
    context: AudioContext,
    {
      settings,
      onReport,
      analysisOnly = false,
    }: {
      settings: VoiceGateSettings;
      onReport?: (report: VoiceGateReport) => void;
      analysisOnly?: boolean;
    },
  ): Promise<VoiceActivityGate> {
    try {
      await context.audioWorklet.addModule(getModuleAssetRoute(WORKLET));
      // A node without outputs is still processed
      const node = new AudioWorkletNode(context, PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: analysisOnly ? 0 : 1,
        processorOptions: settings,
      });
      return new VoiceActivityGate(node, onReport);
    } catch (error: unknown) {
      throw new VoiceGateError(error);
    }
  }

  get isOpen(): boolean {
    return this.report?.open ?? false;
  }

  configure(settings: VoiceGateSettings): void {
    this.node.port.postMessage(settings);
  }

  destroy(): void {
    VoiceActivityGate.instances.delete(this);
    this.node.port.onmessage = null;
    this.node.port.close();
    this.node.disconnect();
  }
}
