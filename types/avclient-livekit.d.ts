import LiveKitAVClient from "../src/LiveKitAVClient";
/**
 * Interfaces
 */

// LiveKit connection settings
interface LiveKitConnectionSettings {
  serverType?: string;
  url?: string;
  room?: string;
  username?: string;
  password?: string;
}

interface LiveKitServerType {
  key: string;
  label: string;
  details?: string;
  url?: string;
  urlRequired: boolean;
  usernameRequired: boolean;
  passwordRequired: boolean;
  tokenFunction: LiveKitTokenFunction;
}

type LiveKitServerTypes = Record<string, LiveKitServerType>;

type LiveKitTokenFunction = (
  apiKey?: string,
  secretKey?: string,
  roomName: string,
  userName: string,
  metadata: string,
) => Promise<string>;

// Custom foundry socket message
interface SocketMessage {
  action: "breakout" | "connect" | "deafen" | "disconnect" | "render";
  userId?: string;
  breakoutRoom?: string;
  deafened?: boolean;
}

/**
 * Types
 */

type LiveKitSettingsConfig = SettingConfig & {
  id?: string;
  value?: unknown;
  settingType?: string;
  isCheckbox?: boolean;
  isSelect?: boolean;
  isRange?: boolean;
  isNumber?: boolean;
  filePickerType?: string;
};

type BreakoutRoomRegistry = Record<string, string | undefined>;

/** Whether the camera dock floats, and where */
interface DockFloatingState {
  floating: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/**
 * Global settings
 */

// Set game.webrtc.client to LiveKitAVClient
declare global {
  interface WebRTCConfig {
    clientClass: typeof LiveKitAVClient;
  }

  // Add settings for the module
  interface SettingConfig {
    "avclient-livekit.liveKitConnectionSettings": LiveKitConnectionSettings;
    "avclient-livekit.breakoutRoomRegistry": BreakoutRoomRegistry;
    "avclient-livekit.displayConnectionQuality": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.discordStyleUI": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.allowDiscordStyleUI": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.allowKrisp": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.defaultNoiseModel": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
    }>;
    "avclient-livekit.voicePanelPosition": { left: number; top: number } | null;
    "avclient-livekit.dockLayout": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
      choices: Record<string, string>;
    }>;
    "avclient-livekit.dockFloating": DockFloatingState;
    "avclient-livekit.dockFollowSpeaker": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.voicePanelInDock": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.videoBackground": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
      choices: Record<string, string>;
    }>;
    "avclient-livekit.videoBackgroundImage": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
    }>;
    "avclient-livekit.videoBackgroundCustomImage": foundry.data.fields.StringField<{
      initial: string;
    }>;
    "avclient-livekit.userVideoHidden": Record<string, boolean | undefined>;
    "avclient-livekit.userVolumes": Record<string, number | undefined>;
    "avclient-livekit.userLocalMutes": Record<string, boolean | undefined>;
    "avclient-livekit.mutedByDeafen": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.audioMusicMode": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.enhancedNoiseCancellation": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.noiseSuppressionModel": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
    }>;
    "avclient-livekit.audioQualityPreset": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
    }>;
    "avclient-livekit.audioAutoGainControl": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.audioEchoCancellation": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.audioNoiseSuppression": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.audioAutoSensitivity": foundry.data.fields.BooleanField<{
      initial: true;
    }>;
    "avclient-livekit.audioNoiseGateThreshold": foundry.data.fields.NumberField<{
      required: true;
      nullable: false;
      initial: number;
    }>;
    "avclient-livekit.useExternalAV": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.resetRoom": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.debug": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.devMode": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.authServer": foundry.data.fields.StringField<{
      required: true;
      blank: false;
      initial: string;
    }>;
    "avclient-livekit.liveKitTrace": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.forceTurn": foundry.data.fields.BooleanField<{
      initial: false;
    }>;
    "avclient-livekit.tavernPatreonToken": foundry.data.fields.StringField<{
      required: false;
      blank: true;
      initial: string;
    }>;
  }
}
