import type LiveKitClient from "../LiveKitClient";
import { MAX_USER_VOLUME } from "../UserAudioMixer";
import Avatar from "./Avatar";
import Menu, { type MenuItem } from "./Menu";
import { localize, slider } from "./controls";
import { el } from "./dom";

/**
 * A Discord-style context menu for another user's camera view: a volume
 * slider from 0% to 200%, and muting the user just for yourself.
 */
export default class UserVolumeMenu {
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
    const mixer = this.client.userAudioMixer;
    const percent = (value: number) => `${Math.round(value).toString()}%`;
    const avatar = new Avatar({ src: user.avatar, size: "sm" });
    const muted = mixer.isLocallyMuted(userId);

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
      { type: "separator" },
      {
        type: "custom",
        element: slider({
          label: localize("userVolume"),
          min: 0,
          max: MAX_USER_VOLUME * 100,
          value: Math.round(mixer.getVolume(userId) * 100),
          format: percent,
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
        onSelect: () => mixer.setLocallyMuted(userId, !muted),
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
}
