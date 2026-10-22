import type LiveKitClient from "../LiveKitClient";
import { getBreakoutActions } from "../LiveKitBreakout";
import { MAX_USER_VOLUME } from "../UserAudioMixer";
import { MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import Avatar from "./Avatar";
import Menu, { type MenuItem } from "./Menu";
import { localize, slider } from "./controls";
import { el } from "./dom";

const log = new Logger("UserMenu");

/**
 * A Discord-style context menu for a user in the camera dock (or Foundry's):
 * their volume from 0% to 200% and muting them just for yourself; in the
 * Discord-style dock also showing them in focus, hiding their video for
 * yourself, and popping them out; for the GM, blocking their audio or video
 * and the breakout room actions.
 */
export default class UserMenu {
  private readonly menu: Menu;
  private userId?: string;

  constructor(private readonly client: LiveKitClient) {
    this.menu = new Menu(
      "livekit-user-menu",
      () => {
        const user = game.users?.get(this.userId ?? "");
        return user?.name ?? localize("userVolume");
      },
      () => this.items(),
    );
  }

  /**
   * @param control   The element the menu was opened from
   */
  open(userId: string, x: number, y: number, control?: HTMLElement): void {
    if (!game.users?.get(userId)) {
      return;
    }
    this.userId = userId;
    this.menu.openAtPoint(x, y, control);
  }

  close(): void {
    this.menu.close();
  }

  private items(): MenuItem[] {
    const userId = this.userId;
    const user = game.users?.get(userId ?? "");
    if (!userId || !user) {
      return [];
    }
    const isSelf = userId === game.user?.id;
    const avatar = new Avatar({ src: user.avatar, size: "sm" });

    return [
      {
        type: "custom",
        element: el("div", {
          className: "livekit-user-menu-header",
          children: [
            avatar.element,
            el("span", {
              className: "livekit-user-menu-name",
              text: user.name,
            }),
          ],
        }),
      },
      ...(isSelf ? [] : this.audioItems(userId)),
      ...this.dockItems(userId),
      ...this.gmItems(userId),
      ...this.breakoutItems(userId),
    ];
  }

  /**
   * Volume and muting, for other users.
   */
  private audioItems(userId: string): MenuItem[] {
    const mixer = this.client.userAudioMixer;
    const muted = mixer.isLocallyMuted(userId);
    return [
      { type: "separator" },
      {
        type: "custom",
        element: slider({
          label: localize("userVolume"),
          min: 0,
          max: MAX_USER_VOLUME * 100,
          value: Math.round(mixer.getVolume(userId) * 100),
          format: (value) => `${Math.round(value).toString()}%`,
          onInput: (value) => {
            mixer.setVolume(userId, value / 100, false);
          },
          onChange: (value) => {
            mixer.setVolume(userId, value / 100);
          },
        }),
      },
      { type: "separator" },
      {
        type: "checkbox",
        label: localize("userLocalMute"),
        checked: muted,
        onSelect: () =>
          mixer.setLocallyMuted(userId, !muted).then(() => {
            this.client.onVoiceStateChanged(userId);
          }),
      },
      {
        type: "action",
        label: localize("userVolumeReset"),
        icon: "fa-rotate-left",
        keepOpen: true,
        onSelect: () => {
          mixer.setVolume(userId, 1);
        },
      },
    ];
  }

  /**
   * What the Discord-style camera dock can do with a user.
   */
  private dockItems(userId: string): MenuItem[] {
    const dock = this.client.dock;
    if (!dock) {
      return [];
    }
    const isSelf = userId === game.user?.id;
    const videoHidden =
      game.settings?.get(MODULE_NAME, "userVideoHidden")[userId] === true;
    const poppedOut = dock.isPoppedOut(userId);
    const items: (MenuItem | false)[] = [
      { type: "separator" },
      !poppedOut && {
        type: "action",
        label: localize("dockFocusUser"),
        icon: "fa-expand",
        onSelect: () => {
          dock.focus(userId);
        },
      },
      {
        type: "action",
        label: localize(poppedOut ? "returnToDock" : "popOut"),
        icon: poppedOut
          ? "fa-arrow-right-to-bracket"
          : "fa-up-right-from-square",
        onSelect: () => dock.setPoppedOut(userId, !poppedOut),
      },
      dock.canPictureInPicture(userId) && {
        type: "action",
        label: localize("pictureInPicture"),
        icon: "fa-clone",
        onSelect: () => dock.pictureInPicture(userId),
      },
      !isSelf && {
        type: "checkbox",
        label: localize("hideVideoForMe"),
        checked: videoHidden,
        onSelect: async () => {
          await game.settings?.set(MODULE_NAME, "userVideoHidden", {
            ...game.settings.get(MODULE_NAME, "userVideoHidden"),
            [userId]: !videoHidden,
          });
          dock.refresh();
        },
      },
      !isSelf && {
        type: "action",
        label: localize("hideFromDock"),
        detail: localize("hideFromDockHint"),
        icon: "fa-user-slash",
        onSelect: async () => {
          game.webrtc?.settings.set("client", `users.${userId}.blocked`, true);
          await dock.render();
        },
      },
    ];
    return items.filter((item) => item !== false);
  }

  /**
   * The GM may stop a user from sharing audio or video.
   */
  private gmItems(userId: string): MenuItem[] {
    const user = game.users?.get(userId);
    if (!game.user?.isGM || userId === game.user.id || !user) {
      return [];
    }
    const settings = game.webrtc?.settings.getUser(userId);
    const block = (permission: "BROADCAST_AUDIO" | "BROADCAST_VIDEO") => {
      const allowed =
        permission === "BROADCAST_AUDIO"
          ? settings?.canBroadcastAudio !== false
          : settings?.canBroadcastVideo !== false;
      return user
        .update({ [`permissions.${permission}`]: !allowed })
        .then(() => game.webrtc?.render())
        .catch((error: unknown) => {
          log.error("Error changing the user's permissions:", error);
        });
    };
    return [
      { type: "separator" },
      { type: "header", label: localize("gameMaster") },
      {
        type: "checkbox",
        label: localize("blockAudio"),
        checked: settings?.canBroadcastAudio === false,
        onSelect: () => block("BROADCAST_AUDIO"),
      },
      {
        type: "checkbox",
        label: localize("blockVideo"),
        checked: settings?.canBroadcastVideo === false,
        onSelect: () => block("BROADCAST_VIDEO"),
      },
    ];
  }

  private breakoutItems(userId: string): MenuItem[] {
    const actions = getBreakoutActions(userId, this.client);
    if (!actions.length) {
      return [];
    }
    return [
      { type: "separator" },
      ...actions.map(
        (action): MenuItem => ({
          type: "action",
          label: action.label,
          icon: action.icon,
          onSelect: action.run,
        }),
      ),
    ];
  }
}
