import Avatar, { badge, type BadgeOptions } from "../Avatar";
import { iconButton, setIconButtonState } from "../buttons";
import { localize } from "../controls";
import { el, setTooltip } from "../dom";
import { LANG_NAME } from "../../utils/constants";

/**
 * What Foundry's camera dock prepares for each user
 * (CameraViews#_prepareUserContext): the parts the dock uses.
 */
export interface UserContext {
  user: User;
  local: boolean;
  charname: string;
  hasAudio: boolean;
  hasVideo: boolean;
  settings: {
    popout?: boolean;
    blocked?: boolean;
    hidden?: boolean;
    left?: number;
    top?: number;
    width?: number;
  };
  nameplates: { hidden: boolean; playerName: boolean; charname: boolean };
  video: { show: boolean };
}

/**
 * A user's state as the tile shows it.
 */
export interface TileState {
  speaking: boolean;
  /** Their microphone is muted or off */
  muted: boolean;
  deafened: boolean;
  /** Muted just for this client */
  locallyMuted: boolean;
  /** Their video is hidden just for this client */
  videoHiddenByMe: boolean;
  /** The video shows, rather than the avatar */
  showVideo: boolean;
  /** The LiveKit connection quality, e.g. "excellent" */
  quality: string;
  /** Show the user's color on the tile (Foundry's border colors setting) */
  borderColor: boolean;
  /** The tile is the large one of the focus layout */
  focused: boolean;
}

/**
 * What a tile asks of its dock.
 */
export interface TileHost {
  /** The tile was clicked or Enter was pressed on it */
  activate(userId: string): void;
  openMenu(userId: string, x: number, y: number, control: HTMLElement): void;
  toggleOwnMute(): void;
  toggleOwnVideo(): void;
}

/**
 * One user in the camera dock: their video, or their avatar while it doesn't
 * show; a ring while they speak; their name; status badges; connection
 * quality bars on hover; and hover controls (mic and camera on your own tile,
 * a menu button on others').
 *
 * The element is kept for as long as the user is in the dock, so the video
 * keeps playing while the dock re-renders or the tile moves.
 */
export default class CameraTile {
  readonly element: HTMLElement;
  readonly video: HTMLVideoElement;
  private readonly avatar = new Avatar({ size: "fill" });
  private readonly name = el("span", { className: "livekit-tile-name" });
  private readonly secondaryName = el("span", {
    className: "livekit-tile-secondary",
  });
  private readonly badges = el("span", { className: "livekit-tile-badges" });
  private readonly quality = el("span", {
    className: "livekit-quality",
    attrs: { role: "img" },
    children: [el("span"), el("span"), el("span")],
  });
  private readonly muteButton?: HTMLButtonElement;
  private readonly videoButton?: HTMLButtonElement;

