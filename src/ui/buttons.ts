/**
 * Buttons of the Discord-style interface: icon buttons with toggle states, and
 * text buttons.
 */
import { el, icon, setTooltip } from "./dom";

export interface IconButtonState {
  icon?: string;
  label?: string;
  /** A feature is on, e.g. noise suppression (green) */
  active?: boolean;
  /** Something is off that is normally on, e.g. a muted microphone (red) */
  off?: boolean;
  /** Draw a slash over the icon (there is no "headphones slash" icon) */
  slashed?: boolean;
  /** For toggle buttons, whether the toggle is on */
  pressed?: boolean;
  disabled?: boolean;
}

/**
 * Create an icon-only button. Its label is the tooltip and accessible name.
 * `danger` buttons turn red on hover, e.g. disconnect.
 */
export function iconButton({
  icon: iconName,
  label,
  onClick,
  className = "",
  danger = false,
}: {
  icon: string;
  label: string;
  onClick: (event: MouseEvent) => void;
  className?: string;
  danger?: boolean;
}): HTMLButtonElement {
  const button = el("button", {
    className: `livekit-icon-button ${danger ? "is-danger" : ""} ${className}`
      .replace(/\s+/g, " ")
      .trim(),
    title: label,
    attrs: { type: "button" },
    children: [icon(iconName)],
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

/**
 * Update an icon button's icon, label and states. Unset fields are kept.
 */
export function setIconButtonState(
  button: HTMLButtonElement,
  state: IconButtonState,
): void {
  if (state.icon !== undefined) {
    button.replaceChildren(icon(state.icon));
  }
  if (state.label !== undefined) {
    setTooltip(button, state.label);
  }
  if (state.active !== undefined) {
    button.classList.toggle("is-active", state.active);
  }
  if (state.off !== undefined) {
    button.classList.toggle("is-off", state.off);
  }
  if (state.slashed !== undefined) {
    button.classList.toggle("livekit-slashed", state.slashed);
  }
  if (state.pressed !== undefined) {
    button.setAttribute("aria-pressed", String(state.pressed));
  }
  if (state.disabled !== undefined) {
    button.disabled = state.disabled;
  }
}

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "link"
  | "patreon";

/**
 * Create a text button. Without `onClick`, a "submit" button submits its
 * form.
 */
export function button({
  label,
  variant = "secondary",
  icon: iconElement,
  type = "button",
  onClick,
}: {
  label: string;
  variant?: ButtonVariant;
  /** An icon element to show before the label */
  icon?: HTMLElement;
  type?: "button" | "submit";
  onClick?: () => void;
}): HTMLButtonElement {
  const element = el("button", {
    className:
      variant === "link"
        ? "livekit-link-button"
        : `livekit-button livekit-button-${variant}`,
    attrs: { type },
    children: [iconElement, el("span", { text: label })],
  });
  if (onClick) {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
  }
  return element;
}
