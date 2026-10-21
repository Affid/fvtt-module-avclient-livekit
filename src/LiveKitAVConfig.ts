import { DeepPartial } from "fvtt-types/utils";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import { delayReload } from "./utils/helpers";
import { Logger } from "./utils/logger.js";
import {
  getAuthUserInfo,
  TavernApiErrorResponse,
  ValidatedUser,
} from "./utils/auth.js";
import type LiveKitClient from "./LiveKitClient";
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
} from "./ui/controls";
import { deviceOptions, noiseModelOptions } from "./ui/AudioSettingsPopover";
import { el, icon } from "./ui/dom";
import { LiveKitConnectionSettings } from "../types/avclient-livekit";

const log = new Logger("LiveKitAVConfig");

interface PatreonLoginEvent extends MessageEvent {
  id: string;
}

/** Data loaded before rendering, which the DOM builders need */
interface SettingsData {
  audioSources: Record<string, string>;
  audioSinks: Record<string, string>;
  videoSources: Record<string, string>;
  connectionSettings: LiveKitConnectionSettings;
  authResponse?: ValidatedUser | TavernApiErrorResponse;
}

interface Section {
  id: string;
  icon: string;
  gmOnly: boolean;
  build: () => (Node | false)[];
}

/**
 * The A/V settings window, for players and the GM, in the same Discord style
 * as the voice panel. A sidebar lists the user's own settings and, for the
 * GM, the world settings. Changes are saved together from the unsaved changes
 * bar.
 *
 * It replaces Foundry's A/V configuration and is also linked from the
 * module's entry in Foundry's module settings list.
 */
