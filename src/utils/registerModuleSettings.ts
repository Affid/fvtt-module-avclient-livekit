import { MODULE_NAME, TAVERN_AUTH_SERVER } from "./constants";
import { Logger } from "./logger";
import debug from "debug";

const log = new Logger();

/**
 * Register the module's settings. None of them are shown in Foundry's module
 * settings list: they are all edited in the A/V settings window
 * (LiveKitAVConfig), which the list links to.
 */
export default function registerModuleSettings(): void {
  game.settings?.register(MODULE_NAME, "displayConnectionQuality", {
    name: "LIVEKITAVCLIENT.displayConnectionQuality",
    hint: "LIVEKITAVCLIENT.displayConnectionQualityHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => game.webrtc?.render(),
  });

  // Discord-style interface: voice panel, speaking rings, avatars, per-user
  // volume menu, and voice settings popover
  game.settings?.register(MODULE_NAME, "discordStyleUI", {
    name: "LIVEKITAVCLIENT.discordStyleUI",
    hint: "LIVEKITAVCLIENT.discordStyleUIHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.applyDiscordStyle();
    },
  });

  // GM options for all players
  game.settings?.register(MODULE_NAME, "allowDiscordStyleUI", {
    name: "LIVEKITAVCLIENT.allowDiscordStyleUI",
    hint: "LIVEKITAVCLIENT.allowDiscordStyleUIHint",
    scope: "world",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.applyDiscordStyle();
    },
  });

  game.settings?.register(MODULE_NAME, "allowKrisp", {
    name: "LIVEKITAVCLIENT.allowKrisp",
    hint: "LIVEKITAVCLIENT.allowKrispHint",
    scope: "world",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  // The noise cancellation model for players who haven't picked one
  game.settings?.register(MODULE_NAME, "defaultNoiseModel", {
    name: "LIVEKITAVCLIENT.defaultNoiseModel",
    hint: "LIVEKITAVCLIENT.defaultNoiseModelHint",
    scope: "world",
    config: false,
    default: "gtcrn",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "gtcrn",
      choices: {
        none: "LIVEKITAVCLIENT.noiseSuppressionModelNone",
        speex: "LIVEKITAVCLIENT.noiseSuppressionModelSpeex",
        rnnoise: "LIVEKITAVCLIENT.noiseSuppressionModelRnnoise",
        gtcrn: "LIVEKITAVCLIENT.noiseSuppressionModelGtcrn",
        krisp: "LIVEKITAVCLIENT.noiseSuppressionModelKrisp",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  // Where the voice panel was dragged to (null: above the player list)
  game.settings?.register(MODULE_NAME, "voicePanelPosition", {
    scope: "client",
    config: false,
    default: null,
  });

  // Per-user playback volumes (0 to 2) and local mutes, keyed by user ID
  game.settings?.register(MODULE_NAME, "userVolumes", {
    scope: "client",
    config: false,
    default: {},
  });

  game.settings?.register(MODULE_NAME, "userLocalMutes", {
    scope: "client",
    config: false,
    default: {},
  });

  // Whether deafening muted the microphone, so undeafening unmutes it again
  game.settings?.register(MODULE_NAME, "mutedByDeafen", {
    scope: "client",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
  });

  game.settings?.register(MODULE_NAME, "liveKitConnectionSettings", {
    name: "LIVEKITAVCLIENT.liveKitConnectionSettings",
    hint: "LIVEKITAVCLIENT.liveKitConnectionSettingsHint",
    scope: "world",
    config: false,
    default: {},
    requiresReload: true,
  });

  game.settings?.register(MODULE_NAME, "tavernPatreonToken", {
    name: "LIVEKITAVCLIENT.tavernPatreonToken",
    hint: "LIVEKITAVCLIENT.tavernPatreonTokenHint",
    scope: "world",
    config: false,
    default: "",
    type: new foundry.data.fields.StringField({
      required: false,
      blank: true,
      initial: "",
    }),
    requiresReload: true,
  });

  game.settings?.register(MODULE_NAME, "breakoutRoomRegistry", {
    name: "LIVEKITAVCLIENT.breakoutRoomRegistry",
    hint: "LIVEKITAVCLIENT.breakoutRoomRegistryHint",
    scope: "client",
    config: false,
    default: {},
    requiresReload: false,
  });

  game.settings?.register(MODULE_NAME, "audioMusicMode", {
    name: "LIVEKITAVCLIENT.audioMusicMode",
    hint: "LIVEKITAVCLIENT.audioMusicModeHint",
    scope: "client",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioSourceChange();
    },
  });

  game.settings?.register(MODULE_NAME, "enhancedNoiseCancellation", {
    name: "LIVEKITAVCLIENT.enhancedNoiseCancellation",
    hint: "LIVEKITAVCLIENT.enhancedNoiseCancellationHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  // Which noise cancellation model to use when enhanced noise cancellation is
  // enabled. Krisp is only used on LiveKit Cloud; elsewhere the default
  // open-source model is used instead.
  game.settings?.register(MODULE_NAME, "noiseSuppressionModel", {
    name: "LIVEKITAVCLIENT.noiseSuppressionModel",
    hint: "LIVEKITAVCLIENT.noiseSuppressionModelHint",
    scope: "client",
    config: false,
    default: "gtcrn",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "gtcrn",
      choices: {
        rnnoise: "LIVEKITAVCLIENT.noiseSuppressionModelRnnoise",
        speex: "LIVEKITAVCLIENT.noiseSuppressionModelSpeex",
        gtcrn: "LIVEKITAVCLIENT.noiseSuppressionModelGtcrn",
        krisp: "LIVEKITAVCLIENT.noiseSuppressionModelKrisp",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  // Audio quality preset for outgoing audio publishing
  game.settings?.register(MODULE_NAME, "audioQualityPreset", {
    name: "LIVEKITAVCLIENT.audioQualityPreset",
    hint: "LIVEKITAVCLIENT.audioQualityPresetHint",
    scope: "client",
    config: false,
    default: "speech",
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: "speech",
      choices: {
        telephone: "LIVEKITAVCLIENT.audioQualityPresetTelephone",
        speech: "LIVEKITAVCLIENT.audioQualityPresetSpeech",
        music: "LIVEKITAVCLIENT.audioQualityPresetMusic",
        musicStereo: "LIVEKITAVCLIENT.audioQualityPresetMusicStereo",
        musicHighQuality: "LIVEKITAVCLIENT.audioQualityPresetMusicHighQuality",
        musicHighQualityStereo:
          "LIVEKITAVCLIENT.audioQualityPresetMusicHighQualityStereo",
      },
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioSourceChange();
    },
  });

  // WebRTC audio capture constraint toggles
  game.settings?.register(MODULE_NAME, "audioAutoGainControl", {
    name: "LIVEKITAVCLIENT.audioAutoGainControl",
    hint: "LIVEKITAVCLIENT.audioAutoGainControlHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  game.settings?.register(MODULE_NAME, "audioEchoCancellation", {
    name: "LIVEKITAVCLIENT.audioEchoCancellation",
    hint: "LIVEKITAVCLIENT.audioEchoCancellationHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  game.settings?.register(MODULE_NAME, "audioNoiseSuppression", {
    name: "LIVEKITAVCLIENT.audioNoiseSuppression",
    hint: "LIVEKITAVCLIENT.audioNoiseSuppressionHint",
    scope: "client",
    config: false,
    default: true,
    type: new foundry.data.fields.BooleanField({ initial: true }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  // Noise gate (client-side, applied as a track processor)
  game.settings?.register(MODULE_NAME, "audioNoiseGate", {
    name: "LIVEKITAVCLIENT.audioNoiseGate",
    hint: "LIVEKITAVCLIENT.audioNoiseGateHint",
    scope: "client",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  game.settings?.register(MODULE_NAME, "audioNoiseGateThreshold", {
    name: "LIVEKITAVCLIENT.audioNoiseGateThreshold",
    hint: "LIVEKITAVCLIENT.audioNoiseGateThresholdHint",
    scope: "client",
    config: false,
    default: -50,
    type: new foundry.data.fields.NumberField({
      required: true,
      nullable: false,
      min: -80,
      max: 0,
      step: 1,
      initial: -50,
    }),
    onChange: () => {
      game.webrtc?.client._liveKitClient.scheduleAudioProcessingRefresh();
    },
  });

  game.settings?.register(MODULE_NAME, "useExternalAV", {
    name: "LIVEKITAVCLIENT.useExternalAV",
    hint: "LIVEKITAVCLIENT.useExternalAVHint",
    scope: "client",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  game.settings?.register(MODULE_NAME, "resetRoom", {
    name: "LIVEKITAVCLIENT.resetRoom",
    hint: "LIVEKITAVCLIENT.resetRoomHint",
    scope: "world",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    onChange: (value: boolean | null) => {
      if (value && game.user?.isGM) {
        log.warn("Resetting meeting room ID");
        game.settings
          .set(MODULE_NAME, "resetRoom", false)
          .then(() => {
            const liveKitConnectionSettings = game.settings.get(
              MODULE_NAME,
              "liveKitConnectionSettings",
            );
            liveKitConnectionSettings.room = foundry.utils.randomID(32);
            game.settings
              .set(
                MODULE_NAME,
                "liveKitConnectionSettings",
                liveKitConnectionSettings,
              )
              .catch((error: unknown) => {
                log.error("Error setting liveKitConnectionSettings:", error);
              });
          })
          .catch((error: unknown) => {
            log.error("Error resetting meeting room ID", error);
          });
      }
    },
    requiresReload: true,
  });

  // Register debug logging setting
  game.settings?.register(MODULE_NAME, "debug", {
    name: "LIVEKITAVCLIENT.debug",
    hint: "LIVEKITAVCLIENT.debugHint",
    scope: "world",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  // Register debug trace logging setting
  game.settings?.register(MODULE_NAME, "liveKitTrace", {
    name: "LIVEKITAVCLIENT.liveKitTrace",
    hint: "LIVEKITAVCLIENT.liveKitTraceHint",
    scope: "world",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  // Register devMode setting
  game.settings?.register(MODULE_NAME, "devMode", {
    name: "LIVEKITAVCLIENT.devMode",
    hint: "LIVEKITAVCLIENT.devModeHint",
    scope: "world",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  //
  // devMode Settings
  //

  // TODO: The value for the authServer should be set by the selected LiveKit server
  // Register auth server setting
  game.settings?.register(MODULE_NAME, "authServer", {
    name: "LIVEKITAVCLIENT.authServer",
    hint: "LIVEKITAVCLIENT.authServerHint",
    scope: "world",
    config: false,
    default: TAVERN_AUTH_SERVER,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: false,
      initial: TAVERN_AUTH_SERVER,
    }),
    requiresReload: true,
  });

  // Register forced TURN setting
  game.settings?.register(MODULE_NAME, "forceTurn", {
    name: "LIVEKITAVCLIENT.forceTurn",
    hint: "LIVEKITAVCLIENT.forceTurnHint",
    scope: "world",
    config: false,
    default: false,
    type: new foundry.data.fields.BooleanField({ initial: false }),
    requiresReload: true,
  });

  //
  // Set the initial debug level
  //
  if (game.settings?.get(MODULE_NAME, "debug")) {
    if (game.settings.get(MODULE_NAME, "liveKitTrace")) {
      debug.enable("*");
      log.info("Enabling trace logging");
    } else {
      debug.enable(
        `${MODULE_NAME}:DEBUG,${MODULE_NAME}:DEBUG:*,${MODULE_NAME}:INFO,${MODULE_NAME}:INFO:*,${MODULE_NAME}:WARN,${MODULE_NAME}:WARN:*,${MODULE_NAME}:ERROR,${MODULE_NAME}:ERROR:*`,
      );
      log.info("Enabling debug logging");
    }
    // Enable Foundry AV debug logging
    CONFIG.debug.av = true;
    CONFIG.debug.avclient = true;
  } else {
    debug.enable(
      `${MODULE_NAME}:INFO,${MODULE_NAME}:INFO:*,${MODULE_NAME}:WARN,${MODULE_NAME}:WARN:*,${MODULE_NAME}:ERROR,${MODULE_NAME}:ERROR:*`,
    );
    // Disable Foundry AV debug logging
    CONFIG.debug.av = false;
    CONFIG.debug.avclient = false;
  }
}
