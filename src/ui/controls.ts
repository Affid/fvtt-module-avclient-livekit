/**
 * Discord-style form controls shared by the voice settings popover and the
 * A/V settings window, so both look and behave the same.
 *
 * Controls can either apply a change immediately (`onChange`) or be part of a
 * form (`name`), in which case the form collects their value on submit.
 */
import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME } from "../utils/constants";
import { clamp, el } from "./dom";

export const localize = (key: string): string =>
  game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * A labelled setting row: a label and optional hint, with a control either
 * below them or, for `inline` rows, on the right.
 */
export function settingRow({
  label,
  hint,
  control,
  inline = false,
}: {
  label: string;
  hint?: string | Node;
  control: Node;
  inline?: boolean;
}): HTMLElement {
  return el("div", {
    className: `livekit-setting ${inline ? "inline" : ""}`.trim(),
    children: [
      el("div", {
        className: "livekit-setting-text",
        children: [
          el("span", { className: "livekit-setting-label", text: label }),
          hint &&
            el("p", {
              className: "livekit-setting-hint",
              children: [hint],
            }),
        ],
      }),
      control,
    ],
  });
}

/**
 * A select menu. With `dtype: "Number"`, Foundry's form handling submits the
 * value as a number.
 */
export function selectInput({
  name,
  label,
  options,
  value,
  dtype,
  disabled = false,
  onChange,
}: {
  name?: string;
  label: string;
  options: Option[];
  value: string;
  dtype?: "Number";
  disabled?: boolean;
  onChange?: (value: string) => void;
}): HTMLSelectElement {
  const select = el("select", {
    className: "livekit-select",
    attrs: { "aria-label": label },
    children: options.map((option) => {
      const element = el("option", {
        text: option.label,
        attrs: { value: option.value },
      });
      element.selected = option.value === value;
      element.disabled = !!option.disabled && option.value !== value;
      return element;
    }),
  });
  if (name) {
    select.name = name;
  }
  if (dtype) {
    select.dataset.dtype = dtype;
  }
  select.disabled = disabled;
  if (onChange) {
    select.addEventListener("change", () => {
      onChange(select.value);
    });
  }
  return select;
}

/**
 * A labelled on/off switch, with an optional hint below the label.
 */
export function switchInput({
  name,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  name?: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}): HTMLElement {
  const input = el("input", { attrs: { type: "checkbox", role: "switch" } });
  if (name) {
    input.name = name;
  }
  input.checked = checked;
  input.disabled = disabled;
  if (onChange) {
    input.addEventListener("change", () => {
      onChange(input.checked);
    });
  }
  return el("label", {
    className: `livekit-switch ${disabled ? "disabled" : ""}`.trim(),
    children: [
      el("span", {
        className: "livekit-setting-text",
        children: [
          el("span", { className: "livekit-setting-label", text: label }),
          hint && el("span", { className: "livekit-setting-hint", text: hint }),
        ],
      }),
      input,
      el("span", { className: "livekit-switch-track" }),
    ],
  });
}

/**
 * A group of radio buttons styled as rows.
 */
export function radioGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: Option[];
  onChange?: (value: string) => void;
}): HTMLElement {
  return el("div", {
    className: "livekit-radio-group",
    attrs: { role: "radiogroup" },
    children: options.map((option) => {
      const input = el("input", {
        attrs: { type: "radio", name, value: option.value },
      });
      input.checked = option.value === value;
      input.disabled = !!option.disabled;
      if (onChange) {
        input.addEventListener("change", () => {
          onChange(option.value);
        });
      }
      return el("label", {
        className: "livekit-radio",
        children: [input, el("span", { text: option.label })],
      });
    }),
  });
}

/* -------------------------------------------- */
/*  Push to talk                                */
/* -------------------------------------------- */

export interface KeyBinding {
  key: string;
  modifiers?: string[];
}

interface Keybindings {
  actions: Map<string, unknown>;
  get(namespace: string, action: string): KeyBinding[];
  set(namespace: string, action: string, bindings: KeyBinding[]): Promise<void>;
}

function getKeybindings(): Keybindings | undefined {
  const keybindings = game.keybindings as unknown as Keybindings | undefined;
  return keybindings?.actions.has("core.pushToTalk") ? keybindings : undefined;
}

/**
 * The push to talk key bindings, or undefined if Foundry has no push to talk
 * key binding.
 */
export function getPushToTalkBindings(): KeyBinding[] | undefined {
  return getKeybindings()?.get("core", "pushToTalk");
}

export function setPushToTalkKey(code: string): Promise<void> {
  return (
    getKeybindings()?.set("core", "pushToTalk", [
      { key: code, modifiers: [] },
    ]) ?? Promise.resolve()
  );
}

/**
 * A readable name for a KeyboardEvent.code, using Foundry's helper when
 * available.
 */
export function keyDisplayName(code: string): string {
  const keyboardManager = (
    foundry as unknown as {
      helpers?: {
        interaction?: {
          KeyboardManager?: {
            getKeycodeDisplayString?: (code: string) => string;
          };
        };
      };
    }
  ).helpers?.interaction?.KeyboardManager;
  return (
    keyboardManager?.getKeycodeDisplayString?.(code) ??
    code.replace(/^(Key|Digit)/, "")
  );
}

function describeBindings(bindings: KeyBinding[]): string {
  return (
    bindings
      .map((binding) =>
        [...(binding.modifiers ?? []), keyDisplayName(binding.key)].join(" + "),
      )
      .join(", ") || localize("pushToTalkUnbound")
  );
}

/**
 * A button showing the push to talk shortcut. Clicking it records the next
 * key press (Escape cancels) and passes its code to `onRecord`.
 */
export function keybindRecorder(
  bindings: KeyBinding[],
  onRecord: (code: string) => void,
): HTMLButtonElement {
  const button = el("button", {
    className: "livekit-keybind",
    text: describeBindings(bindings),
    attrs: { type: "button" },
  });
  button.addEventListener("click", () => {
    button.textContent = localize("pushToTalkRecord");
    button.classList.add("recording");
    const stop = () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      button.removeEventListener("blur", onBlur);
      button.classList.remove("recording");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      stop();
      if (event.code === "Escape") {
        button.textContent = describeBindings(bindings);
        return;
      }
      button.textContent = describeBindings([{ key: event.code }]);
      onRecord(event.code);
    };
    const onBlur = () => {
      stop();
      button.textContent = describeBindings(bindings);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    button.addEventListener("blur", onBlur);
  });
  return button;
}

/* -------------------------------------------- */
/*  Input level meter                           */
/* -------------------------------------------- */

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
      },
    });
    if (name) {
      this.slider.name = name;
    }
    this.slider.disabled = disabled;
    this.slider.addEventListener("input", () => {
      onInput?.(Number(this.slider.value));
    });
    this.slider.addEventListener("change", () => {
      onChange?.(Number(this.slider.value));
    });
    this.element = el("div", {
      className: `livekit-meter ${disabled ? "disabled" : ""}`.trim(),
      children: [
        el("div", { className: "livekit-meter-track", children: [this.fill] }),
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
