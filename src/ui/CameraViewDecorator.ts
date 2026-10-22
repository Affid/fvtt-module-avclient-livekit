import type LiveKitClient from "../LiveKitClient";
import Avatar, { badge } from "./Avatar";
import { localize } from "./controls";
import { el } from "./dom";

/**
 * Adds Discord-style decorations to Foundry's camera views (used when the
 * Discord-style camera dock isn't): a speaking ring,
 * the user's avatar while their camera is off, mute/deafen badges, and a
 * right-click menu for other users' volume.
 *
 * Foundry re-renders the camera views often, which replaces their content, so
 * the decorations are re-applied after every render from the state kept here.
 */
export default class CameraViewDecorator {
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
    const view = this.getView(userId);
    view?.classList.toggle("livekit-speaking", speaking);
    view
      ?.querySelector(".livekit-camera-avatar .livekit-avatar")
      ?.classList.toggle("is-speaking", speaking);
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

    if (!view.querySelector(".livekit-camera-avatar")) {
      const user = game.users?.get(userId);
      const avatar = el("div", {
        className: "livekit-camera-avatar",
        children: [new Avatar({ src: user?.avatar, size: "fill" }).element],
      });
      const badges = el("div", { className: "livekit-camera-badges" });
      const ring = el("div", { className: "livekit-ring" });

      // Place the decorations with the video so they share its container
      const video = view.querySelector("video.user-camera");
      const container = video?.parentElement ?? view;
      if (getComputedStyle(container).position === "static") {
        container.classList.add("livekit-positioned");
      }
      container.append(avatar, ring, badges);
    }

    if (!this.decoratedViews.has(view)) {
      this.decoratedViews.add(view);
      view.classList.add("livekit-camera-view");
      // Foundry's volume slider; the module plays the audio itself
      view
        .querySelector(".webrtc-volume-slider")
        ?.addEventListener("change", (event) => {
          this.client.onVolumeChange(event);
        });
      if (userId !== game.user?.id) {
        view.addEventListener("contextmenu", (event) => {
          if (!document.body.classList.contains("livekit-discord-ui")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          this.client.userMenu.open(userId, event.clientX, event.clientY, view);
        });
      }
    }

    this.updateView(view, userId);
  }

  private updateView(view: HTMLElement, userId: string): void {
    const speaking = this.client.isUserSpeaking(userId);
    const muted = this.client.isUserMuted(userId);
    const deafened = this.client.voiceControls.isUserDeafened(userId);
    view.classList.toggle("livekit-speaking", speaking);
    // Foundry hides the video when it doesn't expect any, even if a track is
    // playing
    const video = view.querySelector<HTMLVideoElement>("video.user-camera");
    view.classList.toggle(
      "livekit-no-video",
      !this.client.isUserVideoOn(userId) ||
        !video ||
        video.hasAttribute("hidden"),
    );
    view.classList.toggle("livekit-muted", muted);
    view.classList.toggle("livekit-deafened", deafened);

    view
      .querySelector(".livekit-camera-avatar .livekit-avatar")
      ?.classList.toggle("is-speaking", speaking);
    const badges = view.querySelector(".livekit-camera-badges");
    if (badges) {
      badges.replaceChildren();
      if (muted) {
        badges.append(
          badge({ icon: "fa-microphone-slash", label: localize("muted") }),
        );
      }
      if (deafened) {
        // There is no free "headphones slash" icon; the slash is drawn in CSS
        badges.append(
          badge({
            icon: "fa-headphones",
            label: localize("deafened"),
            slashed: true,
          }),
        );
      }
    }
  }
}
