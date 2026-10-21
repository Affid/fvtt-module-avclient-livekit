import {
  RnnoiseWorkletNode,
  loadRnnoise,
  SpeexWorkletNode,
  loadSpeex,
  GtcrnWorkletNode,
  loadGtcrn,
  NoiseGateWorkletNode,
} from "@sapphi-red/web-noise-suppressor";
import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
import { getModuleAssetRoute } from "./utils/helpers";
import { Logger } from "./utils/logger";

const log = new Logger("NoiseSuppressorFilter");

// The AudioContext sample rate used for the noise suppression processors.
// RNNoise requires 48kHz; the Speex and GTCRN worklets support 48kHz natively,
// so a single 48kHz context works for every model.
export const NOISE_SUPPRESSION_SAMPLE_RATE = 48000;

/**
 * The open-source noise suppression models that run entirely in the browser.
 */
export type NoiseSuppressorModel = "rnnoise" | "speex" | "gtcrn";

export const NOISE_SUPPRESSION_MODELS: readonly NoiseSuppressorModel[] = [
  "rnnoise",
  "speex",
  "gtcrn",
];

/**
 * Every selectable noise cancellation model: the open-source models plus
 * Krisp, which is provided by LiveKit Cloud (see KrispNoiseFilter).
 */
export type NoiseCancellationModel = NoiseSuppressorModel | "krisp";

/**
 * The model used when no valid model has been configured, and as the fallback
 * when Krisp isn't available.
 */
export const DEFAULT_NOISE_SUPPRESSION_MODEL: NoiseSuppressorModel = "gtcrn";

/**
 * A generic worklet node with a `destroy` method, shared by every model node
 * exposed by @sapphi-red/web-noise-suppressor.
 */
type NoiseWorkletNode =
  | RnnoiseWorkletNode
  | SpeexWorkletNode
  | GtcrnWorkletNode;

export interface NoiseSuppressorFilterOptions {
  /** The noise suppression model to run, or undefined to only gate. */
  model?: NoiseSuppressorModel;
  /**
   * When provided (in dB), a noise gate is chained before the model so quiet
   * background noise is silenced prior to denoising.
   */
  gateThreshold?: number;
}

/**
 * Whether the current browser supports the client-side noise suppression
 * filters.
 */
export function isNoiseSuppressionSupported(): boolean {
  return (
    typeof AudioWorkletNode !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof WebAssembly !== "undefined"
  );
}

/**
 * Normalize an arbitrary value into a valid noise cancellation model, falling
 * back to the default model when the value is unknown.
 */
export function toNoiseCancellationModel(
  value: unknown,
): NoiseCancellationModel {
  if (value === "krisp") {
    return value;
  }
  return NOISE_SUPPRESSION_MODELS.includes(value as NoiseSuppressorModel)
    ? (value as NoiseSuppressorModel)
    : DEFAULT_NOISE_SUPPRESSION_MODEL;
}

/**
 * Wait for a WASM binary to load and make sure it is actually WebAssembly. The
 * loaders don't check the HTTP status, and an invalid binary would otherwise
 * only fail inside the AudioWorklet, silently muting the microphone.
 */
async function loadWasm(
  name: string,
  binary: Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const wasmBinary = await binary;
  if (!WebAssembly.validate(wasmBinary)) {
    throw new Error(`Failed to load a valid WASM binary for ${name}`);
  }
  return wasmBinary;
}

/**
 * A self-contained LiveKit audio TrackProcessor that runs an open-source noise
 * suppression model (via @sapphi-red/web-noise-suppressor) and/or a noise gate
 * entirely in the browser using AudioWorklets. It requires no server-side
 * support, so it works with self-hosted LiveKit deployments.
 *
 * Three models are supported:
 * - `rnnoise`: RNNoise, a lightweight recurrent-neural-network denoiser.
 * - `speex`: the classic Speex DSP noise suppressor (lowest CPU cost).
 * - `gtcrn`: GTCRN, a stronger neural model (highest quality, highest cost).
 */
export class NoiseSuppressorFilter implements TrackProcessor<
  Track.Kind.Audio,
  AudioProcessorOptions
