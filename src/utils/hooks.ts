import type { SocketMessage } from "../../types/avclient-livekit";
import LiveKitAVConfig from "../LiveKitAVConfig";
import LiveKitCameraViews from "../ui/dock/LiveKitCameraViews";
import { MODULE_NAME } from "./constants";
import registerModuleSettings from "./registerModuleSettings";

/* -------------------------------------------- */
/*  Hook calls                                  */
/* -------------------------------------------- */

Hooks.on("init", () => {
  // Override voice modes
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  foundry.av.AVSettings.VOICE_MODES = {
    ALWAYS: "always",
    PTT: "ptt",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  // Register module settings
  registerModuleSettings();

  // Use the Discord-style camera dock in place of Foundry's. Foundry creates
  // the dock once, so switching needs a reload.
  if (
    (game.settings?.get(MODULE_NAME, "allowDiscordStyleUI") ?? true) &&
    (game.settings?.get(MODULE_NAME, "discordStyleUI") ?? true) &&
    !(game.settings?.get(MODULE_NAME, "useExternalAV") ?? false)
  ) {
    (CONFIG.ui as { webrtc: unknown }).webrtc = LiveKitCameraViews;
  }

  // The module's settings are all in the A/V settings window; link to it from
  // Foundry's module settings list
  game.settings?.registerMenu(MODULE_NAME, "avSettings", {
    name: "LIVEKITAVCLIENT.settingsMenu",
    label: "LIVEKITAVCLIENT.settingsMenuLabel",
    hint: "LIVEKITAVCLIENT.settingsMenuHint",
    icon: "fa-solid fa-headset",
    type: LiveKitAVConfig,
    restricted: false,
  });

  // Add renderCameraViews hook after init
  Hooks.on("renderCameraViews", (cameraViews, cameraViewsElement) => {
    if (game.webrtc?.client._liveKitClient) {
      game.webrtc.client._liveKitClient.onRenderCameraViews(
        cameraViews,
        cameraViewsElement,
      );
    }
  });
});

Hooks.on("ready", () => {
  // Add socket listener after ready
  game.socket?.on(
    `module.${MODULE_NAME}`,
    (message: SocketMessage, userId: string) => {
      if (game.webrtc?.client._liveKitClient) {
        game.webrtc.client._liveKitClient.onSocketEvent(message, userId);
      }
    },
  );

  // Override the default settings menu with our own
  // WebRTC Control Menu
  game.settings?.registerMenu("core", "webrtc", {
    name: "WEBRTC.Title",
    label: "WEBRTC.MenuLabel",
    hint: "WEBRTC.MenuHint",
    icon: "fas fa-headset",
    type: LiveKitAVConfig,
    restricted: false,
  });
});

// Add context options on getUserContextOptions
Hooks.on("getUserContextOptions", (playersApp, contextOptions) => {
  // If the WebRTC client is available, call its method to add context options
  if (game.webrtc?.client) {
    game.webrtc.client._liveKitClient.onGetUserContextOptions(
      playersApp,
      contextOptions,
    );
  }
});
