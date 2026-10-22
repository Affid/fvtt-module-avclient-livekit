import type { KrispNoiseFilterProcessor } from "@livekit/krisp-noise-filter";
import {
  ConnectionState,
  type AudioProcessorOptions,
  type Room,
  type Track,
  type TrackProcessor,
} from "livekit-client";
import type { VoiceGateOptions } from "./NoiseSuppressorFilter";
import { Logger } from "./utils/logger";
import VoiceActivityGate from "./VoiceActivityGate";

const log = new Logger("KrispNoiseFilter");

type KrispModule = typeof import("@livekit/krisp-noise-filter");

// ServerInfo_Edition.Cloud from @livekit/protocol, which livekit-client
// doesn't re-export
const LIVEKIT_CLOUD_EDITION = 1;

let krispModule: Promise<KrispModule> | undefined;

/**
 * Load the Krisp noise filter on demand. The package is large (about 6MB), so
 * it is split into its own chunk and only fetched when Krisp may be used. When
 * initialized, the filter itself downloads its models from LiveKit
 * (integrations.livekit.io).
 */
function loadKrispModule(): Promise<KrispModule> {
  krispModule ??= import("@livekit/krisp-noise-filter").catch(
    (error: unknown) => {
      // Allow a later retry, e.g. after a transient network error
      krispModule = undefined;
      throw error;
    },
  );
  return krispModule;
}

/**
 * Whether the Krisp noise filter can run in this browser. Older browsers (for
 * example older Safari versions) are not supported, and may not even be able
 * to load the filter.
 */
export async function isKrispSupported(): Promise<boolean> {
  try {
    const { isKrispNoiseFilterSupported } = await loadKrispModule();
    return isKrispNoiseFilterSupported();
  } catch (error: unknown) {
    log.warn("Unable to load the Krisp noise filter:", error);
    return false;
  }
}

/** The events Krisp sends on its output track to tell LiveKit its state */
const KRISP_EVENTS = [
  "enable-lk-krisp-noise-filter",
  "disable-lk-krisp-noise-filter",
];

/**
 * The parts of the Krisp processor LiveKit and LiveKitClient use, which the
 * wrapper below provides as well.
 */
export type KrispProcessor = Pick<
  KrispNoiseFilterProcessor,
  "onPublish" | "setEnabled" | "isEnabled"
> &
  TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
    gate?: VoiceActivityGate;
  };

/**
 * The Krisp processor, optionally followed by the voice activity gate.
 * Everything LiveKit calls on the processor is passed on to Krisp.
 *
 * Krisp turns itself off when it restarts (e.g. when the input device
 * changes) and would then send the audio unfiltered, so it is turned back on.
 *
 * Krisp only hands out its output as a track, so the gate takes that track as
 * its input. With the gate, Krisp's events on its output track are passed on
 * from ours, where LiveKit listens for them.
 */
class KrispTrackProcessor implements KrispProcessor {
  readonly name: string;
  gate?: VoiceActivityGate;

  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private destinationNode?: MediaStreamAudioDestinationNode;
  private krispTrack?: MediaStreamTrack;

  constructor(
    private readonly krisp: KrispNoiseFilterProcessor,
    private readonly gateOptions?: VoiceGateOptions,
  ) {
    this.name = `${krisp.name}${gateOptions ? "-gate" : ""}`;
  }

  get processedTrack(): MediaStreamTrack | undefined {
    return this.gateOptions
      ? this.destinationNode?.stream.getAudioTracks()[0]
      : this.krisp.processedTrack;
  }

  private readonly forwardEvent = (event: Event) => {
    this.processedTrack?.dispatchEvent(new Event(event.type));
  };

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.audioContext = opts.audioContext;
    try {
      await this.krisp.init(opts);
      if (this.gateOptions) {
        this.gate = await VoiceActivityGate.create(
          opts.audioContext,
          this.gateOptions,
        );
        this.destinationNode = opts.audioContext.createMediaStreamDestination();
        this.gate.node.connect(this.destinationNode);
        this.connectKrispOutput();
      }
    } catch (error: unknown) {
      await this.destroy();
      throw error;
    }
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    const wasEnabled = this.krisp.isEnabled();
    // Krisp makes a new output track when it restarts
    await this.krisp.restart(opts);
    if (this.gateOptions) {
      this.connectKrispOutput();
    }
    if (wasEnabled) {
      await this.krisp.setEnabled(true);
    }
  }

  /**
   * Feed Krisp's current output track into the gate.
   */
  private connectKrispOutput(): void {
    const krispTrack = this.krisp.processedTrack;
    if (!krispTrack || !this.audioContext || !this.gate) {
      throw new Error("The Krisp noise filter has no output");
    }
    for (const type of KRISP_EVENTS) {
      this.krispTrack?.removeEventListener(type, this.forwardEvent);
      krispTrack.addEventListener(type, this.forwardEvent);
    }
    this.krispTrack = krispTrack;
    this.sourceNode?.disconnect();
    this.sourceNode = this.audioContext.createMediaStreamSource(
      new MediaStream([krispTrack]),
    );
    this.sourceNode.connect(this.gate.node);
  }

  onPublish(room: Room): Promise<void> {
    return this.krisp.onPublish(room);
  }

  setEnabled(enable: boolean): Promise<boolean | undefined> {
    return this.krisp.setEnabled(enable);
  }

  isEnabled(): boolean {
    return this.krisp.isEnabled();
  }

  async destroy(): Promise<void> {
    for (const type of KRISP_EVENTS) {
      this.krispTrack?.removeEventListener(type, this.forwardEvent);
    }
    this.sourceNode?.disconnect();
    this.gate?.destroy();
    this.destinationNode?.disconnect();
    this.sourceNode = undefined;
    this.gate = undefined;
    this.destinationNode = undefined;
    this.krispTrack = undefined;
    await this.krisp.destroy();
  }
}

/**
 * Create a Krisp noise filter TrackProcessor, followed by a voice activity
 * gate if given.
 */
export async function createKrispNoiseFilter(
  gate?: VoiceGateOptions,
): Promise<KrispProcessor> {
  const { KrispNoiseFilter } = await loadKrispModule();
  return new KrispTrackProcessor(KrispNoiseFilter(), gate);
}

/**
 * Whether the room is connected to a LiveKit Cloud server. The Krisp filter
 * is licensed through LiveKit Cloud and does nothing on other servers.
 * @param {Room | null} room            The LiveKit room
 * @param {string} [serverAddress]      The server address the room connected to
 */
export function isLiveKitCloud(
  room: Room | null,
  serverAddress?: string,
): boolean {
  if (room?.state !== ConnectionState.Connected) {
    return false;
  }
  if (Number(room.serverInfo?.edition) === LIVEKIT_CLOUD_EDITION) {
    return true;
  }
  if (!serverAddress) {
    return false;
  }
  try {
    const { hostname } = new URL(`wss://${serverAddress}`);
    return (
      hostname.endsWith(".livekit.cloud") || hostname.endsWith(".livekit.run")
    );
  } catch {
    return false;
  }
}
