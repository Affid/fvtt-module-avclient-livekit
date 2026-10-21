import type LiveKitClient from "../LiveKitClient";
import { clamp, el } from "./dom";
import { localize } from "./controls";

// The input level range shown by the meter, in dBFS
const METER_MIN_DB = -80;
const METER_MAX_DB = 0;

/**
 * Discord's input sensitivity control: a live microphone level meter with a
 * draggable threshold marker. The level is green above the threshold (sent)
 * and yellow below it (silenced).
 */
export class InputLevelMeter {
  readonly element: HTMLElement;
  readonly slider: HTMLInputElement;
  private readonly fill = el("div", { className: "livekit-meter-fill" });
  private meter?: {
    track: MediaStreamTrack;
    source: MediaStreamAudioSourceNode;
    frame: number;
  };

  constructor({
    name,
    threshold,
    disabled = false,
    onInput,
    onChange,
  }: {
    name?: string;
    threshold: number;
    disabled?: boolean;
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
        value: threshold.toString(),
        "aria-label": localize("audioNoiseGateThreshold"),
        "aria-valuetext": `${threshold.toString()} dB`,
      },
    });
    if (name) {
      this.slider.name = name;
    }
    this.slider.disabled = disabled;
    this.slider.addEventListener("input", () => {
      this.slider.setAttribute("aria-valuetext", `${this.slider.value} dB`);
      onInput?.(Number(this.slider.value));
    });
    this.slider.addEventListener("change", () => {
      onChange?.(Number(this.slider.value));
    });
    this.element = el("div", {
      className: `livekit-meter ${disabled ? "disabled" : ""}`.trim(),
      children: [
        el("div", {
          className: "livekit-meter-track",
          attrs: { "aria-hidden": "true" },
          children: [this.fill],
        }),
        this.slider,
      ],
    });
  }

  /**
   * Show the level of the client's microphone. A clone of the track is
   * measured, so the level shows even while muted.
   */
  start(client: LiveKitClient): void {
    this.stop();
    const microphone = client.audioTrack?.mediaStreamTrack;
    if (!microphone || microphone.readyState === "ended") {
      return;
    }
    const track = microphone.clone();
    track.enabled = true;
    const context = client.getAudioProcessorContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      const db = clamp(
        20 * Math.log10(rms || 1e-8),
        METER_MIN_DB,
        METER_MAX_DB,
      );
      const percent =
        ((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
      this.fill.style.width = `${percent.toString()}%`;
      this.fill.classList.toggle("open", db >= Number(this.slider.value));
      if (this.meter) {
        this.meter.frame = requestAnimationFrame(update);
      }
    };
    this.meter = { track, source, frame: requestAnimationFrame(update) };
  }

  stop(): void {
    if (!this.meter) {
      return;
    }
    cancelAnimationFrame(this.meter.frame);
    this.meter.source.disconnect();
    this.meter.track.stop();
    this.meter = undefined;
  }
}
