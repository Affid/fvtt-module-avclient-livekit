import type LiveKitClient from "../LiveKitClient";
import { MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import Popover from "./Popover";
import { button } from "./buttons";
import {
  getPushToTalkBindings,
  keybindRecorder,
  localize,
  segmentedControl,
  selectInput,
  setPushToTalkKey,
  settingRow,
  switchInput,
} from "./controls";
import { el, uniqueId } from "./dom";
import { InputLevelMeter } from "./LevelMeter";
import { videoBackgroundRow } from "./videoBackgroundControl";

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
    this.client.previewVoiceGate();
  });
  private meter?: InputLevelMeter;

  constructor(private readonly client: LiveKitClient) {}

  get isOpen(): boolean {
    return this.popover.isOpen;
  }

  /**
   * @param anchor    The element to show the popover against
   * @param control   The button that opened the popover, if not the anchor
   */
  toggle(anchor: HTMLElement, control: HTMLElement = anchor): void {
    if (this.popover.isOpen) {
      this.popover.close();
    } else {
      void this.open(anchor, control);
    }
  }

  async open(
    anchor: HTMLElement,
    control: HTMLElement = anchor,
  ): Promise<void> {
    await this.render();
    this.popover.openAt(anchor, control);
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
    const video = await this.renderVideo();

    const advanced = button({
      label: localize("advancedSettings"),
      variant: "link",
      onClick: () => {
        this.close();
        this.client.avMaster.config
          .render({ force: true })
          .catch((error: unknown) => {
            log.error("Error opening the A/V settings:", error);
          });
      },
    });

    const titleId = uniqueId("title");
    this.popover.element.setAttribute("aria-labelledby", titleId);
    const sections = [
      el("h3", {
        className: "livekit-popover-title",
        text: localize("voiceSettings"),
        attrs: { id: titleId },
      }),
      devices,
      this.renderInputMode(),
      this.renderSensitivity(),
      this.renderNoiseSuppression(),
      video,
      el("footer", {
        className: "livekit-popover-footer",
        children: [advanced],
      }),
    ];
    this.popover.element.replaceChildren(
      ...sections.filter((section) => section !== false),
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

  /**
   * The camera and receiving other users' video, when the world uses video.
   */
  private async renderVideo(): Promise<HTMLElement | false> {
    if (!this.client.voiceControls.canUseCamera()) {
      return false;
    }
    const sources = await this.client.liveKitAvClient.getVideoSources();
    const current = this.client.settings.client.videoSrc;
    return this.section(
      localize("settingsSection.video"),
      settingRow({
        label: localize("videoSrc"),
        control: selectInput({
          label: localize("videoSrc"),
          options: [
            ...deviceOptions(sources, current).filter(
              (option) => option.value !== "disabled",
            ),
            { value: "disabled", label: localize("deviceDisabled") },
          ],
          value: current,
          onChange: (value) => {
            this.client.settings.set("client", "videoSrc", value);
          },
        }),
      }),
      videoBackgroundRow({
        name: "livekit-video-background",
        client: this.client,
      }),
      switchInput({
        label: localize("receiveVideo"),
        checked: !this.client.settings.client.disableVideo,
        onChange: (checked) => {
          this.client.settings.set("client", "disableVideo", !checked);
        },
      }),
    );
  }

  private renderInputMode(): HTMLElement {
    const mode = this.client.settings.client.voice.mode;
    const bindings = getPushToTalkBindings();
    return this.section(
      localize("inputMode"),
      segmentedControl({
        name: "livekit-voice-mode",
        label: localize("inputMode"),
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

  /**
   * Input sensitivity, in Voice Activity mode only: automatic, or a threshold
   * set on the level meter. Dragging the threshold tries it out on the
   * microphone right away; letting go saves it.
   */
  private renderSensitivity(): HTMLElement | false {
    if (this.client.settings.client.voice.mode !== "always") {
      this.meter = undefined;
      return false;
    }
    const settings = this.client.getVoiceGateSettings();
    const caption = el("span", {
      className: "livekit-meter-caption",
      text: `${settings.threshold.toString()} dB`,
    });
    this.meter = new InputLevelMeter({
      settings,
      onInput: (threshold) => {
        caption.textContent = `${threshold.toString()} dB`;
        this.client.previewVoiceGate({ auto: false, threshold });
      },
      onChange: (threshold) => {
        game.settings
          ?.set(MODULE_NAME, "audioNoiseGateThreshold", threshold)
          .then(() => {
            this.client.previewVoiceGate();
          })
          .catch((error: unknown) => {
            log.error("Error saving the input sensitivity:", error);
          });
      },
    });

    return this.section(
      localize("inputSensitivity"),
      switchInput({
        label: localize("audioAutoSensitivity"),
        checked: settings.auto,
        onChange: (checked) => {
          void game.settings
            ?.set(MODULE_NAME, "audioAutoSensitivity", checked)
            .then(() => this.render());
        },
      }),
      this.meter.element,
      el("p", {
        className: "livekit-setting-hint",
        text: localize(
          settings.auto ? "inputSensitivityAutoHint" : "inputSensitivityHint",
        ),
        children: [!settings.auto && caption],
      }),
    );
  }

  private renderNoiseSuppression(): HTMLElement {
    const options = this.client.getNoiseModelOptions();
    const settingToggle = (
      key: "audioEchoCancellation" | "audioAutoGainControl",
    ) =>
      switchInput({
        label: localize(key),
        checked: game.settings?.get(MODULE_NAME, key) ?? false,
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
      settingToggle("audioEchoCancellation"),
      settingToggle("audioAutoGainControl"),
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
