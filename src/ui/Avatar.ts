import { el, icon } from "./dom";

export const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";

export interface BadgeOptions {
  icon: string;
  label: string;
  /** Draw a slash over the icon (there is no "headphones slash" icon) */
  slashed?: boolean;
}

/**
 * A small round status icon, e.g. a muted microphone.
 */
export function badge({ icon: iconName, label, slashed }: BadgeOptions) {
  return el("span", {
    className: `livekit-badge ${slashed ? "livekit-slashed" : ""}`.trim(),
    title: label,
    attrs: { role: "img" },
    children: [icon(iconName)],
  });
}

/**
 * A user's round avatar, with a green ring while they speak and status badges
 * on its corner.
 */
export default class Avatar {
  readonly element: HTMLElement;
  private readonly image = el("img", {
    className: "livekit-avatar-image",
    attrs: { alt: "", draggable: "false" },
  });
  private readonly badges = el("span", { className: "livekit-avatar-badges" });

  /**
   * @param size    "sm" (24px), "md" (32px), "lg" (80px), or "fill" to
   *                size it with CSS
   */
  constructor({
    src,
    size = "md",
    className = "",
  }: {
    src?: string | null;
    size?: "sm" | "md" | "lg" | "fill";
    className?: string;
  } = {}) {
    this.element = el("span", {
      className: `livekit-avatar livekit-avatar-${size} ${className}`.trim(),
      children: [this.image, this.badges],
    });
    this.setSource(src);
  }

  setSource(src?: string | null): void {
    // Users without an avatar have an empty one
    const source = src?.trim() ? src : DEFAULT_AVATAR;
    if (this.image.getAttribute("src") !== source) {
      this.image.setAttribute("src", source);
    }
  }

  setSpeaking(speaking: boolean): void {
    this.element.classList.toggle("is-speaking", speaking);
  }

  setBadges(badges: BadgeOptions[]): void {
    this.badges.replaceChildren(...badges.map((options) => badge(options)));
  }
}
