import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME, MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import { Popover, clamp, el } from "./dom";

const log = new Logger("AudioSettingsPopover");

// The input level range shown by the sensitivity meter, in dBFS
const METER_MIN_DB = -80;
const METER_MAX_DB = 0;

interface KeyBinding {
  key: string;
  modifiers?: string[];
}

interface Keybindings {
  actions: Map<string, unknown>;
  get(namespace: string, action: string): KeyBinding[];
  set(namespace: string, action: string, bindings: KeyBinding[]): Promise<void>;
}

const localize = (key: string) =>
  game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;

/**
 * A Discord-style voice settings popover: input/output devices, input mode
 * (voice activity or push to talk), input sensitivity with a live level
 * meter, and noise suppression.
 */
export default class AudioSettingsPopover {
  private readonly popover = new Popover("livekit-audio-settings", () => {
    this.stopMeter();
  });
  private meter?: {
    track: MediaStreamTrack;
    source: MediaStreamAudioSourceNode;
    analyser: AnalyserNode;
    frame: number;
  };
  private meterFill?: HTMLElement;
  private meterThreshold = METER_MIN_DB;
  private stopRecordingKey?: () => void;

  constructor(private readonly client: LiveKitClient) {}

  get isOpen(): boolean {
    return this.popover.isOpen;
  }

  toggle(anchor: HTMLElement): void {
    if (this.popover.isOpen) {
      this.popover.close();
    } else {
      void this.open(anchor);
    }
  }

  async open(anchor: HTMLElement): Promise<void> {
    await this.render();
    this.popover.openAt(anchor);
    this.startMeter();
  }

  close(): void {
    this.popover.close();
  }

  /**
   * Rebuild the content, e.g. after a setting changed elsewhere.
   */
  async render(): Promise<void> {
    this.stopRecordingKey?.();
    const sections = await Promise.all([
      this.renderDevices(),
      Promise.resolve(this.renderInputMode()),
      Promise.resolve(this.renderSensitivity()),
      Promise.resolve(this.renderNoiseSuppression()),
    ]);

    const advanced = el("button", {
      className: "livekit-link-button",
      text: localize("advancedSettings"),
      attrs: { type: "button" },
    });
    advanced.addEventListener("click", () => {
      this.close();
      this.client.avMaster.config
        .render({ force: true })
        .catch((error: unknown) => {
          log.error("Error opening the A/V settings:", error);
        });
    });

    this.popover.element.replaceChildren(
      el("h3", {
        className: "livekit-popover-title",
        text: localize("voiceSettings"),
      }),
      ...sections,
      el("footer", {
        className: "livekit-popover-footer",
        children: [advanced],
      }),
    );
    this.popover.reposition();
  }

  private section(title: string, ...children: (Node | false)[]): HTMLElement {
    return el("section", {
      className: "livekit-settings-section",
      children: [el("h4", { text: title }), ...children],
    });
  }

  private async renderDevices(): Promise<HTMLElement> {
    const avClient = this.client.liveKitAvClient;
    const [sources, sinks] = await Promise.all([
      avClient.getAudioSources(),
      avClient.getAudioSinks(),
    ]);
    const canPickOutput = "setSinkId" in HTMLMediaElement.prototype;

    const deviceSelect = (
      setting: "audioSrc" | "audioSink",
      devices: Record<string, string>,
    ) => {
      const current = this.client.settings.client[setting];
      const options = { ...devices };
      if (current && !(current in options)) {
        options[current] =
          current === "disabled" ? localize("deviceDisabled") : current;
      }
      const select = el("select", {
        className: "livekit-select",
        attrs: { "aria-label": localize(setting) },
        children: Object.entries(options).map(([id, label]) => {
          const option = el("option", { text: label, attrs: { value: id } });
          option.selected = id === current;
          return option;
        }),
      });
      select.addEventListener("change", () => {
        this.client.settings.set("client", setting, select.value);
        if (setting === "audioSink") {
          this.client.userAudioMixer.applyAll();
        }
      });
      return el("label", {
        className: "livekit-field",
        children: [el("span", { text: localize(setting) }), select],
      });
    };

    return this.section(
      localize("devices"),
      deviceSelect("audioSrc", sources),
      canPickOutput && deviceSelect("audioSink", sinks),
    );
  }

