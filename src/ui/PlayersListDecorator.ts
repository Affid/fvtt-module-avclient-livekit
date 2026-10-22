import type LiveKitClient from "../LiveKitClient";
import { badge } from "./Avatar";
import { localize } from "./controls";
import { el } from "./dom";

/**
 * Shows voice state in Foundry's player list, matching the camera dock: a
 * green ring around a user's color while they speak, and icons when they are
 * muted or deafened. Only users in the voice call get them.
 */
export default class PlayersListDecorator {
  constructor(private readonly client: LiveKitClient) {}

  /**
   * Decorate the rows of a rendered player list.
   */
  decorate(root: HTMLElement): void {
    for (const row of root.querySelectorAll<HTMLElement>(
      "li.player[data-user-id]",
    )) {
      this.updateRow(row);
    }
  }

  refresh(userId?: string): void {
    const selector = userId
      ? `#players li.player[data-user-id="${userId}"]`
      : "#players li.player[data-user-id]";
    for (const row of document.querySelectorAll<HTMLElement>(selector)) {
      this.updateRow(row);
    }
  }

  setSpeaking(userId: string, speaking: boolean): void {
    document
      .querySelector(`#players li.player[data-user-id="${userId}"]`)
      ?.classList.toggle("livekit-speaking", speaking && this.inCall(userId));
  }

  private updateRow(row: HTMLElement): void {
    const userId = row.dataset.userId ?? "";
    const client = this.client;
    const inCall = this.inCall(userId);
    row.classList.toggle("livekit-in-call", inCall);
    row.classList.toggle(
      "livekit-speaking",
      inCall && client.isUserSpeaking(userId),
    );

    let status = row.querySelector(".livekit-player-status");
    if (!status) {
      status = el("span", { className: "livekit-player-status" });
      row.append(status);
    }
    status.replaceChildren();
    if (!inCall) {
      return;
    }
    if (client.isUserMuted(userId)) {
      status.append(
        badge({ icon: "fa-microphone-slash", label: localize("muted") }),
      );
    }
    if (client.voiceControls.isUserDeafened(userId)) {
      status.append(
        badge({
          icon: "fa-headphones",
          label: localize("deafened"),
          slashed: true,
        }),
      );
    }
  }

  /**
   * Whether a user is in the voice call.
   */
  private inCall(userId: string): boolean {
    return (
      document.body.classList.contains("livekit-discord-ui") &&
      this.client.liveKitParticipants.has(userId)
    );
  }
}
