import type LiveKitClient from "./LiveKitClient";
import { MODULE_NAME } from "./utils/constants";
import { Logger } from "./utils/logger";

const log = new Logger("VoiceControls");

/**
 * Discord-style mute and deafen controls for the local user, built on
 * Foundry's own A/V settings so that they stay in sync with Foundry's camera
 * controls:
 * - Mute is the user's `muted` A/V setting.
 * - Deafen is the `muteAll` A/V setting (no incoming audio) plus muting the
 *   microphone. Undeafening unmutes the microphone again if deafening muted
 *   it, and unmuting while deafened also undeafens, like in Discord.
 *
 * Other users can't see the local `muteAll` setting, so the deafened state is
 * shared through the module's socket.
 */
export default class VoiceControls {
  /** Users that told us they are deafened */
  private readonly remoteDeafened = new Set<string>();

  constructor(private readonly client: LiveKitClient) {}

  private get userId(): string {
    return game.user?.id ?? "";
  }

  isMuted(): boolean {
    return this.client.settings.getUser(this.userId)?.muted === true;
  }

  isDeafened(): boolean {
    return this.client.settings.get("client", "muteAll") === true;
  }

  /**
   * Whether a user is deafened, as far as we know.
   */
  isUserDeafened(userId: string): boolean {
    return userId === this.userId
      ? this.isDeafened()
      : this.remoteDeafened.has(userId);
  }

  toggleMute(): void {
    const mute = !this.isMuted();
    if (!mute && this.isDeafened()) {
      // Unmuting while deafened also undeafens
      this.setDeafenedSetting(false);
    }
    this.setMuted(mute);
    this.setMutedByDeafen(false);
    this.client.onVoiceStateChanged();
  }

  toggleDeafen(): void {
    const deafen = !this.isDeafened();
    if (deafen && !this.isMuted()) {
      this.setMuted(true);
      this.setMutedByDeafen(true);
    } else if (!deafen && this.wasMutedByDeafen()) {
      this.setMuted(false);
      this.setMutedByDeafen(false);
    }
    this.setDeafenedSetting(deafen);
    this.client.onVoiceStateChanged();
  }

  /**
   * Tell the other users whether we are deafened.
   */
  broadcastDeafened(): void {
    game.socket?.emit(`module.${MODULE_NAME}`, {
      action: "deafen",
      deafened: this.isDeafened(),
    });
  }

  /**
   * Handle a deafen message from another user.
   */
  onRemoteDeafened(userId: string, deafened: boolean): void {
    if (deafened) {
      this.remoteDeafened.add(userId);
    } else {
      this.remoteDeafened.delete(userId);
    }
    this.client.onVoiceStateChanged(userId);
  }

  private setMuted(muted: boolean): void {
    this.client.settings.set("client", `users.${this.userId}.muted`, muted);
  }

  private setDeafenedSetting(deafened: boolean): void {
    this.client.settings.set("client", "muteAll", deafened);
    this.broadcastDeafened();
  }

  private wasMutedByDeafen(): boolean {
    return game.settings?.get(MODULE_NAME, "mutedByDeafen") === true;
  }

  private setMutedByDeafen(value: boolean): void {
    game.settings
      ?.set(MODULE_NAME, "mutedByDeafen", value)
      .catch((error: unknown) => {
        log.error("Error saving mutedByDeafen:", error);
      });
  }
}
