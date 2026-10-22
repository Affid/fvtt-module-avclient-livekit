import {
  AudioCaptureOptions,
  ConnectionQuality,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalVideoTrack,
  LocalAudioTrack,
  LocalTrack,
  LocalVideoTrack,
  Participant,
  ParticipantEvent,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  RoomOptions,
  ConnectionState,
  Track,
  TrackPublication,
  VideoCaptureOptions,
  VideoPresets43,
  VideoTrack,
  DisconnectReason,
  AudioPresets,
  AudioPreset,
  TrackPublishOptions,
} from "livekit-client";
import {
  NoiseSuppressorFilter,
  isNoiseSuppressionSupported,
  toNoiseCancellationModel,
  DEFAULT_NOISE_SUPPRESSION_MODEL,
  NOISE_SUPPRESSION_SAMPLE_RATE,
  type NoiseCancellationModel,
  type VoiceGateOptions,
} from "./NoiseSuppressorFilter";
import {
  createKrispNoiseFilter,
  isKrispSupported,
  isLiveKitCloud,
  type KrispProcessor,
} from "./KrispNoiseFilter";
import VoiceActivityGate, {
  VoiceGateError,
  type VoiceGateReport,
  type VoiceGateSettings,
} from "./VoiceActivityGate";
import { LANG_NAME, MODULE_NAME } from "./utils/constants";
import {
  applyVideoBackground,
  previewVideoBlur,
  supportsVideoBackground,
  videoBackgroundImageUrl,
  VideoBackgroundImageError,
  type VideoBackground,
} from "./VideoBackground";
import LiveKitAVClient from "./LiveKitAVClient";
import {
  LiveKitServerType,
  LiveKitServerTypes,
  SocketMessage,
} from "../types/avclient-livekit";
import { addContextOptions, breakout } from "./LiveKitBreakout";
import { Logger } from "./utils/logger";
import { getAccessToken, getTavernAccessToken } from "./utils/auth";
import { debounceRefreshView, resumeAudioContext } from "./utils/helpers";
import VoiceControls from "./VoiceControls";
import UserAudioMixer from "./UserAudioMixer";
import AudioSettingsPopover from "./ui/AudioSettingsPopover";
import CameraViewDecorator from "./ui/CameraViewDecorator";
import NoiseModelMenu from "./ui/NoiseModelMenu";
import ConnectionPopover from "./ui/ConnectionPopover";
import PlayersListDecorator from "./ui/PlayersListDecorator";
import UserMenu from "./ui/UserMenu";
import LiveKitCameraViews from "./ui/dock/LiveKitCameraViews";
import VoicePanel from "./ui/VoicePanel";

const log = new Logger();

const NO_AUDIO_PROCESSOR = "none";

/** The ID of the hidden element holding remote users' audio elements */
const AUDIO_CONTAINER_ID = "livekit-audio";

/**
 * Whether the user has ever saved a client setting of this module (rather
 * than using its default). Client settings are kept in local storage.
 */
function isClientSettingStored(key: string): boolean {
  try {
    const storage = game.settings?.storage.get("client") as Storage | undefined;
    return storage?.getItem(`${MODULE_NAME}.${key}`) != null;
  } catch {
    return true;
  }
}

/**
 * The client-side audio processing to run on the local microphone: a noise
 * suppression model, then the voice activity gate.
 */
interface AudioProcessingConfig {
  model?: NoiseCancellationModel;
  gate?: boolean;
}

/**
 * A key identifying a client-side audio processor configuration, used to tell
 * whether the processor on a track needs to be replaced. The gate's settings
 * are not part of it, as they change on the running gate.
 */
function getAudioProcessorKey({ model, gate }: AudioProcessingConfig): string {
  if (!model && !gate) {
    return NO_AUDIO_PROCESSOR;
  }
  return `${model ?? NO_AUDIO_PROCESSOR}|gate:${gate ? "on" : "off"}`;
}

/** A processor that may run a voice activity gate */
interface GatedProcessor {
  gate?: VoiceActivityGate;
}

export enum InitState {
  Uninitialized = "uninitialized",
  Initializing = "initializing",
  Initialized = "initialized",
}

export default class LiveKitClient {
  avMaster: foundry.av.AVMaster;
  liveKitAvClient: LiveKitAVClient;
  settings: foundry.av.AVSettings;
  render: () => void;

  audioBroadcastEnabled = false;
  audioTrack: LocalAudioTrack | null = null;
  audioCaptureParams: string | null = null;
  audioProcessingQueue: Promise<void> = Promise.resolve();
  audioProcessorContext?: AudioContext;
  audioProcessorState: {
    track: LocalAudioTrack;
    key: string;
    verified?: boolean;
  } | null = null;
  failedAudioProcessors = new Set<string>();
  /** The users who are speaking, as LiveKit (or our voice gate) tells */
  private readonly speakingUsers = new Set<string>();
  /** The voice activity gate failed to start; audio is sent without it */
  voiceGateFailed = false;
  private voiceGatePreview?: VoiceGateSettings;
  private readonly voiceGateListeners = new Set<
    (report: VoiceGateReport) => void
  >();
  private gateSpeaking = false;
  krispSupported: boolean | undefined;
  liveKitServerAddress: string | undefined;
  scheduleAudioSourceChange: () => void = () => undefined;
  scheduleAudioProcessingRefresh: () => void = () => undefined;

  // Discord-style interface
  readonly voiceControls = new VoiceControls(this);
  readonly userAudioMixer = new UserAudioMixer(this);
  readonly cameraViewDecorator = new CameraViewDecorator(this);
  readonly userMenu = new UserMenu(this);
  readonly audioSettingsPopover = new AudioSettingsPopover(this);
  readonly noiseModelMenu = new NoiseModelMenu(this);
  readonly connectionPopover = new ConnectionPopover(this);
  readonly playersList = new PlayersListDecorator(this);
  private voicePanelInstance?: VoicePanel;
  breakoutRoom: string | undefined;
  connectionState: ConnectionState = ConnectionState.Disconnected;
  initState: InitState = InitState.Uninitialized;
  liveKitParticipants = new Map<string, Participant>();
  liveKitRoom: Room | null = null;
  screenTracks: LocalTrack[] = [];
  useExternalAV = false;
  videoTrack: LocalVideoTrack | null = null;
  /** The camera background effect failed to start; video is sent without it */
  videoBackgroundFailed = false;
  /** The background image that couldn't be loaded; blur is used instead */
  failedVideoBackgroundImage: string | undefined;
  private videoBackgroundQueue: Promise<void> = Promise.resolve();
  windowClickListener: EventListener | null = null;

  liveKitServerTypes: LiveKitServerTypes = {
    custom: {
      key: "custom",
      label: `${LANG_NAME}.serverTypeCustom`,
      details: `${LANG_NAME}.serverDetailsCustom`,
      urlRequired: true,
      usernameRequired: true,
      passwordRequired: true,
      tokenFunction: getAccessToken,
    },
    tavern: {
      key: "tavern",
      label: `${LANG_NAME}.serverTypeTavern`,
      details: `${LANG_NAME}.serverDetailsTavern`,
      url: "livekit.tavern.at",
      urlRequired: false,
      usernameRequired: false,
      passwordRequired: false,
      tokenFunction: getTavernAccessToken,
    },
  };

  defaultLiveKitServerType = this.liveKitServerTypes.custom;

  constructor(liveKitAvClient: LiveKitAVClient) {
    this.avMaster = liveKitAvClient.master;
    this.liveKitAvClient = liveKitAvClient;
    this.settings = liveKitAvClient.settings;

    this.render = foundry.utils.debounce(
      this.avMaster.render.bind(this.liveKitAvClient),
      2000,
    );
    // Debounce audio re-application so rapidly changing several audio settings
    // (e.g. via the reset button) only updates the track once. Settings that
    // affect publishing re-publish the track; settings that only affect the
    // capture constraints or processor update the existing track in place.
    this.scheduleAudioSourceChange = foundry.utils.debounce(() => {
      this.audioProcessingQueue = this.audioProcessingQueue
        .then(() => this.changeAudioSource(true))
        .catch((error: unknown) => {
          log.error("Error changing audio source:", error);
        });
    }, 300);
    this.scheduleAudioProcessingRefresh = foundry.utils.debounce(() => {
      void this.refreshAudioProcessing(true);
    }, 300);
    Hooks.callAll("liveKitClientAvailable", this);
  }

  /* -------------------------------------------- */
  /*  LiveKit Internal methods                */
  /* -------------------------------------------- */

  addAllParticipants(): void {
    if (!this.liveKitRoom) {
      log.warn(
        "Attempting to add participants before the LiveKit room is available",
      );
      return;
    }

    // Add our user to the participants list
    const userId = game.user?.id;
    if (userId) {
      this.liveKitParticipants.set(userId, this.liveKitRoom.localParticipant);
    }

    // Set up all other users
    this.liveKitRoom.remoteParticipants.forEach(
      (participant: RemoteParticipant) => {
        this.onParticipantConnected(participant);
      },
    );
  }