  private renderInputMode(): HTMLElement {
    const mode = this.client.settings.get("client", "voice.mode");
    const radio = (value: "always" | "ptt", label: string) => {
      const input = el("input", {
        attrs: { type: "radio", name: "livekit-voice-mode", value },
      });
      input.checked = mode === value;
      input.addEventListener("change", () => {
        this.client.settings.set("client", "voice.mode", value);
        void this.render();
      });
      return el("label", {
        className: "livekit-radio",
        children: [input, el("span", { text: label })],
      });
    };

    return this.section(
      localize("inputMode"),
      radio("always", localize("inputModeVoiceActivity")),
      radio("ptt", localize("inputModePushToTalk")),
      mode === "ptt" && this.renderPushToTalkKey(),
    );
  }

  private renderPushToTalkKey(): HTMLElement | false {
    const keybindings = game.keybindings as unknown as Keybindings | undefined;
    if (!keybindings?.actions.has("core.pushToTalk")) {
      return false;
    }
    const bindings = keybindings.get("core", "pushToTalk");
    const shortcut =
      bindings
        .map((binding) =>
          [...(binding.modifiers ?? []), keyDisplayName(binding.key)].join(
            " + ",
          ),
        )
        .join(", ") || localize("pushToTalkUnbound");

    const button = el("button", {
      className: "livekit-keybind",
      text: shortcut,
      attrs: { type: "button" },
    });
    button.addEventListener("click", () => {
      button.textContent = localize("pushToTalkRecord");
      button.classList.add("recording");
      const onKeyDown = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        this.stopRecordingKey?.();
        if (event.code === "Escape") {
          void this.render();
          return;
        }
        keybindings
          .set("core", "pushToTalk", [{ key: event.code, modifiers: [] }])
          .then(() => this.render())
          .catch((error: unknown) => {
            log.error("Error setting the push to talk key:", error);
          });
      };
      window.addEventListener("keydown", onKeyDown, { capture: true });
      this.stopRecordingKey = () => {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
        this.stopRecordingKey = undefined;
      };
    });

