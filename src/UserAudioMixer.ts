import { RemoteAudioTrack, Track } from "livekit-client";
import type LiveKitClient from "./LiveKitClient";
import { MODULE_NAME } from "./utils/constants";
import { resumeAudioContext } from "./utils/helpers";
import { Logger } from "./utils/logger";

const log = new Logger("UserAudioMixer");

/** The highest per-user volume, as in Discord (200%) */
export const MAX_USER_VOLUME = 2;

interface Boost {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
}

/**
 * Applies per-user playback settings to remote users' audio: volume from 0%
 * to 200%, muting a user just for yourself, and deafening.
 *
 * Volumes up to 100% use the audio element's volume. Above that, the user's
 * microphone is played through a Web Audio gain node instead (audio elements
 * can't go above 100%), with the element muted but still attached, which
 * Chrome needs to deliver remote WebRTC audio to Web Audio.
 */
export default class UserAudioMixer {
  private context?: AudioContext;
  private readonly boosts = new Map<string, Boost>();
  /** Unsaved volumes, applied while a volume slider is being dragged */
  private readonly volumeOverrides = new Map<string, number>();

  constructor(private readonly client: LiveKitClient) {}

  /**
   * A user's playback volume, from 0 to MAX_USER_VOLUME.
   */
  getVolume(userId: string): number {
    const volume =
      this.volumeOverrides.get(userId) ??
      game.settings?.get(MODULE_NAME, "userVolumes")[userId] ??
      this.client.settings.getUser(userId)?.volume ??
      1;
    return Math.min(Math.max(volume, 0), MAX_USER_VOLUME);
  }

  /**
   * Set a user's playback volume. The volume is applied immediately and saved
   * unless `save` is false (e.g. while dragging a slider).
   */
  setVolume(userId: string, volume: number, save = true): void {
    const clampedVolume = Math.min(Math.max(volume, 0), MAX_USER_VOLUME);
    const userVolumes = {
      ...game.settings?.get(MODULE_NAME, "userVolumes"),
      [userId]: clampedVolume,
    };
    this.volumeOverrides.set(userId, clampedVolume);
    this.apply(userId);
    if (save) {
      game.settings
        ?.set(MODULE_NAME, "userVolumes", userVolumes)
        .catch((error: unknown) => {
          log.error("Error saving user volume:", error);
        })
        .finally(() => {
          this.volumeOverrides.delete(userId);
        });
    }
  }

  isLocallyMuted(userId: string): boolean {
    return game.settings?.get(MODULE_NAME, "userLocalMutes")[userId] === true;
  }

  async setLocallyMuted(userId: string, muted: boolean): Promise<void> {
    const userLocalMutes = {
      ...game.settings?.get(MODULE_NAME, "userLocalMutes"),
      [userId]: muted,
    };
    try {
      await game.settings?.set(MODULE_NAME, "userLocalMutes", userLocalMutes);
    } catch (error: unknown) {
      log.error("Error saving local mute:", error);
    }
    this.apply(userId);
  }

  /**
   * Apply the playback settings to all of a user's audio elements.
   */
  apply(userId: string): void {
    if (userId === game.user?.id) {
      return;
    }

    const muted =
      this.client.voiceControls.isDeafened() || this.isLocallyMuted(userId);
    const volume = this.getVolume(userId);
    const microphoneTrack = this.getMicrophoneTrack(userId);
    const boostTrack =
      !muted && volume > 1 && this.canBoost() ? microphoneTrack : undefined;
    const boost = !!boostTrack;

    const audioElements =
      document
        .querySelector(`.camera-view[data-user="${userId}"]`)
        ?.querySelectorAll("audio") ?? [];
    for (const audioElement of audioElements) {
      const isMicrophone = audioElement.classList.contains(
        `user-${Track.Source.Microphone}-audio`,
      );
      audioElement.volume = Math.min(volume, 1);
      // A boosted microphone plays through Web Audio instead
      audioElement.muted = muted || (boost && isMicrophone);
    }

    if (boostTrack) {
      this.startBoost(userId, boostTrack.mediaStreamTrack, volume);
    } else {
      this.stopBoost(userId);
    }
  }

  applyAll(): void {
    for (const userId of game.users?.keys() ?? []) {
      this.apply(userId);
    }
  }

  /**
   * Stop all boosted playback, e.g. when disconnecting.
   */
  stopAll(): void {
    for (const userId of [...this.boosts.keys()]) {
      this.stopBoost(userId);
    }
  }

  /**
   * Boosting needs Web Audio to play on the selected output device, which
   * requires AudioContext.setSinkId (not available in Firefox, for example).
   */
  private canBoost(): boolean {
    const sink = this.client.settings.client.audioSink;
    return !sink || sink === "default" || "setSinkId" in AudioContext.prototype;
  }

  private getMicrophoneTrack(userId: string): RemoteAudioTrack | undefined {
    const participant = this.client.liveKitParticipants.get(userId);
    const track = participant?.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    return track instanceof RemoteAudioTrack ? track : undefined;
  }

  private getContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      resumeAudioContext(this.context);
    }
    const sink = this.client.settings.client.audioSink;
    const contextWithSink = this.context as AudioContext & {
      sinkId?: string;
      setSinkId?: (sinkId: string) => Promise<void>;
    };
    const sinkId = !sink || sink === "default" ? "" : sink;
    if (contextWithSink.setSinkId && contextWithSink.sinkId !== sinkId) {
      contextWithSink.setSinkId(sinkId).catch((error: unknown) => {
        log.warn("Unable to set the boosted audio output device:", error);
      });
    }
    return this.context;
  }

  private startBoost(
    userId: string,
    track: MediaStreamTrack,
    volume: number,
  ): void {
    let boost = this.boosts.get(userId);
    if (boost?.track !== track) {
      this.stopBoost(userId);
      const context = this.getContext();
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const gain = context.createGain();
      source.connect(gain).connect(context.destination);
      boost = { track, source, gain };
      this.boosts.set(userId, boost);
    }
    boost.gain.gain.value = volume;
  }

  private stopBoost(userId: string): void {
    const boost = this.boosts.get(userId);
    if (boost) {
      boost.source.disconnect();
      boost.gain.disconnect();
      this.boosts.delete(userId);
    }
  }
}