  constructor(
    readonly userId: string,
    readonly local: boolean,
    host: TileHost,
  ) {
    this.video = el("video", {
      className: `user-camera ${local ? "local-camera" : ""}`.trim(),
      attrs: { autoplay: "", playsinline: "" },
    });
    // Audio plays from elements of its own, which survive re-renders
    this.video.muted = true;

    const controls = el("div", { className: "livekit-tile-controls" });
    if (local) {
      this.muteButton = iconButton({
        icon: "fa-microphone",
        label: localize("mute"),
        onClick: () => {
          host.toggleOwnMute();
        },
      });
      this.videoButton = iconButton({
        icon: "fa-video",
        label: localize("cameraOff"),
        onClick: () => {
          host.toggleOwnVideo();
        },
      });
      controls.append(this.muteButton, this.videoButton);
    } else {
      const menuButton = iconButton({
        icon: "fa-ellipsis",
        label: localize("userOptions"),
        onClick: () => {
          const rect = menuButton.getBoundingClientRect();
          host.openMenu(userId, rect.left, rect.bottom, menuButton);
        },
      });
      menuButton.setAttribute("aria-haspopup", "menu");
      controls.append(menuButton);
    }

    this.element = el("div", {
      className: "livekit-tile",
      attrs: { "data-user": userId, role: "listitem", tabindex: "0" },
      children: [
        el("div", {
          className: "livekit-tile-media",
          children: [
            this.video,
            el("div", {
              className: "livekit-tile-avatar",
              children: [this.avatar.element],
            }),
          ],
        }),
        el("div", { className: "livekit-tile-ring" }),
        controls,
        el("div", {
          className: "livekit-tile-footer",
          children: [
            el("span", {
              className: "livekit-tile-names",
              children: [this.name, this.secondaryName],
            }),
            this.badges,
            this.quality,
          ],
        }),
      ],
    });

    this.element.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("button")) {
        host.activate(userId);
      }
    });
    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      host.openMenu(userId, event.clientX, event.clientY, this.element);
    });
    this.element.addEventListener("keydown", (event) => {
      if (event.target !== this.element) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        host.activate(userId);
      } else if (
        event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)
      ) {
        event.preventDefault();
        const rect = this.element.getBoundingClientRect();
        host.openMenu(userId, rect.left, rect.bottom, this.element);
      }
    });
  }

  update(context: UserContext, state: TileState): void {
    const { user, nameplates } = context;

    // Names, as Foundry's nameplates setting asks
    const charname = nameplates.charname ? context.charname : "";
    const primary = nameplates.playerName || !charname ? user.name : charname;
    this.name.textContent = primary;
    this.secondaryName.textContent =
      nameplates.playerName && charname ? charname : "";
    this.element.classList.toggle("no-nameplate", nameplates.hidden);
    this.element.ariaLabel = user.name;

    this.avatar.setSource(user.avatar);
    this.element.classList.toggle("is-video", state.showVideo);
    this.element.classList.toggle("is-focused", state.focused);
    this.element.classList.toggle("has-color", state.borderColor);
    this.element.style.setProperty("--lk-tile-color", userColor(user));
    this.setSpeaking(state.speaking);

    // Status badges
    const badges: BadgeOptions[] = [];
    if (state.muted) {
      badges.push({ icon: "fa-microphone-slash", label: localize("muted") });
    }
    if (state.deafened) {
      // There is no free "headphones slash" icon; the slash is drawn in CSS
      badges.push({
        icon: "fa-headphones",
        label: localize("deafened"),
        slashed: true,
      });
    }
    if (state.locallyMuted) {
      badges.push({
        icon: "fa-volume-xmark",
        label: localize("userLocalMute"),
      });
    }
    if (state.videoHiddenByMe) {
      badges.push({ icon: "fa-eye-slash", label: localize("videoHiddenByMe") });
    } else if (!context.hasVideo) {
      badges.push({ icon: "fa-video-slash", label: localize("cameraIsOff") });
    }
    this.badges.replaceChildren(...badges.map((options) => badge(options)));

    // Connection quality
    this.quality.dataset.quality = state.quality;
    setTooltip(
      this.quality,
      game.i18n?.localize(`${LANG_NAME}.connectionQuality.${state.quality}`) ??
        state.quality,
    );

    // Own controls
    if (this.muteButton) {
      setIconButtonState(this.muteButton, {
        icon: state.muted ? "fa-microphone-slash" : "fa-microphone",
        label: localize(state.muted ? "unmute" : "mute"),
        off: state.muted,
        pressed: state.muted,
      });
    }
    if (this.videoButton) {
      const videoOff = !context.hasVideo;
      setIconButtonState(this.videoButton, {
        icon: videoOff ? "fa-video-slash" : "fa-video",
        label: localize(videoOff ? "cameraOn" : "cameraOff"),
        off: videoOff,
        pressed: videoOff,
      });
    }
  }

  setSpeaking(speaking: boolean): void {
    this.element.classList.toggle("is-speaking", speaking);
    this.avatar.setSpeaking(speaking);
  }
}

/**
 * A user's color as a CSS color.
 */
function userColor(user: User): string {
  const color = user.color as unknown as { css?: string } | string | null;
  if (color && typeof color === "object" && color.css) {
    return color.css;
  }
  return typeof color === "string" ? color : "transparent";
}