export default class LiveKitAVConfig
  extends foundry.applications.settings.menus.AVConfig
{
  /** @override */
  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "av-config",
    classes: ["livekit-settings-app"],
    window: {
      title: "WEBRTC.Title",
      icon: "fa-solid fa-headset",
      resizable: true,
    },
    position: {
      width: 860,
      height: 640,
    },
    form: {
      closeOnSubmit: false,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      handler: LiveKitAVConfig.#onSubmit,
    },
  };

  /** @override */
  static PARTS = {
    content: { template: "modules/avclient-livekit/templates/settings.hbs" },
  };

  /** @override */
  static TABS = {};

  private data?: SettingsData;
  private activeSection = "voice";
  private meter?: InputLevelMeter;
  private dirtyTracking = false;

  private get liveKitClient(): LiveKitClient | undefined {
    return game.webrtc?.client._liveKitClient;
  }

  /** @override */
  async _prepareContext(
    options: Parameters<
      foundry.applications.settings.menus.AVConfig["_prepareContext"]
    >[0],
  ): Promise<foundry.applications.api.ApplicationV2.RenderContextOf<this>> {
    const context = await super._prepareContext(options);
    const avClient = game.webrtc?.client;
    const [audioSources, audioSinks, videoSources] = await Promise.all([
      avClient?.getAudioSources() ?? {},
      avClient?.getAudioSinks() ?? {},
      avClient?.getVideoSources() ?? {},
    ]);
    const connectionSettings =
      game.settings?.get(MODULE_NAME, "liveKitConnectionSettings") ?? {};

    let authResponse: ValidatedUser | TavernApiErrorResponse | undefined;
    if (game.user?.isGM && connectionSettings.serverType === "tavern") {
      const authServer = game.settings.get(MODULE_NAME, "authServer");
      const token = game.settings.get(MODULE_NAME, "tavernPatreonToken");
      if (authServer && token) {
        authResponse = await getAuthUserInfo(authServer, token);
      }
    }

    this.data = {
      audioSources,
      audioSinks,
      videoSources,
      connectionSettings,
      authResponse,
    };
    return context;
  }

  /** @override */
  async _onRender(
    context: foundry.applications.api.ApplicationV2.RenderContextOf<this>,
    options: DeepPartial<foundry.applications.api.HandlebarsApplicationMixin.RenderOptions>,
  ) {
    await super._onRender(context, options);
    this.meter?.stop();

    const root = this.element.querySelector("[data-livekit-settings]");
    if (!(root instanceof HTMLElement) || !this.data) {
      return;
    }

    const isGM = game.user?.isGM ?? false;
    const sections = this.sections().filter(
      (section) => isGM || !section.gmOnly,
    );
    if (!sections.some((section) => section.id === this.activeSection)) {
      this.activeSection = sections[0].id;
    }

    // Sidebar navigation
    const navButtons = new Map<string, HTMLButtonElement>();
    const panes = new Map<string, HTMLElement>();
    const nav = el("nav", { className: "livekit-settings-nav" });
    for (const group of ["user", "world"] as const) {
      const groupSections = sections.filter(
        (section) => section.gmOnly === (group === "world"),
      );
      if (!groupSections.length) {
        continue;
      }
      nav.append(
        el("h3", {
          className: "livekit-settings-nav-header",
          text: localize(
            group === "world" ? "settingsGroupWorld" : "settingsGroupUser",
          ),
        }),
      );
      for (const section of groupSections) {
        const button = el("button", {
          className: "livekit-settings-nav-item",
          attrs: { type: "button" },
          children: [
            icon(section.icon),
            el("span", { text: localize(`settingsSection.${section.id}`) }),
          ],
        });
        button.addEventListener("click", () => {
          this.showSection(section.id, navButtons, panes);
        });
        navButtons.set(section.id, button);
        nav.append(button);
      }
    }

    // One pane per section; all stay in the form so Save collects them all
    const content = el("div", { className: "livekit-settings-content" });
    for (const section of sections) {
      const pane = el("section", {
        className: "livekit-settings-pane",
        children: [
          el("h2", { text: localize(`settingsSection.${section.id}`) }),
          ...section.build(),
        ],
      });
      panes.set(section.id, pane);
      content.append(pane);
    }

    // Discord's "unsaved changes" bar
    const unsavedBar = el("div", {
      className: "livekit-unsaved-bar",
      attrs: { hidden: "" },
      children: [
        el("span", { text: localize("unsavedChanges") }),
        el("div", {
          className: "livekit-unsaved-actions",
          children: [
            this.button(localize("unsavedReset"), "livekit-link-button", () => {
              void this.render();
            }),
            el("button", {
              className: "livekit-button livekit-button-primary",
              text: localize("unsavedSave"),
              attrs: { type: "submit" },
            }),
          ],
        }),
      ],
    });
    // The form element is kept between renders, so listen only once
    if (!this.dirtyTracking) {
      this.dirtyTracking = true;
      const markDirty = () => {
        const bar = this.element.querySelector(".livekit-unsaved-bar");
        if (bar instanceof HTMLElement) {
          bar.hidden = false;
        }
      };
      this.element.addEventListener("input", markDirty);
      this.element.addEventListener("change", markDirty);
    }

    root.replaceChildren(
      nav,
      el("div", {
        className: "livekit-settings-main",
        children: [content, unsavedBar],
      }),
    );
    this.showSection(this.activeSection, navButtons, panes);

    if (this.liveKitClient) {
      this.meter?.start(this.liveKitClient);
    }
  }

  /** @override */
  _onClose(
    options: Parameters<
      foundry.applications.settings.menus.AVConfig["_onClose"]
    >[0],
  ): void {
    this.meter?.stop();
    this.meter = undefined;
    super._onClose(options);
  }

  private showSection(
    id: string,
    navButtons: Map<string, HTMLButtonElement>,
    panes: Map<string, HTMLElement>,
  ): void {
    this.activeSection = id;
    for (const [sectionId, button] of navButtons) {
      button.classList.toggle("active", sectionId === id);
      button.setAttribute("aria-current", String(sectionId === id));
    }
    for (const [sectionId, pane] of panes) {
      pane.hidden = sectionId !== id;
    }
  }

  private button(
    text: string,
    className: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = el("button", {
      className,
      text,
      attrs: { type: "button" },
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  /* -------------------------------------------- */
  /*  Sections                                    */
  /* -------------------------------------------- */

  private sections(): Section[] {
    return [
      {
        id: "voice",
        icon: "fa-microphone",
        gmOnly: false,
        build: () => this.buildVoice(),
      },
      {
        id: "noise",
        icon: "fa-wand-magic-sparkles",
        gmOnly: false,
        build: () => this.buildNoise(),
      },
      {
        id: "video",
        icon: "fa-video",
        gmOnly: false,
        build: () => this.buildVideo(),
      },
      {
        id: "appearance",
        icon: "fa-palette",
        gmOnly: false,
        build: () => this.buildAppearance(),
      },
      {
        id: "advanced",
        icon: "fa-sliders",
        gmOnly: false,
        build: () => this.buildAdvanced(),
      },
      {
        id: "server",
        icon: "fa-server",
        gmOnly: true,
        build: () => this.buildServer(),
      },
      {
        id: "players",
        icon: "fa-users",
        gmOnly: true,
        build: () => this.buildPlayerOptions(),
      },
      {
        id: "troubleshooting",
        icon: "fa-bug",
        gmOnly: true,
        build: () => this.buildTroubleshooting(),
      },
    ];
  }

  private moduleSwitch(
    key:
      | "audioAutoGainControl"
      | "audioEchoCancellation"
      | "audioNoiseSuppression"
      | "audioMusicMode"
      | "audioNoiseGate"
      | "discordStyleUI"
      | "displayConnectionQuality"
      | "useExternalAV"
      | "allowDiscordStyleUI"
      | "allowKrisp"
      | "debug"
      | "liveKitTrace"
      | "devMode"
      | "forceTurn",
    {
      disabled = false,
      hint,
      label,
    }: { disabled?: boolean; hint?: string; label?: string } = {},
  ): HTMLElement {
    return switchInput({
      name: `${MODULE_NAME}.${key}`,
      label: label ?? localize(key),
      hint: hint ?? hintFor(key),
      checked: game.settings?.get(MODULE_NAME, key) === true,
      disabled,
    });
  }

  private clientSwitch(
    key: "hideDock" | "hidePlayerList" | "borderColors" | "disableVideo",
  ): HTMLElement {
    return switchInput({
      name: `core.rtcClientSettings.${key}`,
      label: localize(`clientSetting.${key}`),
      hint: hintFor(`clientSetting.${key}`),
      checked: game.webrtc?.settings.client[key] === true,
    });
  }

  private group(title: string, ...children: (Node | false)[]): HTMLElement {
    return el("div", {
      className: "livekit-settings-group",
      children: [el("h4", { text: title }), ...children],
    });
  }

  private buildVoice(): (Node | false)[] {
    const data = this.data;
    const client = game.webrtc?.settings.client;
    if (!data || !client) {
      return [];
    }
    const krispActive =
      this.liveKitClient?.getAudioProcessingConfig().model === "krisp";

    // Devices
    const deviceSelect = (
      key: "audioSrc" | "audioSink",
      devices: Record<string, string>,
      allowDisabled: boolean,
    ) =>
      settingRow({
        label: localize(key),
        control: selectInput({
          name: `core.rtcClientSettings.${key}`,
          label: localize(key),
          options: [
            ...deviceOptions(devices, client[key]).filter(
              (option) => option.value !== "disabled",
            ),
            ...(allowDisabled
              ? [{ value: "disabled", label: localize("deviceDisabled") }]
              : []),
          ],
          value: client[key],
        }),
      });

    // Input mode, with the push to talk options shown only for push to talk
    const bindings = getPushToTalkBindings();
    const pushToTalkKey = el("input", {
      attrs: { type: "hidden", name: "livekit.pushToTalkKey", value: "" },
    });
    const pushToTalkOptions = el("div", {
      className: "livekit-settings-subgroup",
      children: [
        !!bindings &&
          settingRow({
            label: localize("pushToTalkKey"),
            inline: true,
            control: keybindRecorder(bindings, (code) => {
              pushToTalkKey.value = code;
              pushToTalkKey.dispatchEvent(
                new Event("change", { bubbles: true }),
              );
            }),
          }),
        pushToTalkKey,
        settingRow({
          label: localize("pushToTalkDelay"),
          hint: localize("pushToTalkDelayHint"),
          inline: true,
          control: el("input", {
            className: "livekit-number",
            attrs: {
              type: "number",
              name: "core.rtcClientSettings.voice.pttDelay",
              min: "0",
              step: "10",
              value: String(client.voice.pttDelay),
            },
          }),
        }),
      ],
    });
    pushToTalkOptions.hidden = client.voice.mode !== "ptt";
    const inputMode = radioGroup({
      name: "core.rtcClientSettings.voice.mode",
      value: client.voice.mode,
      options: [
        { value: "always", label: localize("inputModeVoiceActivity") },
        { value: "ptt", label: localize("inputModePushToTalk") },
      ],
      onChange: (value) => {
        pushToTalkOptions.hidden = value !== "ptt";
      },
    });

    // Input sensitivity
    const threshold =
      game.settings?.get(MODULE_NAME, "audioNoiseGateThreshold") ?? -50;
    const caption = el("span", {
      className: "livekit-meter-caption",
      text: `${threshold.toString()} dB`,
    });
    this.meter = new InputLevelMeter({
      name: `${MODULE_NAME}.audioNoiseGateThreshold`,
      threshold,
      disabled: krispActive,
      onInput: (value) => {
        caption.textContent = `${value.toString()} dB`;
      },
    });

    return [
      this.group(
        localize("devices"),
        deviceSelect("audioSrc", data.audioSources, true),
        "setSinkId" in HTMLMediaElement.prototype &&
          deviceSelect("audioSink", data.audioSinks, false),
      ),
      this.group(localize("inputMode"), inputMode, pushToTalkOptions),
      this.group(
        localize("inputSensitivity"),
        this.moduleSwitch("audioNoiseGate", {
          label: localize("inputSensitivityEnable"),
          disabled: krispActive,
          hint: krispActive ? localize("krispRefinementDisabled") : undefined,
        }),
        this.meter.element,
        el("p", {
          className: "livekit-setting-hint",
          text: localize("inputSensitivityHint"),
          children: [caption],
        }),
      ),
    ];
  }

  private buildNoise(): (Node | false)[] {
    const client = this.liveKitClient;
    if (!client) {
      return [];
    }
    const options = client.getNoiseModelOptions();
    const krispActive = client.getAudioProcessingConfig().model === "krisp";
    const modelActive = !!client.getAudioProcessingConfig().model;

    return [
      this.group(
        localize("noiseSuppressionModel"),
        settingRow({
          label: localize("noiseSuppressionModel"),
          hint: localize("noiseSuppressionModelHint"),
          control: selectInput({
            name: "livekit.noiseModel",
            label: localize("noiseSuppressionModel"),
            options: noiseModelOptions(options),
            value: options.find((option) => option.selected)?.model ?? "none",
          }),
        }),
        this.moduleSwitch("audioEchoCancellation"),
        this.moduleSwitch("audioAutoGainControl", {
          disabled: krispActive,
          hint: krispActive ? localize("krispRefinementDisabled") : undefined,
        }),
        this.moduleSwitch("audioNoiseSuppression", {
          hint: modelActive
            ? localize("audioNoiseSuppressionModelActive")
            : undefined,
        }),
      ),
      this.group(
        localize("audioQuality"),
        settingRow({
          label: localize("audioQualityPreset"),
          hint: localize("audioQualityPresetHint"),
          control: selectInput({
            name: `${MODULE_NAME}.audioQualityPreset`,
            label: localize("audioQualityPreset"),
            options: [
              "telephone",
              "speech",
              "music",
              "musicStereo",
              "musicHighQuality",
              "musicHighQualityStereo",
            ].map((preset) => ({
              value: preset,
              label: localize(
                `audioQualityPreset${preset.charAt(0).toUpperCase()}${preset.slice(1)}`,
              ),
            })),
            value:
              game.settings?.get(MODULE_NAME, "audioQualityPreset") ?? "speech",
          }),
        }),
        this.moduleSwitch("audioMusicMode"),
      ),
    ];
  }

  private buildVideo(): (Node | false)[] {
    const data = this.data;
    const client = game.webrtc?.settings.client;
    if (!data || !client) {
      return [];
    }
    return [
      this.group(
        localize("devices"),
        settingRow({
          label: localize("videoSrc"),
          control: selectInput({
            name: "core.rtcClientSettings.videoSrc",
            label: localize("videoSrc"),
            options: [
              ...deviceOptions(data.videoSources, client.videoSrc).filter(
                (option) => option.value !== "disabled",
              ),
              { value: "disabled", label: localize("deviceDisabled") },
            ],
            value: client.videoSrc,
          }),
        }),
      ),
      this.group(localize("videoReceiving"), this.clientSwitch("disableVideo")),
    ];
  }

  private buildAppearance(): (Node | false)[] {
    const client = game.webrtc?.settings.client;
    if (!client) {
      return [];
    }
    const allowed =
      game.settings?.get(MODULE_NAME, "allowDiscordStyleUI") ?? true;
    return [
      this.group(
        localize("appearanceInterface"),
        this.moduleSwitch("discordStyleUI", {
          disabled: !allowed,
          hint: allowed ? undefined : localize("discordStyleUIDisabledByGM"),
        }),
        this.moduleSwitch("displayConnectionQuality"),
      ),
      this.group(
        localize("appearanceDock"),
        settingRow({
          label: localize("clientSetting.dockPosition"),
          control: selectInput({
            name: "core.rtcClientSettings.dockPosition",
            label: localize("clientSetting.dockPosition"),
            options: ["top", "right", "bottom", "left"].map((position) => ({
              value: position,
              label: localize(`dockPosition.${position}`),
            })),
            value: client.dockPosition,
          }),
        }),
        settingRow({
          label: localize("clientSetting.nameplates"),
          control: selectInput({
            name: "core.rtcClientSettings.nameplates",
            label: localize("clientSetting.nameplates"),
            dtype: "Number",
            options: ["off", "both", "playerOnly", "characterOnly"].map(
              (mode, index) => ({
                value: index.toString(),
                label: localize(`nameplates.${mode}`),
              }),
            ),
            value: String(client.nameplates),
          }),
        }),
        this.clientSwitch("borderColors"),
        this.clientSwitch("hideDock"),
        this.clientSwitch("hidePlayerList"),
      ),
    ];
  }

  private buildAdvanced(): (Node | false)[] {
    return [
      this.group(
        localize("advancedConnection"),
        this.moduleSwitch("useExternalAV"),
      ),
    ];
  }

  private buildServer(): (Node | false)[] {
    const data = this.data;
    const world = game.webrtc?.settings.world;
    if (!data || !world) {
      return [];
    }
    const connection = data.connectionSettings;
    const serverTypes = this.liveKitClient?.liveKitServerTypes ?? {};

    // A/V mode
    const mode = settingRow({
      label: localize("avMode"),
      hint: localize("avModeHint"),
      control: selectInput({
        name: "core.rtcWorldSettings.mode",
        label: localize("avMode"),
        dtype: "Number",
        options: ["disabled", "audio", "video", "audioVideo"].map(
          (avMode, index) => ({
            value: index.toString(),
            label: localize(`avMode.${avMode}`),
          }),
        ),
        value: String(world.mode),
      }),
    });

    // Server type, with the matching details below it
    const textField = (
      key: "url" | "username" | "password",
      type: "text" | "password",
    ) =>
      settingRow({
        label: localize(`connection.${key}`),
        hint: hintFor(`connection.${key}`),
        control: el("input", {
          className: "livekit-text",
          attrs: {
            type,
            name: `${MODULE_NAME}.liveKitConnectionSettings.${key}`,
            value: connection[key] ?? "",
            autocomplete: type === "password" ? "one-time-code" : "off",
            spellcheck: "false",
          },
        }),
      });
    const customDetails = el("div", {
      className: "livekit-settings-subgroup",
      children: [
        textField("url", "text"),
        textField("username", "text"),
        textField("password", "password"),
      ],
    });
    const tavernDetails = this.buildTavernAccount();
    const savedType = connection.serverType;
    const showDetails = (type: string) => {
      customDetails.hidden = type !== "custom";
      // Signing in needs the server type to be saved first
      tavernDetails.hidden = type !== "tavern";
      tavernDetails.classList.toggle("unsaved", savedType !== "tavern");
    };
    const serverType = selectInput({
      name: `${MODULE_NAME}.liveKitConnectionSettings.serverType`,
      label: localize("serverType"),
      options: Object.values(serverTypes).map((type) => ({
        value: type.key,
        label: game.i18n?.localize(type.label) ?? type.key,
      })),
      value: savedType ?? "custom",
      onChange: showDetails,
    });
    showDetails(savedType ?? "custom");

    return [
      this.group(localize("serverGroupAV"), mode),
      this.group(
        localize("serverGroupConnection"),
        settingRow({
          label: localize("serverType"),
          hint: localize("serverTypeNotes"),
          control: serverType,
        }),
        customDetails,
        tavernDetails,
      ),
    ];
  }

  private buildTavernAccount(): HTMLElement {
    const token = game.settings?.get(MODULE_NAME, "tavernPatreonToken") ?? "";
    const authServer = game.settings?.get(MODULE_NAME, "authServer") ?? "";
    const response = this.data?.authResponse;

    const status = el("p", { className: "livekit-setting-hint" });
    if (response && "error" in response) {
      status.textContent = `${localize("patreonAccountError")}: ${response.error}`;
    } else if (response) {
      status.append(
        `${localize("patreonAccountNote")}: ${response.vanity ?? response.full_name ?? ""} (`,
        el("a", {
          text: response.active_tier ?? localize("patreonAccountNotMember"),
          attrs: {
            href: "https://www.patreon.com/tavern_at",
            target: "_blank",
          },
        }),
        ")",
      );
    }

    const tokenInput = settingRow({
      label: localize("tavernAccountToken"),
      hint: localize("tavernAccountTokenHint"),
      control: el("input", {
        className: "livekit-text",
        attrs: {
          type: "password",
          name: `${MODULE_NAME}.tavernPatreonToken`,
          value: token,
        },
      }),
    });

    const account = token
      ? this.button(
          localize("tavernAccountLogoutLabel"),
          "livekit-button",
          () => {
            this._patreonLogout(authServer).catch((error: unknown) => {
              log.error("Error logging out of Patreon account", error);
            });
          },
        )
      : this.button(
          localize("tavernAccountPatreonLabel"),
          "livekit-button livekit-button-patreon",
          () => {
            this.patreonLogin(authServer);
            tokenInput.hidden = false;
          },
        );
    account.prepend(el("i", { className: "fa-brands fa-patreon" }));
    tokenInput.hidden = true;

    return el("div", {
      className: "livekit-settings-subgroup livekit-tavern",
      children: [
        settingRow({
          label: localize("tavernAccountLabel"),
          hint: token ? status : localize("tavernAccountPatreonHint"),
          control: account,
          inline: true,
        }),
        el("p", {
          className: "livekit-setting-hint livekit-tavern-unsaved",
          text: localize("tavernSaveFirst"),
        }),
        tokenInput,
      ],
    });
  }

  private buildPlayerOptions(): (Node | false)[] {
    return [
      this.group(
        localize("playerOptions"),
        this.moduleSwitch("allowDiscordStyleUI"),
        this.moduleSwitch("allowKrisp"),
        settingRow({
          label: localize("defaultNoiseModel"),
          hint: localize("defaultNoiseModelHint"),
          control: selectInput({
            name: `${MODULE_NAME}.defaultNoiseModel`,
            label: localize("defaultNoiseModel"),
            options: ["none", "speex", "rnnoise", "gtcrn", "krisp"].map(
              (model) => ({
                value: model,
                label: localize(
                  `noiseSuppressionModel${model.charAt(0).toUpperCase()}${model.slice(1)}`,
                ),
              }),
            ),
            value:
              game.settings?.get(MODULE_NAME, "defaultNoiseModel") ?? "gtcrn",
          }),
        }),
      ),
    ];
  }

  private buildTroubleshooting(): (Node | false)[] {
    const debug = game.settings?.get(MODULE_NAME, "debug") ?? false;
    const devMode = game.settings?.get(MODULE_NAME, "devMode") ?? false;

    const resetRoom = this.button(
      localize("resetRoomButton"),
      "livekit-button livekit-button-danger",
      () => {
        game.settings
          ?.set(MODULE_NAME, "resetRoom", true)
          .then(() => {
            ui.notifications?.info(localize("resetRoomDone"));
          })
          .catch((error: unknown) => {
            log.error("Error resetting the meeting room", error);
          });
      },
    );

    // Trace logging needs debug logging; unlock it as soon as debug is on
    const debugSwitch = this.moduleSwitch("debug");
    const traceSwitch = this.moduleSwitch("liveKitTrace", {
      disabled: !debug,
      hint: debug ? undefined : localize("liveKitTraceNeedsDebug"),
    });
    debugSwitch.querySelector("input")?.addEventListener("change", (event) => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      const traceInput = traceSwitch.querySelector("input");
      if (traceInput) {
        traceInput.disabled = !enabled;
      }
      traceSwitch.classList.toggle("disabled", !enabled);
    });

    return [
      this.group(
        localize("troubleshootingRoom"),
        settingRow({
          label: localize("resetRoom"),
          hint: localize("resetRoomHint"),
          control: resetRoom,
          inline: true,
        }),
      ),
      this.group(localize("troubleshootingLogging"), debugSwitch, traceSwitch),
      (import.meta.env.MODE === "development" || devMode) &&
        this.group(
          localize("troubleshootingDeveloper"),
          import.meta.env.MODE === "development" &&
            this.moduleSwitch("devMode"),
          devMode && this.moduleSwitch("forceTurn"),
          devMode &&
            settingRow({
              label: localize("authServer"),
              hint: localize("authServerHint"),
              control: el("input", {
                className: "livekit-text",
                attrs: {
                  type: "text",
                  name: `${MODULE_NAME}.authServer`,
                  value: game.settings?.get(MODULE_NAME, "authServer") ?? "",
                },
              }),
            }),
        ),
    ];
  }

  /* -------------------------------------------- */
  /*  Tavern Patreon account                      */
  /* -------------------------------------------- */

  private patreonLogin(authServer: string): void {
    if (!game.user?.isGM || !authServer) {
      log.error("Auth server is not set");
      return;
    }
    const id = btoa(
      `{"host": "${window.location.hostname}", "world": "${game.world.id}"}`,
    );
    window.addEventListener(
      "message",
      (event) => {
        this._patreonLoginListener(event as PatreonLoginEvent).catch(
          (e: unknown) => {
            log.error("Error logging in to Patreon account", e);
          },
        );
      },
      { once: true },
    );
    window.open(
      `${authServer}/auth/patreon?id=${id}&clientRole=participant`,
      undefined,
      "width=600,height=800",
    );
  }

  async _patreonLogout(authServer: string) {
    // GM only
    if (!game.user?.isGM) return;

    let tavernPatreonToken = game.settings.get(
      MODULE_NAME,
      "tavernPatreonToken",
    );

    const response = await fetch(`${authServer}/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: tavernPatreonToken }),
    });
    if (!response.ok) {
      ui.notifications?.error(`${LANG_NAME}.liveKitAccountLogoutError`, {
        localize: true,
      });
      log.warn("Error signing out of Patreon account", response);
    }

    tavernPatreonToken = "";
    await game.settings.set(
      MODULE_NAME,
      "tavernPatreonToken",
      tavernPatreonToken,
    );
    delayReload();
  }

  async _patreonLoginListener(messageEvent: MessageEvent<PatreonLoginEvent>) {
    // GM only
    if (!game.user?.isGM) return;
    const authServer = game.settings.get(MODULE_NAME, "authServer");
    if (messageEvent.origin !== authServer) return;

    messageEvent.preventDefault();

    const tavernPatreonToken = messageEvent.data.id;

    await game.settings.set(
      MODULE_NAME,
      "tavernPatreonToken",
      tavernPatreonToken,
    );
    delayReload();
  }

  /* -------------------------------------------- */
  /*  Saving                                      */
  /* -------------------------------------------- */

  /**
   * Update world and client settings.
   * @this {LiveKitAVConfig}
   * @type {ApplicationFormSubmission}
   */
  static async #onSubmit(
    this: LiveKitAVConfig,
    _event: Event,
    _form: HTMLFormElement,
    formData: { object: object },
  ) {
    const settings = game.webrtc?.settings;

    if (!settings) {
      log.error("WebRTC settings not found");
      return;
    }

    // @ts-expect-error - expandObject handling is not in foundry-vtt-types to give the proper type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const coreData = foundry.utils.expandObject(formData.object).core;

    // @ts-expect-error - expandObject handling is not in foundry-vtt-types to give the proper type
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const liveKitData = foundry.utils.expandObject(formData.object)[
      "avclient-livekit"
    ];

    // Values that aren't settings of their own
    const extraData = (
      foundry.utils.expandObject(formData.object) as {
        livekit?: { noiseModel?: string; pushToTalkKey?: string };
      }
    ).livekit;

    // The noise model shown in the form, before the GM's default model below
    // may change what it resolves to
    const liveKitClient = game.webrtc?.client._liveKitClient;
    const shownNoiseModel = liveKitClient?.getSelectedNoiseModel();

    // Update world settings
    const promises = [];
    if (game.user?.isGM) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const worldUpdates = foundry.utils.mergeObject(
        settings.world,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        coreData.rtcWorldSettings,
        { inplace: false },
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (settings.world.mode !== worldUpdates.mode)
        // @ts-expect-error - reloadConfirm  is not in foundry-vtt-types
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        foundry.applications.settings.SettingsConfig.reloadConfirm({
          world: true,
        });
      promises.push(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        game.settings.set("core", "rtcWorldSettings", worldUpdates),
      );
    }

    // Update client settings
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const clientUpdates = foundry.utils.mergeObject(
      settings.client,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      coreData.rtcClientSettings,
      { inplace: false },
    );
    if (game.settings) {
      promises.push(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        game.settings.set("core", "rtcClientSettings", clientUpdates),
      );
    }

    await Promise.all(promises);

    // Update LiveKit settings
    let requiresClientReload = false;
    let requiresWorldReload = false;
    // eslint-disable-next-line prefer-const
    for (let [key, value] of Object.entries(
      (liveKitData ?? {}) as Record<string, unknown>,
    )) {
      // @ts-expect-error - we need to assume this is a valid setting for now
      const setting = game.settings?.settings.get(`${MODULE_NAME}.${key}`);
      if (!setting) continue;
      // @ts-expect-error - document: true handling is not in foundry-vtt-types
      const priorValue = game.settings?.get(setting.namespace, setting.key, {
        document: true,
      })._source.value;

      if (setting.key === "liveKitConnectionSettings") {
        // We need to handle this one as an object and merge the settings
        const priorValueObject = game.settings?.get(
          // @ts-expect-error - document: true handling is not in foundry-vtt-types
          setting.namespace,
          setting.key,
        );
        // @ts-expect-error - _source handling is not in foundry-vtt-types
        value = foundry.utils.mergeObject(priorValueObject, value, {
          inplace: false,
        });
      }

      // Skip unchanged settings, so their change handlers (which may restart
      // or re-publish the microphone) don't run needlessly
      if (priorValue === JSON.stringify(value)) continue;

      let newSetting;
      try {
        newSetting = await game.settings?.set(
          setting.namespace as foundry.helpers.ClientSettings.Namespace,
          setting.key as foundry.helpers.ClientSettings.KeyFor<"avclient-livekit">,
          value as foundry.helpers.ClientSettings.SettingCreateData<
            foundry.helpers.ClientSettings.Namespace,
            foundry.helpers.ClientSettings.KeyFor<"avclient-livekit">
          >,
          { document: true },
        );
      } catch (error) {
        ui.notifications?.error(error as string);
      }
      if (priorValue === newSetting?._source.value) continue; // Compare JSON strings
      requiresClientReload ||=
        (setting.scope !== "world" && setting.requiresReload) ?? false;
      requiresWorldReload ||=
        (setting.scope === "world" && setting.requiresReload) ?? false;
    }

    // Noise model ("none" turns enhanced noise cancellation off). Only save it
    // if it was changed, so players who never picked one keep following the
    // GM's default.
    if (
      extraData?.noiseModel &&
      liveKitClient &&
      extraData.noiseModel !== shownNoiseModel
    ) {
      await liveKitClient.selectNoiseModel(
        extraData.noiseModel as Parameters<
          LiveKitClient["selectNoiseModel"]
        >[0],
      );
    }

    // Push to talk key
    if (extraData?.pushToTalkKey) {
      await setPushToTalkKey(extraData.pushToTalkKey);
    }

    if (requiresClientReload || requiresWorldReload) {
      // @ts-expect-error - reloadConfirm  is not in foundry-vtt-types
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await foundry.applications.settings.SettingsConfig.reloadConfirm({
        world: requiresWorldReload,
      });
    }

    // Show the saved state and hide the unsaved changes bar
    await this.render();
  }
}

/**
 * A setting's hint, if it has one.
 */
function hintFor(key: string): string | undefined {
  const hintKey = `${LANG_NAME}.${key}Hint`;
  const hint = game.i18n?.localize(hintKey);
  return hint && hint !== hintKey ? hint : undefined;
}