  addConnectionButtons(element: HTMLElement): void {
    // If useExternalAV is enabled, return
    if (this.useExternalAV) {
      return;
    }

    const connectButton = document.createElement("button");
    connectButton.type = "button";
    connectButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-toggle-off livekit-control connect hidden";
    connectButton.dataset.tooltip = "";
    connectButton.ariaLabel =
      game.i18n?.localize(`${LANG_NAME}.connect`) ?? "connect";

    const disconnectButton = document.createElement("button");
    disconnectButton.type = "button";
    disconnectButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-toggle-on livekit-control disconnect hidden";
    disconnectButton.dataset.tooltip = "";
    disconnectButton.ariaLabel =
      game.i18n?.localize(`${LANG_NAME}.disconnect`) ?? "disconnect";

    connectButton.addEventListener("click", () => {
      connectButton.classList.toggle("disabled", true);
      this.avMaster.connect().catch((error: unknown) => {
        log.error("Error connecting:", error);
      });
    });
    element.before(connectButton);

    disconnectButton.addEventListener("click", () => {
      disconnectButton.classList.toggle("disabled", true);
      this.avMaster
        .disconnect()
        .then(() => {
          this.render();
        })
        .catch((error: unknown) => {
          log.error("Error disconnecting:", error);
        });
    });
    element.before(disconnectButton);

    if (this.liveKitRoom?.state === ConnectionState.Connected) {
      disconnectButton.classList.toggle("hidden", false);
    } else {
      connectButton.classList.toggle("hidden", false);
    }
  }