    return el("div", {
      className: "livekit-field livekit-field-inline",
      children: [el("span", { text: localize("pushToTalkKey") }), button],
    });
  }

  private renderSensitivity(): HTMLElement {
    const krispActive =
      this.client.getAudioProcessingConfig().model === "krisp";
    const enabled = game.settings?.get(MODULE_NAME, "audioNoiseGate") ?? false;
    this.meterThreshold =
      game.settings?.get(MODULE_NAME, "audioNoiseGateThreshold") ?? -50;

    const toggle = switchControl(
      localize("inputSensitivityEnable"),
      enabled,
      krispActive,
      (checked) => {
        void game.settings
          ?.set(MODULE_NAME, "audioNoiseGate", checked)
          .then(() => this.render());
      },
    );

    this.meterFill = el("div", { className: "livekit-meter-fill" });
    const slider = el("input", {
      className: "livekit-meter-threshold",
      attrs: {
        type: "range",
        min: METER_MIN_DB.toString(),
        max: METER_MAX_DB.toString(),
        step: "1",
        value: this.meterThreshold.toString(),
        "aria-label": localize("audioNoiseGateThreshold"),
      },
    });
    slider.disabled = !enabled || krispActive;
    const caption = el("span", {
      className: "livekit-meter-caption",
      text: `${this.meterThreshold.toString()} dB`,
    });
    slider.addEventListener("input", () => {
      this.meterThreshold = Number(slider.value);
      caption.textContent = `${slider.value} dB`;
    });
    slider.addEventListener("change", () => {
      game.settings
        ?.set(MODULE_NAME, "audioNoiseGateThreshold", Number(slider.value))
        .catch((error: unknown) => {
          log.error("Error saving the input sensitivity:", error);
        });
    });

    const meter = el("div", {
      className: `livekit-meter ${slider.disabled ? "disabled" : ""}`,
      children: [
        el("div", {
          className: "livekit-meter-track",
          children: [this.meterFill],
        }),
        slider,
      ],
    });

    return this.section(
      localize("inputSensitivity"),
      toggle,
      meter,
      el("p", {
        className: "livekit-settings-hint",
        text: krispActive
          ? localize("krispRefinementDisabled")
          : localize("inputSensitivityHint"),
        children: [!krispActive && caption],
      }),
    );
  }

  private renderNoiseSuppression(): HTMLElement {
    const select = el("select", {
      className: "livekit-select",
      attrs: { "aria-label": localize("noiseSuppressionModel") },
      children: this.client.getNoiseModelOptions().map((option) => {
        const element = el("option", {
          text: option.detail
            ? `${option.label} (${option.detail})`
            : option.label,
          attrs: { value: option.model },
        });
        element.selected = option.selected;
        element.disabled = !option.selectable && !option.selected;
        return element;
      }),
    });
    select.addEventListener("change", () => {
      this.client
        .selectNoiseModel(
          select.value as Parameters<LiveKitClient["selectNoiseModel"]>[0],
        )
        .then(() => this.render())
        .catch((error: unknown) => {
          log.error("Error selecting the noise suppression model:", error);
        });
    });

    const krispActive =
      this.client.getAudioProcessingConfig().model === "krisp";
    const settingToggle = (
      key: "audioEchoCancellation" | "audioAutoGainControl",
      disabled: boolean,
    ) =>
      switchControl(
        localize(key),
        game.settings?.get(MODULE_NAME, key) ?? false,
        disabled,
        (checked) => {
          void game.settings
            ?.set(MODULE_NAME, key, checked)
            .then(() => this.render());
        },
      );

    return this.section(
      localize("noiseSuppressionModel"),
      select,
      settingToggle("audioEchoCancellation", false),
      settingToggle("audioAutoGainControl", krispActive),
    );
  }

  private startMeter(): void {
    this.stopMeter();
    const microphone = this.client.audioTrack?.mediaStreamTrack;
    if (!microphone || microphone.readyState === "ended") {
      return;
    }
    // Measure a clone so the level shows even while muted
    const track = microphone.clone();
    track.enabled = true;
    const context = this.client.getAudioProcessorContext();
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
      if (this.meterFill) {
        const percent =
          ((db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)) * 100;
        this.meterFill.style.width = `${percent.toString()}%`;
        this.meterFill.classList.toggle("open", db >= this.meterThreshold);
      }
      if (this.meter) {
        this.meter.frame = requestAnimationFrame(update);
      }
    };
    this.meter = {
      track,
      source,
      analyser,
      frame: requestAnimationFrame(update),
    };
  }

  private stopMeter(): void {
    this.stopRecordingKey?.();
    if (!this.meter) {
      return;
    }
    cancelAnimationFrame(this.meter.frame);
    this.meter.source.disconnect();
    this.meter.track.stop();
    this.meter = undefined;
  }
}

/**
 * A labelled on/off switch.
 */
function switchControl(
  label: string,
  checked: boolean,
  disabled: boolean,
  onChange: (checked: boolean) => void,
): HTMLElement {
  const input = el("input", { attrs: { type: "checkbox", role: "switch" } });
  input.checked = checked && !disabled;
  input.disabled = disabled;
  input.addEventListener("change", () => {
    onChange(input.checked);
  });
  return el("label", {
    className: `livekit-switch ${disabled ? "disabled" : ""}`,
    children: [
      el("span", { text: label }),
      input,
      el("span", { className: "livekit-switch-track" }),
    ],
  });
}

/**
 * A readable name for a KeyboardEvent.code, using Foundry's helper when
 * available.
 */
function keyDisplayName(code: string): string {
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
