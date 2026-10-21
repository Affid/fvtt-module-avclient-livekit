import type LiveKitClient from "../LiveKitClient";
import { MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import {
  InputLevelMeter,
  getPushToTalkBindings,
  keybindRecorder,
  localize,
  radioGroup,
  selectInput,
  setPushToTalkKey,
  settingRow,
  switchInput,
} from "./controls";
import { Popover, el } from "./dom";

const log = new Logger("AudioSettingsPopover");

/**
 * Quick voice settings from the voice panel: input/output devices, input mode
 * (voice activity or push to talk), input sensitivity with a live level
 * meter, and noise suppression. Changes apply immediately. Everything else is
 * in the A/V settings window, linked from the footer.
 */
export default class AudioSettingsPopover {
  private readonly popover = new Popover("livekit-audio-settings", () => {
    this.meter?.stop();
  });
  private meter?: InputLevelMeter;

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
    this.meter?.start(this.client);
  }

  close(): void {
    this.popover.close();
  }

  /**
   * Rebuild the content, e.g. after a setting changed.
   */
  async render(): Promise<void> {
    const wasMetering = this.popover.isOpen;
    this.meter?.stop();
    const devices = await this.renderDevices();

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
      devices,
      this.renderInputMode(),
      this.renderSensitivity(),
      this.renderNoiseSuppression(),
      el("footer", {
        className: "livekit-popover-footer",
        children: [advanced],
      }),
    );
    this.popover.reposition();
    if (wasMetering) {
      this.meter?.start(this.client);
    }
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
    ) =>
      settingRow({
        label: localize(setting),
        control: selectInput({
          label: localize(setting),
          options: deviceOptions(devices, this.client.settings.client[setting]),
          value: this.client.settings.client[setting],
          onChange: (value) => {
            this.client.settings.set("client", setting, value);
            if (setting === "audioSink") {
              this.client.userAudioMixer.applyAll();
            }
          },
        }),
      });

    return this.section(
      localize("devices"),
      deviceSelect("audioSrc", sources),
      canPickOutput && deviceSelect("audioSink", sinks),
    );
  }

  private renderInputMode(): HTMLElement {
    const mode = this.client.settings.client.voice.mode;
    const bindings = getPushToTalkBindings();
    return this.section(
      localize("inputMode"),
      radioGroup({
        name: "livekit-voice-mode",
        value: mode,
        options: [
          { value: "always", label: localize("inputModeVoiceActivity") },
          { value: "ptt", label: localize("inputModePushToTalk") },
        ],
        onChange: (value) => {
          this.client.settings.set("client", "voice.mode", value);
          void this.render();
        },
      }),
      mode === "ptt" &&
        !!bindings &&
        settingRow({
          label: localize("pushToTalkKey"),
          inline: true,
          control: keybindRecorder(bindings, (code) => {
            setPushToTalkKey(code)
              .then(() => this.render())
              .catch((error: unknown) => {
                log.error("Error setting the push to talk key:", error);
              });
          }),
        }),
    );
  }

  private renderSensitivity(): HTMLElement {
    const krispActive =
      this.client.getAudioProcessingConfig().model === "krisp";
    const enabled = game.settings?.get(MODULE_NAME, "audioNoiseGate") ?? false;
    const threshold =
      game.settings?.get(MODULE_NAME, "audioNoiseGateThreshold") ?? -50;

    const caption = el("span", {
      className: "livekit-meter-caption",
      text: `${threshold.toString()} dB`,
    });
    this.meter = new InputLevelMeter({
      threshold,
      disabled: !enabled || krispActive,
      onInput: (value) => {
        caption.textContent = `${value.toString()} dB`;
      },
      onChange: (value) => {
        game.settings
          ?.set(MODULE_NAME, "audioNoiseGateThreshold", value)
          .catch((error: unknown) => {
            log.error("Error saving the input sensitivity:", error);
          });
      },
    });

    return this.section(
      localize("inputSensitivity"),
      switchInput({
        label: localize("inputSensitivityEnable"),
        checked: enabled && !krispActive,
        disabled: krispActive,
        onChange: (checked) => {
          void game.settings
            ?.set(MODULE_NAME, "audioNoiseGate", checked)
            .then(() => this.render());
        },
      }),
      this.meter.element,
      el("p", {
        className: "livekit-setting-hint",
        text: krispActive
          ? localize("krispRefinementDisabled")
          : localize("inputSensitivityHint"),
        children: [!krispActive && caption],
      }),
    );
  }

  private renderNoiseSuppression(): HTMLElement {
    const options = this.client.getNoiseModelOptions();
    const krispActive =
      this.client.getAudioProcessingConfig().model === "krisp";
    const settingToggle = (
      key: "audioEchoCancellation" | "audioAutoGainControl",
      disabled: boolean,
    ) =>
      switchInput({
        label: localize(key),
        checked: (game.settings?.get(MODULE_NAME, key) ?? false) && !disabled,
        disabled,
        onChange: (checked) => {
          void game.settings
            ?.set(MODULE_NAME, key, checked)
            .then(() => this.render());
        },
      });

    return this.section(
      localize("noiseSuppressionModel"),
      selectInput({
        label: localize("noiseSuppressionModel"),
        options: noiseModelOptions(options),
        value: options.find((option) => option.selected)?.model ?? "none",
        onChange: (value) => {
          this.client
            .selectNoiseModel(value as (typeof options)[number]["model"])
            .then(() => this.render())
            .catch((error: unknown) => {
              log.error("Error selecting the noise suppression model:", error);
            });
        },
      }),
      settingToggle("audioEchoCancellation", false),
      settingToggle("audioAutoGainControl", krispActive),
    );
  }
}

/**
 * Select options for a device list, keeping the current device even if it is
 * not available right now.
 */
export function deviceOptions(
  devices: Record<string, string>,
  current: string,
): { value: string; label: string }[] {
  const options = Object.entries(devices).map(([value, label]) => ({
    value,
    label,
  }));
  if (current && !(current in devices)) {
    options.push({
      value: current,
      label: current === "disabled" ? localize("deviceDisabled") : current,
    });
  }
  return options;
}

/**
 * Select options for the noise cancellation models.
 */
export function noiseModelOptions(
  options: ReturnType<LiveKitClient["getNoiseModelOptions"]>,
): { value: string; label: string; disabled: boolean }[] {
  return options.map((option) => ({
    value: option.model,
    label: option.detail ? `${option.label} (${option.detail})` : option.label,
    disabled: !option.selectable,
  }));
}
