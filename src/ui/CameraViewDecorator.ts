import { RemoteParticipant, Track } from "livekit-client";
import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME } from "../utils/constants";
import { el, icon } from "./dom";

const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";

/**
 * Adds Discord-style decorations to Foundry's camera views: a speaking ring,
 * the user's avatar while their camera is off, mute/deafen badges, and a
 * right-click menu for other users' volume.
 *
 * Foundry re-renders the camera views often, which replaces their content, so
 * the decorations are re-applied after every render from the state kept here.
 */
export default class CameraViewDecorator {
  private readonly speaking = new Set<string>();
  private readonly decoratedViews = new WeakSet<HTMLElement>();

  constructor(private readonly client: LiveKitClient) {}

  /**
   * Decorate every camera view inside a rendered camera dock.
   */
  decorate(root: HTMLElement): void {
    for (const view of root.querySelectorAll<HTMLElement>(
      ".camera-view[data-user]",
    )) {
      this.decorateView(view);
    }
  }

  /**
   * Update the decorations of one user's camera view, e.g. after their
   * microphone or camera state changed.
   */
  refresh(userId: string): void {
    const view = this.getView(userId);
    if (view) {
      this.updateView(view, userId);
    }
  }

  refreshAll(): void {
    for (const view of document.querySelectorAll<HTMLElement>(
      ".camera-view[data-user]",
    )) {
      const userId = view.dataset.user;
      if (userId) {
        this.updateView(view, userId);
      }
    }
  }

  setSpeaking(userId: string, speaking: boolean): void {
    if (speaking) {
      this.speaking.add(userId);
    } else {
      this.speaking.delete(userId);
    }
    this.getView(userId)?.classList.toggle("livekit-speaking", speaking);
  }

  isSpeaking(userId: string): boolean {
    return this.speaking.has(userId);
  }

  private getView(userId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(
      `.camera-view[data-user="${userId}"]`,
    );
  }

  private decorateView(view: HTMLElement): void {
    const userId = view.dataset.user;
    if (!userId) {
      return;
    }

    if (!view.querySelector(".livekit-avatar")) {
      const user = game.users?.get(userId);
      const avatar = el("div", {
        className: "livekit-avatar",
        children: [
          el("img", {
            attrs: { src: user?.avatar ?? DEFAULT_AVATAR, alt: "" },
          }),
        ],
      });
      const badges = el("div", { className: "livekit-badges" });
      const ring = el("div", { className: "livekit-ring" });

      // Place the decorations with the video so they share its container
      const video = view.querySelector("video.user-video");
      const container = video?.parentElement ?? view;
      if (getComputedStyle(container).position === "static") {
        container.classList.add("livekit-positioned");
      }
      if (video) {
        video.after(avatar, ring, badges);
      } else {
        container.append(avatar, ring, badges);
      }
    }

    if (!this.decoratedViews.has(view)) {
      this.decoratedViews.add(view);
      view.classList.add("livekit-camera-view");
      if (userId !== game.user?.id) {
        view.addEventListener("contextmenu", (event) => {
          if (!document.body.classList.contains("livekit-discord-ui")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          this.client.userVolumeMenu.open(userId, event.clientX, event.clientY);
        });
      }
    }

    this.updateView(view, userId);
  }

  private updateView(view: HTMLElement, userId: string): void {
    const muted = this.isUserMuted(userId);
    const deafened = this.client.voiceControls.isUserDeafened(userId);
    view.classList.toggle("livekit-speaking", this.speaking.has(userId));
    view.classList.toggle("livekit-no-video", !this.hasVideo(userId));
    view.classList.toggle("livekit-muted", muted);
    view.classList.toggle("livekit-deafened", deafened);

    const badges = view.querySelector(".livekit-badges");
    if (badges) {
      const localize = (key: string) =>
        game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;
      const badge = (iconName: string, label: string, className = "") =>
        el("span", {
          className: `livekit-badge ${className}`.trim(),
          title: label,
          children: [icon(iconName)],
        });
      badges.replaceChildren();
      if (muted) {
        badges.append(badge("fa-microphone-slash", localize("muted")));
      }
      if (deafened) {
        // There is no free "headphones slash" icon; the slash is drawn in CSS
        badges.append(
          badge("fa-headphones", localize("deafened"), "livekit-slashed"),
        );
      }
    }
  }

  /**
   * Whether a user's camera is showing video.
   */
  private hasVideo(userId: string): boolean {
    const track =
      userId === game.user?.id
        ? this.client.videoTrack
        : this.client.getUserVideoTrack(userId);
    return !!track && !track.isMuted;
  }

  /**
   * Whether a user's microphone is muted or off. Users we have no LiveKit
   * participant for are not shown as muted, since we don't know.
   */
  private isUserMuted(userId: string): boolean {
    if (userId === game.user?.id) {
      return this.client.voiceControls.isMuted() || !this.client.audioTrack;
    }
    const participant = this.client.liveKitParticipants.get(userId);
    if (!(participant instanceof RemoteParticipant)) {
      return false;
    }
    const publication = participant.getTrackPublication(
      Track.Source.Microphone,
    );
    return !publication || publication.isMuted;
  }
}