  /**
   * Add a noise cancellation model selector button to the user's camera control
   * bar. Clicking the button opens a small menu letting the user pick a noise
   * suppression model or turn it off ("None"). The button is only added when
   * the filters are supported by the current browser.
   * @param {HTMLElement} element   The element to insert the button before
   */
  addNoiseCancellationButton(element: HTMLElement): void {
    // If useExternalAV is enabled, return
    if (this.useExternalAV) {
      return;
    }

    // Don't add the button if the browser doesn't support the noise filter
    if (!isNoiseSuppressionSupported()) {
      return;
    }

    // Close a menu left open against a button from a previous render
    this.noiseModelMenu.close();

    const noiseButton = document.createElement("button");
    noiseButton.type = "button";
    noiseButton.className =
      "av-control inline-control toggle icon fa-solid fa-fw fa-wand-magic-sparkles livekit-control livekit-noise-control";
    noiseButton.dataset.tooltip = "";
    this.updateNoiseModelButton(noiseButton);

    noiseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.noiseModelMenu.toggle(noiseButton);
    });
    element.before(noiseButton);
  }

  /**
   * Update the noise model button's active state and tooltip to reflect the
   * current settings.
   * @param {HTMLElement} button   The noise model selector button
   */
  updateNoiseModelButton(button: HTMLElement): void {
    const model = this.getSelectedNoiseModel();
    button.classList.toggle("active", model !== "none");

    const title =
      game.i18n?.localize(`${LANG_NAME}.noiseSuppressionModel`) ??
      "Noise cancellation";
    let label = this.getNoiseModelLabel(model);
    // Show what is running instead when the selection isn't available
    const runningModel = this.getAudioProcessingConfig().model ?? "none";
    if (model !== "none" && runningModel !== model) {
      label += ` → ${this.getNoiseModelLabel(runningModel)}`;
    }
    button.ariaLabel = `${title}: ${label}`;
  }

  /**
   * The noise cancellation model selected in the settings, or "none" when
   * enhanced noise cancellation is turned off. This may differ from the model
   * actually running (see getAudioProcessingConfig).
   */
  getSelectedNoiseModel(): NoiseCancellationModel | "none" {
    // Players who never picked a model use the GM's default
    if (
      !isClientSettingStored("enhancedNoiseCancellation") &&
      !isClientSettingStored("noiseSuppressionModel")
    ) {
      return this.getDefaultNoiseModel();
    }
    if (
      !(game.settings?.get(MODULE_NAME, "enhancedNoiseCancellation") ?? false)
    ) {
      return "none";
    }
    return toNoiseCancellationModel(
      game.settings?.get(MODULE_NAME, "noiseSuppressionModel"),
    );
  }

  /**
   * The noise cancellation model the GM chose for players who haven't picked
   * one.
   */
  getDefaultNoiseModel(): NoiseCancellationModel | "none" {
    const model = game.settings?.get(MODULE_NAME, "defaultNoiseModel");
    return model === "none" ? "none" : toNoiseCancellationModel(model);
  }

  /**
   * Whether the Krisp noise filter can be used: the room must be connected to
   * a LiveKit Cloud server and the browser must support the filter.
   */
  isKrispAvailable(): boolean {
    return (
      (game.settings?.get(MODULE_NAME, "allowKrisp") ?? true) &&
      this.krispSupported === true &&
      isLiveKitCloud(this.liveKitRoom, this.liveKitServerAddress)
    );
  }

  /**
   * Check (once) whether this browser supports the Krisp noise filter. This
   * loads the filter, so it is only done once connected to LiveKit Cloud.
   */
  private async checkKrispSupport(): Promise<void> {
    if (this.krispSupported !== undefined) {
      return;
    }
    this.krispSupported = await isKrispSupported();
    if (!this.krispSupported && this.getSelectedNoiseModel() === "krisp") {
      ui.notifications?.warn(
        game.i18n?.format(`${LANG_NAME}.krispUnsupportedFallback`, {
          fallback: this.getNoiseModelLabel(DEFAULT_NOISE_SUPPRESSION_MODEL),
        }) ?? "krispUnsupportedFallback",
      );
    }
  }

  /**
   * Localize the label for a noise cancellation model (or "none").
   */
  getNoiseModelLabel(model: NoiseCancellationModel | "none"): string {
    const key = `${LANG_NAME}.noiseSuppressionModel${
      model.charAt(0).toUpperCase() + model.slice(1)
    }`;
    return game.i18n?.localize(key) ?? model;
  }

  /**
   * The noise cancellation models to offer, with their labels and whether
   * they can be selected. Krisp is only offered on LiveKit Cloud, but is still
   * listed (as unavailable) if it is the saved selection.
   */
  getNoiseModelOptions(): {
    model: NoiseCancellationModel | "none";
    label: string;
    detail?: string;
    selectable: boolean;
    selected: boolean;
  }[] {
    const currentModel = this.getSelectedNoiseModel();
    const isCloud = isLiveKitCloud(this.liveKitRoom, this.liveKitServerAddress);
    const models: (NoiseCancellationModel | "none")[] = [
      "none",
      "speex",
      "rnnoise",
      "gtcrn",
    ];
    if (isCloud || currentModel === "krisp") {
      models.push("krisp");
    }
    return models.map((model) => {
      let detail: string | undefined;
      if (
        model === "krisp" &&
        !(game.settings?.get(MODULE_NAME, "allowKrisp") ?? true)
      ) {
        detail = game.i18n?.localize(`${LANG_NAME}.krispDisabledByGM`);
      } else if (model === "krisp" && !isCloud) {
        detail = game.i18n?.localize(`${LANG_NAME}.krispRequiresCloud`);
      } else if (model === "krisp" && this.krispSupported === false) {
        detail = game.i18n?.localize(`${LANG_NAME}.krispUnsupported`);
      }
      return {
        model,
        label: this.getNoiseModelLabel(model),
        detail,
        selectable: detail === undefined,
        selected: model === currentModel,
      };
    });
  }

  /**
   * Apply a noise model selection. Selecting "none" disables enhanced noise
   * cancellation; selecting a model enables it and sets the active model.
   */
  async selectNoiseModel(
    model: NoiseCancellationModel | "none",
  ): Promise<void> {
    if (model === "none") {
      await game.settings?.set(MODULE_NAME, "enhancedNoiseCancellation", false);
      return;
    }

    await game.settings?.set(MODULE_NAME, "noiseSuppressionModel", model);
    if (
      !(game.settings?.get(MODULE_NAME, "enhancedNoiseCancellation") ?? false)
    ) {
      await game.settings?.set(MODULE_NAME, "enhancedNoiseCancellation", true);
    }
  }

  /**
   * Reset all noise-related client settings to their defaults. This clears any
   * stale saved state (for example an old model that is no longer offered). The
   * settings' onChange handlers coalesce into a single debounced refresh.
   */
  async resetNoiseSettings(): Promise<void> {
    await this.selectNoiseModel(this.getDefaultNoiseModel());
    await game.settings?.set(MODULE_NAME, "audioAutoGainControl", true);
    await game.settings?.set(MODULE_NAME, "audioEchoCancellation", true);
    await game.settings?.set(MODULE_NAME, "audioNoiseSuppression", true);
    await game.settings?.set(MODULE_NAME, "audioAutoSensitivity", true);
    await game.settings?.set(MODULE_NAME, "audioNoiseGateThreshold", -50);
  }

  /**
   * Refresh the noise suppression controls after a noise setting changed.
   */
  onNoiseSettingsChanged(): void {
    for (const button of document.querySelectorAll<HTMLElement>(
      ".livekit-noise-control",
    )) {
      this.updateNoiseModelButton(button);
    }
    this.onVoiceStateChanged();
  }

  /**
   * The Discord-style voice panel. It is created on first use, once Foundry's
   * localization is available.
   */
  get voicePanelIfCreated(): VoicePanel | undefined {
    return this.voicePanelInstance;
  }

  get voicePanel(): VoicePanel {
    this.voicePanelInstance ??= new VoicePanel(this);
    return this.voicePanelInstance;
  }

  /**
   * Turn the Discord-style interface on or off to match its setting.
   */
  applyDiscordStyle(): void {
    const enabled =
      (game.settings?.get(MODULE_NAME, "allowDiscordStyleUI") ?? true) &&
      (game.settings?.get(MODULE_NAME, "discordStyleUI") ?? true) &&
      !this.useExternalAV;
    document.body.classList.toggle("livekit-discord-ui", enabled);
    if (!enabled) {
      this.userMenu.close();
      this.audioSettingsPopover.close();
      this.connectionPopover.close();
    }
    this.playersList.refresh();
    this.voicePanel.sync();
    this.cameraViewDecorator.refreshAll();
  }

  /**
   * Refresh the interface after a user's voice state changed (mute, deafen,
   * tracks, noise suppression). Without a user, everyone is refreshed.
   */
  onVoiceStateChanged(userId?: string): void {
    if (userId) {
      this.userAudioMixer.apply(userId);
      this.cameraViewDecorator.refresh(userId);
    } else {
      this.userAudioMixer.applyAll();
      this.cameraViewDecorator.refreshAll();
    }
    this.playersList.refresh(userId);
    this.dock?.refresh();
    this.voicePanelInstance?.update();
  }

  /**
   * The Discord-style camera dock, when it is Foundry's camera dock.
   */
  get dock(): LiveKitCameraViews | undefined {
    return ui.webrtc instanceof LiveKitCameraViews ? ui.webrtc : undefined;
  }

  isUserSpeaking(userId: string): boolean {
    return this.speakingUsers.has(userId);
  }

  /**
   * Whether a user's microphone is muted or off. Users we have no LiveKit
   * participant for are not shown as muted, since we don't know.
   */
  isUserMuted(userId: string): boolean {
    if (userId === game.user?.id) {
      return this.voiceControls.isMuted() || !this.audioTrack;
    }
    const participant = this.liveKitParticipants.get(userId);
    if (!(participant instanceof RemoteParticipant)) {
      return false;
    }
    const publication = participant.getTrackPublication(
      Track.Source.Microphone,
    );
    return !publication || publication.isMuted;
  }

  /**
   * The round trip time to the server, in milliseconds, from the statistics
   * of the microphone, or of the camera while the microphone sends nothing
   * (e.g. with push to talk).
   */
  async getPingMs(): Promise<number | undefined> {
    const audio = await this.audioTrack?.getSenderStats();
    let rtt = audio?.roundTripTime;
    if (rtt === undefined) {
      const video = await this.videoTrack?.getSenderStats();
      rtt = video?.find(
        (layer) => layer.roundTripTime !== undefined,
      )?.roundTripTime;
    }
    return rtt === undefined ? undefined : Math.round(rtt * 1000);
  }

  /**
   * The codec the microphone is sent with, e.g. "Opus", or "Opus with
   * redundancy" when LiveKit sends each packet twice (RED).
   */
  getAudioCodec(): string | undefined {
    const codecs = this.audioTrack?.sender?.getParameters().codecs ?? [];
    const name = (codec: RTCRtpCodecParameters | undefined) => {
      const subtype = codec?.mimeType.replace(/^audio\//, "");
      return subtype?.toLowerCase() === "opus" ? "Opus" : subtype;
    };
    const first = codecs.at(0);
    if (first?.mimeType.toLowerCase() === "audio/red") {
      return (
        game.i18n?.format(`${LANG_NAME}.audioCodecRed`, {
          codec: name(codecs.at(1)) ?? "Opus",
        }) ?? "RED"
      );
    }
    return name(first);
  }

  /**
   * Whether a user's camera is sending video.
   */
  isUserVideoOn(userId: string): boolean {
    const track =
      userId === game.user?.id
        ? this.videoTrack
        : this.getUserVideoTrack(userId);
    return !!track && !track.isMuted;
  }

  addConnectionQualityIndicator(userId: string): void {
    if (!game.settings?.get(MODULE_NAME, "displayConnectionQuality")) {
      // Connection quality indicator is not enabled
      return;
    }

    // Get the user camera view and player name bar
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${userId}"]`,
    );
    const userNameBar = userCameraView?.querySelector(".player-name");

    if (userCameraView?.querySelector(".connection-quality-indicator")) {
      // Connection quality indicator already exists
      return;
    }

    const connectionQualityIndicator = $(
      `<div class="connection-quality-indicator unknown" title="${
        game.i18n?.localize(
          `${LANG_NAME}.connectionQuality.${ConnectionQuality.Unknown}`,
        ) ?? "Connectin Quality Unknown"
      }"></div>`,
    );

    if (userNameBar instanceof Element) {
      $(userNameBar).after(connectionQualityIndicator);
    }

    this.setConnectionQualityIndicator(userId);
  }

  addLiveKitServerType(liveKitServerType: LiveKitServerType): boolean {
    if (!this.isLiveKitServerType(liveKitServerType)) {
      log.error(
        "Attempted to add a LiveKitServerType that does not meet the requirements:",
        liveKitServerType,
      );
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.liveKitServerTypes[liveKitServerType.key] !== undefined) {
      log.error(
        "Attempted to add a LiveKitServerType with a key that already exists:",
        liveKitServerType,
      );
      return false;
    }
    this.liveKitServerTypes[liveKitServerType.key] = liveKitServerType;
    return true;
  }

  async attachAudioTrack(
    userId: string,
    userAudioTrack: RemoteAudioTrack,
    audioElement: HTMLAudioElement,
  ): Promise<void> {
    if (userAudioTrack.attachedElements.includes(audioElement)) {
      log.debug(
        "Audio track",
        userAudioTrack,
        "already attached to element",
        audioElement,
        "; skipping",
      );
      return;
    }

    // Set audio output device
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (audioElement.sinkId === undefined) {
      log.warn("Your web browser does not support output audio sink selection");
    } else {
      const requestedSink = this.settings.get("client", "audioSink");
      // @ts-expect-error - setSinkId is currently an experimental method and not in the defined types
      await audioElement.setSinkId(requestedSink).catch((error: unknown) => {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error(
          "An error occurred when requesting the output audio device:",
          requestedSink,
          message,
        );
      });
    }

    // Detach from any existing elements
    userAudioTrack.detach();

    // Attach the audio track
    userAudioTrack.attach(audioElement);

    // Set the parameters
    let userVolume = this.settings.getUser(userId)?.volume;
    if (typeof userVolume === "undefined") {
      userVolume = 1.0;
    }
    audioElement.volume = userVolume;
    audioElement.muted = this.settings.get("client", "muteAll") === true;

    // Apply the per-user volume, local mute, and deafen state
    this.userAudioMixer.apply(userId);
  }

  attachVideoTrack(
    userVideoTrack: VideoTrack,
    videoElement: HTMLVideoElement,
  ): void {
    if (userVideoTrack.attachedElements.includes(videoElement)) {
      log.debug(
        "Video track",
        userVideoTrack,
        "already attached to element",
        videoElement,
        "; skipping",
      );
      return;
    }

    // Detach from any existing elements
    userVideoTrack.detach();

    // Attach to the video element
    userVideoTrack.attach(videoElement);
  }

  async changeAudioSource(forceStop = false): Promise<void> {
    // Force the stop of an existing track
    if (forceStop && this.audioTrack) {
      await this.liveKitRoom?.localParticipant.unpublishTrack(this.audioTrack);
      this.audioTrack.stop();
      this.audioTrack = null;
      game.user?.broadcastActivity({ av: { muted: true } });
    }

    if (
      !this.audioTrack ||
      this.settings.get("client", "audioSrc") === "disabled" ||
      !this.avMaster.canUserBroadcastAudio(game.user?.id ?? "")
    ) {
      if (this.audioTrack) {
        await this.liveKitRoom?.localParticipant.unpublishTrack(
          this.audioTrack,
        );
        this.audioTrack.stop();
        this.audioTrack = null;
        game.user?.broadcastActivity({ av: { muted: true } });
      } else {
        await this.initializeAudioTrack();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.audioTrack) {
          await this.liveKitRoom?.localParticipant.publishTrack(
            this.audioTrack,
            this.trackPublishOptions,
          );
          // Some processors (Krisp) can only be verified once published
          await this.applyAudioProcessors(this.audioTrack);
          game.user?.broadcastActivity({ av: { muted: false } });
          this.avMaster.render();
        }
      }
    } else {
      const audioParams = this.getAudioParams();
      if (audioParams) {
        await this.audioTrack.restartTrack(audioParams);
        this.audioCaptureParams = JSON.stringify(audioParams);
      }
    }
  }

  async changeVideoSource(): Promise<void> {
    if (
      !this.videoTrack ||
      this.settings.get("client", "videoSrc") === "disabled" ||
      !this.avMaster.canUserBroadcastVideo(game.user?.id ?? "")
    ) {
      if (this.videoTrack) {
        await this.liveKitRoom?.localParticipant.unpublishTrack(
          this.videoTrack,
        );
        this.videoTrack.detach();
        this.videoTrack.stop();
        this.videoTrack = null;
        game.user?.broadcastActivity({ av: { hidden: true } });
      } else {
        await this.initializeVideoTrack();
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (this.videoTrack) {
          await this.liveKitRoom?.localParticipant.publishTrack(
            this.videoTrack,
            this.trackPublishOptions,
          );
          const userVideoElement = this.getUserVideoElement(
            game.user?.id ?? "",
          );
          if (userVideoElement) {
            this.attachVideoTrack(this.videoTrack, userVideoElement);
          }
          game.user?.broadcastActivity({ av: { hidden: false } });
          this.avMaster.render();
        }
      }
    } else {
      const videoParams = this.getVideoParams();
      if (videoParams) {
        await this.videoTrack.restartTrack(videoParams);
      }
    }
  }

  getAudioParams(): AudioCaptureOptions | false {
    // Determine whether the user can send audio
    const audioSrc = this.settings.get("client", "audioSrc");
    const canBroadcastAudio = this.avMaster.canUserBroadcastAudio(
      game.user?.id ?? "",
    );

    if (
      typeof audioSrc !== "string" ||
      audioSrc === "disabled" ||
      !canBroadcastAudio
    ) {
      return false;
    }

    const audioCaptureOptions: AudioCaptureOptions = {
      deviceId: { ideal: audioSrc },
      channelCount: { ideal: 1 },
    };

    // Set audio parameters for music streaming mode
    if (game.settings?.get(MODULE_NAME, "audioMusicMode")) {
      audioCaptureOptions.autoGainControl = false;
      audioCaptureOptions.echoCancellation = false;
      audioCaptureOptions.noiseSuppression = false;
      audioCaptureOptions.channelCount = { ideal: 2 };
    } else {
      // Apply user-configurable WebRTC audio processing constraints
      audioCaptureOptions.autoGainControl =
        game.settings?.get(MODULE_NAME, "audioAutoGainControl") ?? true;
      audioCaptureOptions.echoCancellation =
        game.settings?.get(MODULE_NAME, "audioEchoCancellation") ?? true;
      audioCaptureOptions.noiseSuppression =
        game.settings?.get(MODULE_NAME, "audioNoiseSuppression") ?? true;

      // When a noise suppression model will run, disable the browser's native
      // noise suppression to avoid double-processing the audio. The processor
      // itself is attached in applyAudioProcessors.
      const { model } = this.getAudioProcessingConfig();
      if (model) {
        audioCaptureOptions.noiseSuppression = false;
      }
    }

    return audioCaptureOptions;
  }

  getParticipantFVTTUser(participant: Participant): User | undefined {
    const { fvttUserId } = JSON.parse(participant.metadata ?? "{}") as {
      fvttUserId: string;
    };
    return game.users?.get(fvttUserId);
  }

  getParticipantUseExternalAV(participant: Participant): boolean {
    const { useExternalAV } = JSON.parse(
      participant.metadata ?? "{ false }",
    ) as {
      useExternalAV: boolean;
    };
    return useExternalAV;
  }

  getUserAudioTrack(
    userId: string | undefined,
  ): LocalAudioTrack | RemoteAudioTrack | null {
    let audioTrack: LocalAudioTrack | RemoteAudioTrack | null = null;

    // If the user ID is null, return a null track
    if (!userId) {
      return audioTrack;
    }

    this.liveKitParticipants
      .get(userId)
      ?.audioTrackPublications.forEach((publication) => {
        if (
          publication.kind === Track.Kind.Audio &&
          (publication.track instanceof LocalAudioTrack ||
            publication.track instanceof RemoteAudioTrack)
        ) {
          audioTrack = publication.track;
        }
      });
    return audioTrack;
  }

  getUserStatistics(userId: string): string {
    const participant = this.liveKitParticipants.get(userId);
    let totalBitrate = 0;
    if (!participant) {
      return "";
    }

    for (const t of participant.trackPublications.values()) {
      if (t.track) {
        totalBitrate += t.track.currentBitrate;
      }
    }
    let bitrate = "";
    if (totalBitrate > 0) {
      bitrate = `${Math.round(totalBitrate / 1024).toLocaleString()} kbps`;
    }

    return bitrate;
  }

  getAllUserStatistics(): Map<string, string> {
    const userStatistics = new Map<string, string>();
    this.liveKitParticipants.forEach((_participant, userId) => {
      userStatistics.set(userId, this.getUserStatistics(userId));
    });
    return userStatistics;
  }

  getUserVideoTrack(
    userId: string | undefined,
  ): LocalVideoTrack | RemoteVideoTrack | null {
    let videoTrack: LocalVideoTrack | RemoteVideoTrack | null = null;

    // If the user ID is null, return a null track
    if (!userId) {
      return videoTrack;
    }

    this.liveKitParticipants
      .get(userId)
      ?.videoTrackPublications.forEach((publication) => {
        if (
          publication.kind === Track.Kind.Video &&
          (publication.track instanceof LocalVideoTrack ||
            publication.track instanceof RemoteVideoTrack)
        ) {
          videoTrack = publication.track;
        }
      });
    return videoTrack;
  }

  /**
   * Obtain a reference to the video.user-audio which plays the audio channel for a requested
   * Foundry User.
   * If the element doesn't exist, but a video element does, it will create it.
   * @param {string} userId                   The ID of the User entity
   * @param {HTMLVideoElement} videoElement   The HTMLVideoElement of the user
   * @return {HTMLAudioElement|null}
   */
  /**
   * The audio element playing one of a user's audio tracks. Audio elements
   * live in a hidden container of their own rather than in the camera views,
   * so re-rendering, hiding, or moving a camera view never interrupts audio.
   * @param _videoElement   Not used; kept for compatibility
   */
  getUserAudioElement(
    userId: string,
    _videoElement: HTMLVideoElement | null,
    audioType: Track.Source,
  ): HTMLAudioElement {
    let container = document.getElementById(AUDIO_CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = AUDIO_CONTAINER_ID;
      container.hidden = true;
      document.body.append(container);
    }
    let audioElement = container.querySelector<HTMLAudioElement>(
      `audio[data-user="${userId}"][data-source="${audioType}"]`,
    );
    if (!audioElement) {
      audioElement = document.createElement("audio");
      audioElement.className = `user-${audioType}-audio`;
      audioElement.dataset.user = userId;
      audioElement.dataset.source = audioType;
      audioElement.autoplay = true;
      container.append(audioElement);
    }
    return audioElement;
  }

  /**
   * All of a user's audio elements (see getUserAudioElement).
   */
  getUserAudioElements(userId: string): HTMLAudioElement[] {
    return [
      ...document.querySelectorAll<HTMLAudioElement>(
        `#${AUDIO_CONTAINER_ID} audio[data-user="${userId}"]`,
      ),
    ];
  }

  /**
   * The video element of a user's camera view, if it is rendered.
   */
  getUserVideoElement(userId: string): HTMLVideoElement | null {
    const camera = ui.webrtc as unknown as
      | { getUserVideoElement?: (userId: string) => HTMLVideoElement | null }
      | undefined;
    return camera?.getUserVideoElement?.(userId) ?? null;
  }

  async initializeLocalTracks(): Promise<void> {
    await this.initializeAudioTrack();
    await this.initializeVideoTrack();
  }

  async initializeAudioTrack(): Promise<void> {
    // Make sure the track is initially unset
    this.audioTrack = null;

    // Get audio parameters
    const audioParams = this.getAudioParams();

    // Get the track if requested
    if (audioParams) {
      try {
        this.audioTrack = await createLocalAudioTrack(audioParams);
        this.audioCaptureParams = JSON.stringify(audioParams);
        await this.applyAudioProcessors(this.audioTrack);
      } catch (error: unknown) {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error("Unable to acquire local audio:", message);
      }
    }

    // Check that mute/hidden/broadcast is toggled properly for the track
    if (
      this.audioTrack &&
      !(
        this.liveKitAvClient.isVoiceAlways &&
        this.avMaster.canUserShareAudio(game.user?.id ?? "")
      )
    ) {
      await this.audioTrack.mute();
    }
  }

  /**
   * Lazily create (and reuse) a 48kHz AudioContext used by the client-side
   * audio processors. RNNoise requires a 48kHz sample rate; the other noise
   * suppression models and the noise gate support it as well, so a single
   * 48kHz context works for all of them. It is intentionally kept alive between
   * tracks and is not closed by the processors themselves.
   */
  getAudioProcessorContext(): AudioContext {
    if (
      !this.audioProcessorContext ||
      this.audioProcessorContext.state === "closed"
    ) {
      this.audioProcessorContext = new AudioContext({
        sampleRate: NOISE_SUPPRESSION_SAMPLE_RATE,
      });
      // Audio flows once the context is running
      resumeAudioContext(this.audioProcessorContext);
    }
    return this.audioProcessorContext;
  }

  /**
   * Determine which client-side audio processing should run on the local
   * microphone, based on the settings, browser and server support, and any
   * processors that previously failed to start.
   *
   * Krisp falls back to the default open-source model when it isn't available
   * (not on LiveKit Cloud, unsupported browser, or it failed to start), and any
   * failed configuration falls back to no processing.
   */
  getAudioProcessingConfig(): AudioProcessingConfig {
    if (
      (game.settings?.get(MODULE_NAME, "audioMusicMode") ?? false) ||
      !isNoiseSuppressionSupported()
    ) {
      return {};
    }

    const selectedModel = this.getSelectedNoiseModel();
    // The gate decides when to send audio in Voice Activity mode; with push
    // to talk, the key does
    const gate =
      this.settings.get("client", "voice.mode") === "always" &&
      !this.voiceGateFailed;

    const candidates: AudioProcessingConfig[] = [];
    if (selectedModel === "krisp") {
      if (this.isKrispAvailable()) {
        candidates.push({ model: "krisp", gate });
      }
      candidates.push({ model: DEFAULT_NOISE_SUPPRESSION_MODEL, gate });
    } else {
      candidates.push({
        model: selectedModel === "none" ? undefined : selectedModel,
        gate,
      });
    }

    return (
      candidates.find(
        (config) =>
          !this.failedAudioProcessors.has(getAudioProcessorKey(config)),
      ) ?? {}
    );
  }

  /**
   * Restart the microphone capture if the capture constraints (auto gain
   * control, echo cancellation, browser noise suppression) have changed.
   */
  private async restartAudioCapture(track: LocalAudioTrack): Promise<void> {
    const audioParams = this.getAudioParams();
    if (!audioParams) {
      return;
    }
    const serializedParams = JSON.stringify(audioParams);
    if (serializedParams === this.audioCaptureParams) {
      return;
    }
    await track.restartTrack(audioParams);
    this.audioCaptureParams = serializedParams;
  }

  /**
   * Attach (or remove) the client-side audio TrackProcessor on a local audio
   * track so it matches getAudioProcessingConfig. LiveKit allows a single
   * processor per track, so the noise gate and the noise suppression model are
   * chained inside one processor. Nothing is done if the right processor is
   * already in place.
   *
   * If the processor fails to start, it is remembered as failed and the next
   * best option is applied instead: an open-source model after Krisp, or the
   * browser's own noise suppression (which was turned off in favor of the
   * model).
   */
  private async applyAudioProcessors(track: LocalAudioTrack): Promise<void> {
    const config = this.getAudioProcessingConfig();
    const key = getAudioProcessorKey(config);
    const isCurrent =
      this.audioProcessorState?.track === track &&
      this.audioProcessorState.key === key;

    if (key === NO_AUDIO_PROCESSOR) {
      if (!isCurrent && track.getProcessor()) {
        await track.stopProcessor();
      }
      this.audioProcessorState = { track, key };
      return;
    }

    try {
      if (!isCurrent) {
        // LiveKit requires an AudioContext to be set on the track before a
        // processor can be attached, so we provide our own 48kHz context here.
        track.setAudioContext(this.getAudioProcessorContext());
        const gate: VoiceGateOptions | undefined = config.gate
          ? {
              settings: this.getVoiceGateSettings(),
              onReport: this.onVoiceGateReport,
            }
          : undefined;
        await track.setProcessor(
          config.model === "krisp"
            ? await createKrispNoiseFilter(gate)
            : new NoiseSuppressorFilter({ model: config.model, gate }),
        );
        this.audioProcessorState = { track, key };
        log.info("Audio processor applied to local audio track:", key);
      }
      if (config.model === "krisp") {
        await this.verifyKrispNoiseFilter(track);
      }
    } catch (error: unknown) {
      log.error("Error applying audio processor", key, error);
      this.audioProcessorState = { track, key: NO_AUDIO_PROCESSOR };
      if (track.getProcessor()) {
        await track.stopProcessor();
      }

      if (error instanceof VoiceGateError) {
        // Keep the noise suppression model, without the gate
        this.voiceGateFailed = true;
        ui.notifications?.warn(`${LANG_NAME}.voiceGateFailed`, {
          localize: true,
        });
      } else {
        this.failedAudioProcessors.add(key);
        const fallbackModel = this.getAudioProcessingConfig().model;
        ui.notifications?.warn(
          game.i18n?.format(`${LANG_NAME}.noiseSuppressionFailed`, {
            model: this.getNoiseModelLabel(config.model ?? "none"),
            fallback: fallbackModel
              ? this.getNoiseModelLabel(fallbackModel)
              : game.i18n.localize(`${LANG_NAME}.noiseSuppressionBrowser`),
          }) ?? "noiseSuppressionFailed",
        );
      }

      // Apply the fallback. This terminates: every failure adds to the failed
      // set, and no processing at all cannot fail.
      await this.restartAudioCapture(track);
      await this.applyAudioProcessors(track);
    }
  }

  /**
   * Make sure the Krisp filter on a published track is actually enabled.
   * Krisp enables itself once the track is published, after LiveKit Cloud has
   * confirmed it may be used; if that fails it silently passes the audio
   * through unprocessed, so check and throw to trigger the fallback.
   */
  private async verifyKrispNoiseFilter(track: LocalAudioTrack): Promise<void> {
    if (!track.sid || this.audioProcessorState?.verified) {
      // Not published yet: this is checked again after publishing
      return;
    }
    const processor = track.getProcessor() as KrispProcessor | undefined;
    // Resolves to undefined if it was already enabled
    if ((await processor?.setEnabled(true)) === false) {
      throw new Error("The Krisp noise filter could not be enabled");
    }
    if (this.audioProcessorState?.track === track) {
      this.audioProcessorState.verified = true;
    }
  }

  /**
   * Re-apply the audio processing settings to the current local audio track
   * without republishing it: the microphone is only restarted when its capture
   * constraints change, and the processor is only replaced when it changes.
   * Calls are serialized so overlapping setting changes can't race.
   * @param {boolean} retryFailed   Retry processors that previously failed
   */
  refreshAudioProcessing(retryFailed = false): Promise<void> {
    const refresh = async () => {
      if (retryFailed) {
        this.failedAudioProcessors.clear();
        this.voiceGateFailed = false;
      }
      const track = this.audioTrack;
      if (!track) {
        return;
      }

      // Remove a processor that is about to be replaced before restarting the
      // capture, so it isn't needlessly restarted along with the microphone
      const key = getAudioProcessorKey(this.getAudioProcessingConfig());
      if (
        track.getProcessor() &&
        !(
          this.audioProcessorState?.track === track &&
          this.audioProcessorState.key === key
        )
      ) {
        await track.stopProcessor();
        this.audioProcessorState = { track, key: NO_AUDIO_PROCESSOR };
      }

      await this.restartAudioCapture(track);
      await this.applyAudioProcessors(track);
      this.applyVoiceGateSettings();
      this.updateGateSpeaking();
    };

    this.audioProcessingQueue = this.audioProcessingQueue
      .then(refresh)
      .catch((error: unknown) => {
        log.error("Error refreshing audio processing:", error);
      });
    return this.audioProcessingQueue;
  }

  /* -------------------------------------------- */
  /*  Voice activity gate                         */
  /* -------------------------------------------- */

  /**
   * The voice activity gate on the microphone, while one runs (in Voice
   * Activity mode).
   */
  get voiceGate(): VoiceActivityGate | undefined {
    return (this.audioTrack?.getProcessor() as GatedProcessor | undefined)
      ?.gate;
  }

  /**
   * The voice activity gate's settings: the saved ones, or the ones being
   * tried out.
   */
  getVoiceGateSettings(): VoiceGateSettings {
    return (
      this.voiceGatePreview ?? {
        auto: game.settings?.get(MODULE_NAME, "audioAutoSensitivity") ?? true,
        threshold:
          game.settings?.get(MODULE_NAME, "audioNoiseGateThreshold") ?? -50,
      }
    );
  }

  /**
   * Try out voice activity gate settings without saving them, e.g. while the
   * settings window is open. Without settings, the saved ones apply again.
   */
  previewVoiceGate(settings?: VoiceGateSettings): void {
    this.voiceGatePreview = settings;
    this.applyVoiceGateSettings();
  }

  /**
   * Send the current settings to every running gate, including the ones only
   * measuring the level for a meter.
   */
  applyVoiceGateSettings(): void {
    const settings = this.getVoiceGateSettings();
    for (const gate of VoiceActivityGate.instances) {
      gate.configure(settings);
    }
  }

  /**
   * Listen to the reports of the microphone's gate.
   * @returns   A function that stops listening
   */
  onVoiceGateReports(listener: (report: VoiceGateReport) => void): () => void {
    this.voiceGateListeners.add(listener);
    return () => {
      this.voiceGateListeners.delete(listener);
    };
  }

  private readonly onVoiceGateReport = (report: VoiceGateReport) => {
    for (const listener of this.voiceGateListeners) {
      listener(report);
    }
    this.updateGateSpeaking();
  };

  /**
   * While the gate runs, show the local user as speaking while it sends
   * audio, so the speaking ring matches what others hear.
   */
  private updateGateSpeaking(): void {
    const speaking =
      !!this.voiceGate?.isOpen && !!this.audioTrack && !this.audioTrack.isMuted;
    if (speaking !== this.gateSpeaking) {
      this.gateSpeaking = speaking;
      this.onIsSpeakingChanged(game.user?.id, speaking);
    }
  }

  async initializeVideoTrack(): Promise<void> {
    // Make sure the track is initially unset
    this.videoTrack = null;

    // Get video parameters
    const videoParams = this.getVideoParams();

    // Get the track if requested
    if (videoParams) {
      try {
        this.videoTrack = await createLocalVideoTrack(videoParams);
      } catch (error: unknown) {
        let message = error;
        if (error instanceof Error) {
          message = error.message;
        }
        log.error("Unable to acquire local video:", message);
      }
    }

    // Check that mute/hidden/broadcast is toggled properly for the track
    if (
      this.videoTrack &&
      !this.avMaster.canUserShareVideo(game.user?.id ?? "")
    ) {
      await this.videoTrack.mute();
    }

    // The background effect loads in the background rather than holding up
    // the camera; LiveKit swaps in the processed video once it runs
    if (this.videoTrack) {
      void this.updateVideoBackground();
    }
  }

  /**
   * The camera background effect to use: the settings, unless this browser
   * can't run it or it failed to start. An image that couldn't be loaded is
   * replaced by blur, so the background stays hidden.
   */
  getVideoBackground(): VideoBackground {
    const mode = game.settings?.get(MODULE_NAME, "videoBackground");
    if (
      (mode !== "blur" && mode !== "image") ||
      this.videoBackgroundFailed ||
      !supportsVideoBackground()
    ) {
      return { mode: "none" };
    }
    const quality =
      game.settings?.get(MODULE_NAME, "videoBackgroundQuality") === "standard"
        ? "standard"
        : "high";
    if (mode === "image") {
      const url = videoBackgroundImageUrl(
        game.settings?.get(MODULE_NAME, "videoBackgroundImage") ?? "",
      );
      if (url !== this.failedVideoBackgroundImage) {
        return { mode, url, quality };
      }
    }
    return {
      mode: "blur",
      strength: game.settings?.get(MODULE_NAME, "videoBlurStrength") ?? 0.5,
      quality,
    };
  }

  /**
   * Try a blur strength out while its slider moves, before it is saved.
   */
  previewVideoBlur(strength: number): void {
    previewVideoBlur(this.videoTrack, strength).catch((error: unknown) => {
      log.warn("Error previewing the blur strength:", error);
    });
  }

  /**
   * Put the camera background effect from the settings on the camera track.
   * Calls run one after another, so quick changes apply in order.
   *
   * @param retry   Try again after the effect failed, e.g. because it was
   *                picked again
   */
  updateVideoBackground({ retry = false } = {}): Promise<void> {
    this.videoBackgroundQueue = this.videoBackgroundQueue.then(async () => {
      if (retry) {
        this.videoBackgroundFailed = false;
        this.failedVideoBackgroundImage = undefined;
      }
      const track = this.videoTrack;
      if (!track) {
        return;
      }
      let background = this.getVideoBackground();
      try {
        try {
          await applyVideoBackground(track, background);
        } catch (error: unknown) {
          if (
            !(error instanceof VideoBackgroundImageError) ||
            background.mode !== "image"
          ) {
            throw error;
          }
          log.warn("Unable to load the camera background image:", error);
          this.failedVideoBackgroundImage = background.url;
          ui.notifications?.warn(`${LANG_NAME}.videoBackgroundImageFailed`, {
            localize: true,
          });
          background = this.getVideoBackground();
          await applyVideoBackground(track, background);
        }
        log.info("Camera background applied:", background.mode);
      } catch (error: unknown) {
        log.error("Error applying the camera background", background, error);
        this.videoBackgroundFailed = true;
        await track.stopProcessor().catch((stopError: unknown) => {
          log.warn("Error removing the camera background:", stopError);
        });
        ui.notifications?.warn(`${LANG_NAME}.videoBackgroundFailed`, {
          localize: true,
        });
      }
    });
    return this.videoBackgroundQueue;
  }

  initializeRoom(): void {
    // set the LiveKit publish defaults
    const liveKitPublishDefaults = this.trackPublishOptions;

    // Set the livekit room options
    const liveKitRoomOptions: RoomOptions = {
      adaptiveStream: liveKitPublishDefaults.simulcast,
      dynacast: liveKitPublishDefaults.simulcast,
      publishDefaults: liveKitPublishDefaults,
    };

    // Create and configure the room
    this.liveKitRoom = new Room(liveKitRoomOptions);

    // Set up room callbacks
    this.setRoomCallbacks();
  }

  isLiveKitServerType(
    liveKitServerType: LiveKitServerType,
  ): liveKitServerType is LiveKitServerType {
    if (
      typeof liveKitServerType.key !== "string" ||
      typeof liveKitServerType.label !== "string" ||
      typeof liveKitServerType.urlRequired !== "boolean" ||
      typeof liveKitServerType.usernameRequired !== "boolean" ||
      typeof liveKitServerType.passwordRequired !== "boolean" ||
      !(liveKitServerType.tokenFunction instanceof Function)
    ) {
      return false;
    }
    return true;
  }

  isUserExternal(userId: string): boolean {
    // TODO: Implement this when adding external user support
    log.debug("isUserExternal not yet implemented; userId:", userId);
    return false;
  }

  onAudioPlaybackStatusChanged(canPlayback: boolean): void {
    if (!canPlayback) {
      log.warn("Cannot play audio/video, waiting for user interaction");
      this.windowClickListener =
        this.windowClickListener ?? this.onWindowClick.bind(this);
      window.addEventListener("click", this.windowClickListener);
    }
  }

  async onConnected(): Promise<void> {
    log.debug("Client connected");

    // Set up local participant callbacks
    this.setLocalParticipantCallbacks();

    // Add users to participants list
    this.addAllParticipants();

    // Set connection button state
    this.setConnectionButtons(true);

    // Publish local tracks
    if (this.audioTrack) {
      await this.liveKitRoom?.localParticipant.publishTrack(
        this.audioTrack,
        this.trackPublishOptions,
      );
    }
    if (this.videoTrack) {
      await this.liveKitRoom?.localParticipant.publishTrack(
        this.videoTrack,
        this.trackPublishOptions,
      );
    }

    // Now that the server is known, switch to Krisp if it was selected and
    // this is LiveKit Cloud, or away from it if this server isn't
    if (isLiveKitCloud(this.liveKitRoom, this.liveKitServerAddress)) {
      await this.checkKrispSupport();
    }
    await this.refreshAudioProcessing();

    // Let everyone know if we are deafened
    if (this.voiceControls.isDeafened()) {
      this.voiceControls.broadcastDeafened();
    }
  }

  onConnectionQualityChanged(quality: string, participant: Participant) {
    log.debug("onConnectionQualityChanged:", quality, participant);
    if (participant === this.liveKitRoom?.localParticipant) {
      this.voicePanelInstance?.update();
    }

    if (!game.settings?.get(MODULE_NAME, "displayConnectionQuality")) {
      // Connection quality indicator is not enabled
      return;
    }

    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Quality changed participant",
        participant,
        "is not an FVTT user",
      );
      return;
    }

    this.setConnectionQualityIndicator(fvttUserId, quality);
  }

  onDisconnected(reason?: DisconnectReason): void {
    log.debug("Client disconnected", { reason });
    let disconnectWarning =
      game.i18n?.localize(`${LANG_NAME}.onDisconnected`) ?? "onDisconnected";
    if (reason) {
      disconnectWarning += `: ${DisconnectReason[reason]}`;
    }
    ui.notifications?.warn(disconnectWarning);

    // Clear the participant map. LiveKit tells nothing more about the other
    // participants, so nobody is speaking any more.
    this.liveKitParticipants.clear();
    this.userAudioMixer.stopAll();
    for (const userId of [...this.speakingUsers]) {
      this.onIsSpeakingChanged(userId, false);
    }
    this.playersList.refresh();
    this.dock?.refresh();

    // Set connection buttons state
    this.setConnectionButtons(false);

    this.connectionState = ConnectionState.Disconnected;

    // TODO: Add some incremental back-off reconnect logic here
  }

  onGetUserContextOptions(
    _playersApp: foundry.applications.ui.Players,
    contextOptions: foundry.applications.ux.ContextMenu.Entry<HTMLElement>[],
  ): void {
    // Don't add breakout options if AV is disabled
    if (
      this.settings.get("world", "mode") ===
      foundry.av.AVSettings.AV_MODES.DISABLED
    ) {
      return;
    }

    addContextOptions(contextOptions, this);
  }

  onIsSpeakingChanged(userId: string | undefined, speaking: boolean): void {
    if (!userId) {
      return;
    }
    if (speaking) {
      this.speakingUsers.add(userId);
    } else {
      this.speakingUsers.delete(userId);
    }
    const dock = this.dock;
    if (dock) {
      dock.setSpeaking(userId, speaking);
    } else {
      // @ts-expect-error - ui.webrtc.setUserIsSpeaking is not in foundry-vtt-types yet
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      ui.webrtc?.setUserIsSpeaking(userId, speaking);
      this.cameraViewDecorator.setSpeaking(userId, speaking);
    }
    this.playersList.setSpeaking(userId, speaking);
    if (userId === game.user?.id) {
      this.voicePanelInstance?.setSpeaking(speaking);
    }
  }

  onParticipantConnected(participant: RemoteParticipant): void {
    log.debug("onParticipantConnected:", participant);

    const fvttUser = this.getParticipantFVTTUser(participant);

    if (!fvttUser?.id) {
      log.error(
        "Joining participant",
        participant,
        "is not an FVTT user; cannot display them",
      );
      return;
    }

    if (!fvttUser.active) {
      // Force the user to be active. If they are signing in to meeting, they should be online.
      log.warn(
        "Joining user",
        fvttUser.id,
        "is not listed as active. Setting to active.",
      );
      fvttUser.active = true;
      ui.players?.render().catch((error: unknown) => {
        log.error("Error rendering players view:", error);
      });
    }

    // Save the participant to the ID mapping
    this.liveKitParticipants.set(fvttUser.id, participant);

    // Clear breakout room cache if user is joining the main conference
    if (!this.breakoutRoom) {
      this.settings.set(
        "client",
        `users.${fvttUser.id}.liveKitBreakoutRoom`,
        "",
      );
    }

    // Set up remote participant callbacks
    this.setRemoteParticipantCallbacks(participant);
    this.playersList.refresh(fvttUser.id);

    // Let the new participant know if we are deafened
    if (this.voiceControls.isDeafened()) {
      this.voiceControls.broadcastDeafened();
    }

    // Call a debounced render
    this.render();
  }

  onParticipantDisconnected(participant: RemoteParticipant): void {
    log.debug("onParticipantDisconnected:", participant);

    // Remove the participant from the ID mapping
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn("Leaving participant", participant, "is not an FVTT user");
      return;
    }

    this.liveKitParticipants.delete(fvttUserId);
    for (const audioElement of this.getUserAudioElements(fvttUserId)) {
      audioElement.remove();
    }
    this.onIsSpeakingChanged(fvttUserId, false);
    this.playersList.refresh(fvttUserId);

    // Clear breakout room cache if user is leaving a breakout room
    if (
      this.settings.get("client", `users.${fvttUserId}.liveKitBreakoutRoom`) ===
        this.liveKitAvClient.room &&
      this.liveKitAvClient.room === this.breakoutRoom
    ) {
      this.settings.set(
        "client",
        `users.${fvttUserId}.liveKitBreakoutRoom`,
        "",
      );
    }

    // Call a debounced render
    this.render();
  }

  onReconnected(): void {
    log.info("Reconnect issued");
    // Re-render just in case users changed
    this.render();
    this.voicePanelInstance?.update();
  }

  onReconnecting(): void {
    log.warn("Reconnecting to room");
    ui.notifications?.warn(
      game.i18n?.localize("WEBRTC.ConnectionLostWarning") ??
        "ConnectionLostWarning",
    );
    this.voicePanelInstance?.update();
  }

  onSocketEvent(message: SocketMessage, userId: string): void {
    log.debug("Socket event:", message, "from:", userId);
    switch (message.action) {
      case "breakout":
        // Allow only GMs to issue breakout requests. Ignore requests that aren't for us.
        if (
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          game.users?.get(userId)?.isGM &&
          (!message.userId || message.userId === game.user.id)
        ) {
          breakout(message.breakoutRoom, this);
        }
        break;
      case "connect":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.avMaster.connect().catch((error: unknown) => {
            log.error("Error connecting:", error);
          });
        } else {
          log.warn("Connect socket event from non-GM user; ignoring");
        }
        break;
      case "disconnect":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.avMaster
            .disconnect()
            .then(() => {
              this.render();
            })
            .catch((error: unknown) => {
              log.error("Error disconnecting:", error);
            });
        } else {
          log.warn("Disconnect socket event from non-GM user; ignoring");
        }
        break;
      case "deafen":
        this.voiceControls.onRemoteDeafened(userId, message.deafened === true);
        break;
      case "render":
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (game.users?.get(userId)?.isGM) {
          this.render();
        } else {
          log.warn("Render socket event from non-GM user; ignoring");
        }
        break;
      default:
        log.warn("Unknown socket event:", message);
    }
  }

  onTrackMuteChanged(
    publication: TrackPublication,
    participant: Participant,
  ): void {
    log.debug("onTrackMuteChanged:", publication, participant);

    const mutedUserId =
      participant === this.liveKitRoom?.localParticipant
        ? game.user?.id
        : this.getParticipantFVTTUser(participant)?.id;
    if (mutedUserId) {
      this.onVoiceStateChanged(mutedUserId);
    }

    // Local participant
    if (participant === this.liveKitRoom?.localParticipant) {
      log.debug("Local", publication.kind, "track muted:", publication.isMuted);
      return;
    }

    // Remote participant
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;
    const useExternalAV = this.getParticipantUseExternalAV(participant);

    if (!fvttUserId) {
      log.warn("Mute change participant", participant, "is not an FVTT user");
      return;
    }

    // Foundry shows the mute state of users on its own A/V from their user
    // activity; users on external A/V only report it to LiveKit
    if (useExternalAV) {
      if (publication.kind === Track.Kind.Audio) {
        this.avMaster.settings.handleUserActivity(fvttUserId, {
          muted: publication.isMuted,
        });
      } else if (publication.kind === Track.Kind.Video) {
        this.avMaster.settings.handleUserActivity(fvttUserId, {
          hidden: publication.isMuted,
        });
      }
    }
  }

  onRenderCameraViews(
    _cameraviews: foundry.applications.apps.av.CameraViews,
    html: HTMLElement,
  ): void {
    // The Discord-style dock draws its own controls and decorations
    if (this.dock) {
      this.applyDiscordStyle();
      return;
    }
    this.decorateCameraViews(html);

    const userId = game.user?.id;
    if (!userId) {
      log.error("No user ID found; cannot render camera views");
      return;
    }
    const cameraBox = html.querySelector(
      `[data-user="${userId}"].user-controls`,
    );
    // Look for existing connection buttons
    if (cameraBox?.querySelector(".livekit-control")) {
      return;
    }
    const element = cameraBox?.querySelector('[data-action="configure"]');
    if (!(element instanceof HTMLElement)) {
      log.warn("Can't find CameraView configure element", element);
      return;
    }
    this.addConnectionButtons(element);
    this.addNoiseCancellationButton(element);
  }

  /**
   * Add the Discord-style decorations after every camera dock render.
   */
  private decorateCameraViews(html: HTMLElement): void {
    this.applyDiscordStyle();
    this.cameraViewDecorator.decorate(html);
  }

  onTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    log.debug("onTrackSubscribed:", track, publication, participant);
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Track subscribed participant",
        participant,
        "is not an FVTT user",
      );
      return;
    }

    if (track instanceof RemoteAudioTrack) {
      // Audio plays from elements of its own, which don't depend on the
      // camera views
      const audioElement = this.getUserAudioElement(
        fvttUserId,
        null,
        publication.source,
      );
      this.attachAudioTrack(fvttUserId, track, audioElement).catch(
        (error: unknown) => {
          log.error("Error attaching audio track:", error);
        },
      );
    } else if (track instanceof RemoteVideoTrack) {
      // The camera view may not be rendered yet; rendering attaches it then
      const videoElement = this.getUserVideoElement(fvttUserId);
      if (videoElement) {
        this.attachVideoTrack(track, videoElement);
      }
    } else {
      log.warn("Unknown track type subscribed from publication", publication);
    }

    debounceRefreshView(fvttUserId);
    this.onVoiceStateChanged(fvttUserId);
  }

  onTrackUnSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    log.debug("onTrackUnSubscribed:", track, publication, participant);
    track.detach();
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;
    if (fvttUserId) {
      this.onVoiceStateChanged(fvttUserId);
    }
  }

  /**
   * Change volume control for a stream
   * @param {Event} event   The originating change event from interaction with the range input
   */
  onVolumeChange(event: Event): void {
    const input = event.currentTarget;
    if (
      !(input instanceof foundry.applications.elements.HTMLRangePickerElement)
    ) {
      log.warn(
        "Volume change event did not originate from a range picker element",
      );
      return;
    }
    const box = input.closest(".camera-view");
    const volume = foundry.audio.AudioHelper.inputToVolume(input.value);
    if (!(box instanceof HTMLElement)) {
      log.warn("Volume change event did not originate from a camera view box");
      return;
    }
    if (box.dataset.user) {
      // Foundry's slider goes up to 100%; this also replaces a higher volume
      // set from the user's right-click menu
      this.userAudioMixer.setVolume(box.dataset.user, volume);

      // HACK: Needed to fix a bug in FVTT v13
      this.settings.set("client", `users.${box.dataset.user}.volume`, volume);
    }
  }

  onWindowClick(): void {
    if (this.windowClickListener) {
      window.removeEventListener("click", this.windowClickListener);
      this.render();
    }
  }

  getVideoParams(): VideoCaptureOptions | false {
    // Configure whether the user can send video
    const videoSrc = this.settings.get("client", "videoSrc");
    const canBroadcastVideo = this.avMaster.canUserBroadcastVideo(
      game.user?.id ?? "",
    );

    // Set resolution higher if simulcast is enabled
    let videoResolution = VideoPresets43.h180.resolution;
    if (this.trackPublishOptions.simulcast) {
      videoResolution = VideoPresets43.h720.resolution;
    }

    return typeof videoSrc === "string" &&
      videoSrc !== "disabled" &&
      canBroadcastVideo
      ? {
          deviceId: { ideal: videoSrc },
          resolution: videoResolution,
        }
      : false;
  }

  async sendJoinMessage(liveKitServer: string, accessToken: string) {
    // Create the url for user to join the external LiveKit web client
    const params = new URLSearchParams({
      liveKitUrl: `wss://${liveKitServer}`,
      token: accessToken,
    });
    const url = `https://meet.livekit.io/custom?${params.toString()}`;

    await foundry.applications.api.DialogV2.confirm({
      window: { title: `${LANG_NAME}.externalAVJoinTitle` },
      content: `<p>${
        game.i18n?.localize(`${LANG_NAME}.externalAVJoinMessage`) ??
        "externalAVJoinMessage"
      }</p>`,
      yes: {
        label: `${LANG_NAME}.externalAVJoinButton`,
        icon: "fa-solid fa-check",
        callback: () => window.open(url),
      },
      no: {
        label: `${LANG_NAME}.externalAVIgnoreButton`,
        icon: "fa-solid fa-xmark",
        callback: () => {
          log.info("Ignoring external LiveKit join request");
        },
      },
    });
  }

  setAudioEnabledState(enable: boolean): void {
    if (!this.audioTrack) {
      log.debug("setAudioEnabledState called but no audio track available");
      return;
    }
    if (this.liveKitRoom?.state !== ConnectionState.Connected) {
      log.debug(
        "setAudioEnabledState called but LiveKit room is not connected",
      );
      return;
    }

    if (!enable && !this.audioTrack.isMuted) {
      log.debug("Muting audio track", this.audioTrack);
      this.audioTrack.mute().catch((error: unknown) => {
        log.error("Error muting audio track:", error);
      });
    } else if (enable && this.audioTrack.isMuted) {
      log.debug("Un-muting audio track", this.audioTrack);
      this.audioTrack.unmute().catch((error: unknown) => {
        log.error("Error un-muting audio track:", error);
      });
    } else {
      log.debug(
        "setAudioEnabledState called but track is already in the current state",
      );
    }
  }

  setConnectionButtons(connected: boolean): void {
    // The buttons are in the dock's controls, next to the camera views
    const userControls = document.querySelector(
      `.user-controls[data-user="${game.user?.id ?? ""}"]`,
    );

    if (userControls) {
      const connectButton = userControls.querySelector(
        ".livekit-control.connect",
      );
      const disconnectButton = userControls.querySelector(
        ".livekit-control.disconnect",
      );

      connectButton?.classList.toggle("hidden", connected);
      connectButton?.classList.toggle("disabled", false);
      disconnectButton?.classList.toggle("hidden", !connected);
      disconnectButton?.classList.toggle("disabled", false);
    }
    this.voicePanelInstance?.update();
  }

  setConnectionQualityIndicator(userId: string, quality?: string): void {
    // Get the user camera view and connection quality indicator
    const userCameraView = document.querySelector(
      `.camera-view[data-user="${userId}"]`,
    );
    const connectionQualityIndicator = userCameraView?.querySelector(
      ".connection-quality-indicator",
    );

    quality ??=
      this.liveKitParticipants.get(userId)?.connectionQuality ??
      ConnectionQuality.Unknown;

    if (connectionQualityIndicator instanceof HTMLDivElement) {
      // Remove all existing quality classes
      connectionQualityIndicator.classList.remove(
        ...Object.values(ConnectionQuality),
      );

      // Add the correct quality class
      connectionQualityIndicator.classList.add(quality);

      // Set the hover title
      connectionQualityIndicator.title =
        game.i18n?.localize(`${LANG_NAME}.connectionQuality.${quality}`) ??
        quality;
    }
  }

  setLocalParticipantCallbacks(): void {
    this.liveKitRoom?.localParticipant
      .on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
        // While the voice activity gate runs, it tells when we speak
        if (!this.voiceGate) {
          this.onIsSpeakingChanged(game.user?.id, speaking);
        }
      })
      .on(ParticipantEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("Local ParticipantEvent ParticipantMetadataChanged:", args);
      })
      .on(ParticipantEvent.TrackPublished, (...args) => {
        log.debug("Local ParticipantEvent TrackPublished:", args);
      })
      .on(ParticipantEvent.TrackSubscriptionStatusChanged, (...args) => {
        log.debug(
          "Local ParticipantEvent TrackSubscriptionStatusChanged:",
          args,
        );
      });
  }

  setRemoteParticipantCallbacks(participant: RemoteParticipant): void {
    const fvttUserId = this.getParticipantFVTTUser(participant)?.id;

    if (!fvttUserId) {
      log.warn(
        "Participant",
        participant,
        "is not an FVTT user; skipping setRemoteParticipantCallbacks",
      );
      return;
    }

    participant
      .on(
        ParticipantEvent.IsSpeakingChanged,
        this.onIsSpeakingChanged.bind(this, fvttUserId),
      )
      .on(ParticipantEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("Remote ParticipantEvent ParticipantMetadataChanged:", args);
      });
  }

  setRoomCallbacks(): void {
    if (!this.liveKitRoom) {
      log.warn(
        "Attempted to set up room callbacks before the LiveKit room is ready",
      );
      return;
    }

    // Set up event callbacks
    this.liveKitRoom
      .on(
        RoomEvent.AudioPlaybackStatusChanged,
        this.onAudioPlaybackStatusChanged.bind(this),
      )
      .on(
        RoomEvent.ParticipantConnected,
        this.onParticipantConnected.bind(this),
      )
      .on(
        RoomEvent.ParticipantDisconnected,
        this.onParticipantDisconnected.bind(this),
      )
      .on(RoomEvent.TrackSubscribed, this.onTrackSubscribed.bind(this))
      .on(RoomEvent.TrackSubscriptionFailed, (...args) => {
        log.error("RoomEvent TrackSubscriptionFailed:", args);
      })
      .on(RoomEvent.TrackUnpublished, (...args) => {
        log.debug("RoomEvent TrackUnpublished:", args);
      })
      .on(RoomEvent.TrackUnsubscribed, this.onTrackUnSubscribed.bind(this))
      .on(RoomEvent.LocalTrackUnpublished, (...args) => {
        log.debug("RoomEvent LocalTrackUnpublished:", args);
      })
      .on(
        RoomEvent.ConnectionQualityChanged,
        this.onConnectionQualityChanged.bind(this),
      )
      .on(RoomEvent.Disconnected, this.onDisconnected.bind(this))
      .on(RoomEvent.Reconnecting, this.onReconnecting.bind(this))
      .on(RoomEvent.TrackMuted, this.onTrackMuteChanged.bind(this))
      .on(RoomEvent.TrackUnmuted, this.onTrackMuteChanged.bind(this))
      .on(RoomEvent.ParticipantMetadataChanged, (...args) => {
        log.debug("RoomEvent ParticipantMetadataChanged:", args);
      })
      .on(RoomEvent.RoomMetadataChanged, (...args) => {
        log.debug("RoomEvent RoomMetadataChanged:", args);
      })
      .on(RoomEvent.Reconnected, this.onReconnected.bind(this));
  }

  async shareScreen(enabled: boolean): Promise<void> {
    log.info("shareScreen:", enabled);

    if (enabled) {
      // Configure audio options
      const screenAudioOptions: AudioCaptureOptions = {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: { ideal: 2 },
      };

      // Get screen tracks
      this.screenTracks = await createLocalScreenTracks({
        audio: screenAudioOptions,
      });

      for (const screenTrack of this.screenTracks) {
        log.debug("screenTrack enable:", screenTrack);
        if (screenTrack instanceof LocalVideoTrack) {
          // Stop our local video track
          if (this.videoTrack) {
            await this.liveKitRoom?.localParticipant.unpublishTrack(
              this.videoTrack,
            );
          }

          // Attach the screen share video to our video element
          const userVideoElement = document.querySelector(
            `.camera-view[data-user="${game.user?.id ?? ""}"]`,
          );
          if (userVideoElement instanceof HTMLVideoElement) {
            this.attachVideoTrack(screenTrack, userVideoElement);
          }
        }

        // Get publishing options
        const screenTrackPublishOptions = this.trackPublishOptions;

        // Use musicHighQuality audio preset for screen share
        screenTrackPublishOptions.audioPreset = AudioPresets.musicHighQuality;

        // Publish the track
        await this.liveKitRoom?.localParticipant.publishTrack(
          screenTrack,
          screenTrackPublishOptions,
        );
      }
    } else {
      for (const screenTrack of this.screenTracks) {
        log.debug("screenTrack disable:", screenTrack);
        // Unpublish the screen share track
        await this.liveKitRoom?.localParticipant.unpublishTrack(screenTrack);

        // Restart our video track
        if (screenTrack instanceof LocalVideoTrack && this.videoTrack) {
          await this.liveKitRoom?.localParticipant.publishTrack(
            this.videoTrack,
            this.trackPublishOptions,
          );

          if (!this.videoTrack.isMuted) {
            await this.videoTrack.unmute();
          }
        }
      }
    }
  }

  get trackPublishOptions(): TrackPublishOptions {
    const trackPublishOptions: TrackPublishOptions = {
      audioPreset: this.getAudioPreset(),
      simulcast: true,
      videoCodec: "vp8",
      videoSimulcastLayers: [VideoPresets43.h180, VideoPresets43.h360],
    };

    if (game.settings?.get(MODULE_NAME, "audioMusicMode")) {
      trackPublishOptions.audioPreset = AudioPresets.musicHighQuality;
    }

    return trackPublishOptions;
  }

  getAudioPreset(): AudioPreset {
    const preset = game.settings?.get(MODULE_NAME, "audioQualityPreset");
    switch (preset) {
      case "telephone":
        return AudioPresets.telephone;
      case "music":
        return AudioPresets.music;
      case "musicStereo":
        return AudioPresets.musicStereo;
      case "musicHighQuality":
        return AudioPresets.musicHighQuality;
      case "musicHighQualityStereo":
        return AudioPresets.musicHighQualityStereo;
      case "speech":
      default:
        return AudioPresets.speech;
    }
  }
}