> {
  name: string;
  processedTrack?: MediaStreamTrack;

  private readonly model?: NoiseSuppressorModel;
  private readonly gateThreshold?: number;
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private gateNode?: NoiseGateWorkletNode;
  private workletNode?: NoiseWorkletNode;
  private destinationNode?: MediaStreamAudioDestinationNode;

  constructor({ model, gateThreshold }: NoiseSuppressorFilterOptions) {
    this.model = model;
    this.gateThreshold = gateThreshold;
    this.name = `noise-suppressor-${model ?? "none"}${
      typeof gateThreshold === "number" ? "-gate" : ""
    }`;
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    // Use the AudioContext provided by LiveKit. The caller is responsible for
    // ensuring it runs at 48kHz and for resuming it after a user gesture.
    this.audioContext = opts.audioContext;

    try {
      await this.buildGraph(this.audioContext, opts.track);
    } catch (error: unknown) {
      // Don't leave a half-built audio graph behind
      await this.destroy();
      throw error;
    }

    log.info(`Noise suppression filter initialized (${this.name})`);
  }

  private async buildGraph(
    audioContext: AudioContext,
    track: MediaStreamTrack,
  ): Promise<void> {
    // Load everything before touching the track so a failure leaves no
    // partially connected nodes
    if (this.model) {
      this.workletNode = await this.createWorkletNode(audioContext, this.model);
    }
    if (typeof this.gateThreshold === "number") {
      await audioContext.audioWorklet.addModule(
        getModuleAssetRoute("noise-suppressor/noiseGateWorklet.js"),
      );
      this.gateNode = new NoiseGateWorkletNode(audioContext, {
        openThreshold: this.gateThreshold,
        closeThreshold: this.gateThreshold - 5,
        holdMs: 90,
        maxChannels: 1,
      });
    }

    this.sourceNode = audioContext.createMediaStreamSource(
      new MediaStream([track]),
    );
    this.destinationNode = audioContext.createMediaStreamDestination();

    // source -> [gate] -> [model] -> destination
    let lastNode: AudioNode = this.sourceNode;
    for (const node of [this.gateNode, this.workletNode]) {
      if (node) {
        lastNode.connect(node);
        lastNode = node;
      }
    }
    lastNode.connect(this.destinationNode);

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  private async createWorkletNode(
    audioContext: AudioContext,
    model: NoiseSuppressorModel,
  ): Promise<NoiseWorkletNode> {
    switch (model) {
      case "speex": {
        const wasmBinary = await loadWasm(
          model,
          loadSpeex({ url: getModuleAssetRoute("speex/speex.wasm") }),
        );
        await audioContext.audioWorklet.addModule(
          getModuleAssetRoute("speex/speexWorklet.js"),
        );
        return new SpeexWorkletNode(audioContext, {
          wasmBinary,
          maxChannels: 1,
        });
      }
      case "gtcrn": {
        const wasmBinary = await loadWasm(
          model,
          loadGtcrn({ url: getModuleAssetRoute("gtcrn/gtcrn.wasm") }),
        );
        await audioContext.audioWorklet.addModule(
          getModuleAssetRoute("gtcrn/gtcrnWorklet.js"),
        );
        return new GtcrnWorkletNode(audioContext, {
          wasmBinary,
          maxChannels: 1,
        });
      }
      case "rnnoise": {
        const wasmBinary = await loadWasm(
          model,
          loadRnnoise({
            url: getModuleAssetRoute("rnnoise/rnnoise.wasm"),
            simdUrl: getModuleAssetRoute("rnnoise/rnnoise_simd.wasm"),
          }),
        );
        await audioContext.audioWorklet.addModule(
          getModuleAssetRoute("rnnoise/rnnoiseWorklet.js"),
        );
        return new RnnoiseWorkletNode(audioContext, {
          wasmBinary,
          maxChannels: 1,
        });
      }
    }
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    // LiveKit doesn't pass an AudioContext when restarting a processor (e.g.
    // after the input device changes), so keep using the current one. The
    // types claim it is always set, but it isn't on restart.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const audioContext = opts.audioContext ?? this.audioContext;
    await this.destroy();
    await this.init({ ...opts, audioContext });
  }

  destroy(): Promise<void> {
    try {
      this.sourceNode?.disconnect();
      this.gateNode?.disconnect();
      this.workletNode?.disconnect();
      this.workletNode?.destroy();
      this.destinationNode?.disconnect();
    } catch (error: unknown) {
      log.warn("Error while destroying noise suppression filter:", error);
    } finally {
      // Note: the AudioContext is owned by the caller (LiveKitClient) and is
      // intentionally not closed here so it can be reused across tracks.
      this.sourceNode = undefined;
      this.gateNode = undefined;
      this.workletNode = undefined;
      this.destinationNode = undefined;
      this.audioContext = undefined;
      this.processedTrack = undefined;
    }
    return Promise.resolve();
  }
}
