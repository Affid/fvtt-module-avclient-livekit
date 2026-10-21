import type LiveKitClient from "../LiveKitClient";
import { MAX_USER_VOLUME } from "../UserAudioMixer";
import { LANG_NAME } from "../utils/constants";
import { Popover, el, icon } from "./dom";

const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";

/**
 * A Discord-style context menu for another user's camera view: a volume
 * slider from 0% to 200%, and muting the user just for yourself.
 */
export default class UserVolumeMenu {
  private readonly popover = new Popover("livekit-user-menu");

  constructor(private readonly client: LiveKitClient) {}

  open(userId: string, x: number, y: number): void {
    const user = game.users?.get(userId);
    if (!user) {
      return;
    }
    this.render(userId, user.name, user.avatar ?? DEFAULT_AVATAR);
    this.popover.openAtPoint(x, y);
  }

  close(): void {
    this.popover.close();
  }

  private render(userId: string, name: string, avatar: string): void {
    const mixer = this.client.userAudioMixer;
    const localize = (key: string) =>
      game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;
    const percent = (volume: number) =>
      `${Math.round(volume * 100).toString()}%`;

    const volume = mixer.getVolume(userId);
    const value = el("span", {
      className: "livekit-user-menu-value",
      text: percent(volume),
    });
    const slider = el("input", {
      className: "livekit-slider",
      attrs: {
        type: "range",
        min: "0",
        max: (MAX_USER_VOLUME * 100).toString(),
        step: "1",
        value: Math.round(volume * 100).toString(),
        "aria-label": localize("userVolume"),
      },
    });
    const updateFill = () => {
      slider.style.setProperty(
        "--fill",
        `${((Number(slider.value) / (MAX_USER_VOLUME * 100)) * 100).toString()}%`,
      );
    };
    updateFill();
    slider.addEventListener("input", () => {
      const newVolume = Number(slider.value) / 100;
      value.textContent = percent(newVolume);
      updateFill();
      mixer.setVolume(userId, newVolume, false);
    });
    slider.addEventListener("change", () => {
      mixer.setVolume(userId, Number(slider.value) / 100);
    });

    const muted = mixer.isLocallyMuted(userId);
    const muteItem = el("button", {
      className: `livekit-menu-item livekit-menu-check ${muted ? "active" : ""}`,
      attrs: { type: "button", role: "menuitemcheckbox" },
      children: [
        el("span", { text: localize("userLocalMute") }),
        icon(muted ? "fa-square-check" : "fa-square"),
      ],
    });
    muteItem.setAttribute("aria-checked", String(muted));
    muteItem.addEventListener("click", () => {
      void mixer.setLocallyMuted(userId, !muted).then(() => {
        this.render(userId, name, avatar);
      });
    });

    const resetItem = el("button", {
      className: "livekit-menu-item",
      attrs: { type: "button", role: "menuitem" },
      children: [el("span", { text: localize("userVolumeReset") })],
    });
    resetItem.addEventListener("click", () => {
      mixer.setVolume(userId, 1);
      this.render(userId, name, avatar);
    });

    this.popover.element.replaceChildren(
      el("div", {
        className: "livekit-user-menu-header",
        children: [
          el("img", {
            className: "livekit-user-menu-avatar",
            attrs: { src: avatar, alt: "" },
          }),
          el("span", { className: "livekit-user-menu-name", text: name }),
        ],
      }),
      el("div", { className: "livekit-menu-separator" }),
      el("label", {
        className: "livekit-user-menu-volume",
        children: [
          el("span", {
            className: "livekit-user-menu-label",
            children: [localize("userVolume"), value],
          }),
          slider,
        ],
      }),
      el("div", { className: "livekit-menu-separator" }),
      muteItem,
      resetItem,
    );
  }
}
