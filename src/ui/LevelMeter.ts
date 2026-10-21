import type LiveKitClient from "../LiveKitClient";
import { Logger } from "../utils/logger";
import VoiceActivityGate, {
  type VoiceGateReport,
  type VoiceGateSettings,
} from "../VoiceActivityGate";
import { clamp, el } from "./dom";
import { localize } from "./controls";

const log = new Logger("LevelMeter");

// The input level range shown by the meter, in dBFS
const METER_MIN_DB = -80;
const METER_MAX_DB = 0;

/**
 * Discord's input sensitivity control: the microphone level as the voice
 * activity gate measures it, green while the gate sends audio. With a manual
 * threshold, a marker on the meter sets it; with automatic sensitivity there
 * is no marker.
 *
 * The meter follows the microphone's own gate while it runs. Otherwise (the
 * microphone is muted, or Voice Activity isn't the saved input mode yet) a
 * gate that only measures runs on a copy of the microphone.
 */
export class InputLevelMeter {
  readonly element: HTMLElement;
  readonly slider: HTMLInputElement;
  private readonly fill = el("div", { className: "livekit-meter-fill" });
  private stopMetering?: () => void;

  constructor({
    name,
    settings,
    onInput,
    onChange,
  }: {
    name?: string;
    settings: VoiceGateSettings;
    onInput?: (threshold: number) => void;
    onChange?: (threshold: number) => void;
  }) {
    this.slider = el("input", {
      className: "livekit-meter-threshold",
      attrs: {
        type: "range",
        min: METER_MIN_DB.toString(),
        max: METER_MAX_DB.toString(),
        step: "1",
        value: settings.threshold.toString(),
        "aria-label": localize("audioNoiseGateThreshold"),
        "aria-valuetext": `${settings.threshold.toString()} dB`,
      },
    });
    if (name) {
      this.slider.name = name;
    }
    this.slider.addEventListener("input", () => {
      this.slider.setAttribute("aria-valuetext", `${this.slider.value} dB`);
      onInput?.(Number(this.slider.value));
    });
    this.slider.addEventListener("change", () => {
      onChange?.(Number(this.slider.value));
    });
    this.element = el("div", {
      className: "livekit-meter",
      children: [
        el("div", {
          className: "livekit-meter-track",
          attrs: { "aria-hidden": "true" },
          children: [this.fill],
        }),
        this.slider,
      ],
    });
    this.setAuto(settings.auto);
  }

  /**
   * Show or hide the threshold marker. Its value is still submitted with a
   * form while hidden.
   */
  setAuto(auto: boolean): void {
    this.element.classList.toggle("is-auto", auto);
    this.slider.tabIndex = auto ? -1 : 0;
    this.slider.setAttribute("aria-hidden", String(auto));
  }

  /**
   * Start showing the microphone level.
   */
  start(client: LiveKitClient): void {
    this.stop();
    const microphone = client.audioTrack;
    if (client.voiceGate && microphone && !microphone.isMuted) {
      this.stopMetering = client.onVoiceGateReports((report) => {
        this.show(report);
      });
      return;
    }
    // The microphone itself: with a processor, LiveKit's mediaStreamTrack is
    // the processor's output, which is silent while muted
    const track =
      microphone?.mediaStream?.getAudioTracks()[0] ??
      microphone?.mediaStreamTrack;
    if (track && track.readyState !== "ended") {
      void this.startAnalysis(client, track);
    }
  }

  stop(): void {
    this.stopMetering?.();
    this.stopMetering = undefined;
    this.show(undefined);
  }

  /**
   * Measure a copy of the microphone with a gate of our own. A copy, so it
   * can be measured while the microphone is muted.
   */
  private async startAnalysis(
    client: LiveKitClient,
    microphone: MediaStreamTrack,
  ): Promise<void> {
    const state = { stopped: false };
    let stopAnalysis = () => {
      state.stopped = true;
    };
    this.stopMetering = () => {
      stopAnalysis();
    };

    const track = microphone.clone();
    track.enabled = true;
    const context = client.getAudioProcessorContext();
    try {
      const gate = await VoiceActivityGate.create(context, {
        settings: client.getVoiceGateSettings(),
        onReport: (report) => {
          this.show(report);
        },
        analysisOnly: true,
      });
      const source = context.createMediaStreamSource(new MediaStream([track]));
      source.connect(gate.node);
      stopAnalysis = () => {
        source.disconnect();
        gate.destroy();
        track.stop();
      };
      if (state.stopped) {
        stopAnalysis();
      }
    } catch (error: unknown) {
      track.stop();
      log.warn("Unable to measure the microphone level:", error);
    }
  }

  private show(report?: VoiceGateReport): void {
    const db = clamp(report?.db ?? METER_MIN_DB, METER_MIN_DB, METER_MAX_DB);
    const percent = ((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
    this.fill.style.width = `${percent.toString()}%`;
    this.fill.classList.toggle("open", report?.open ?? false);
  }
}
