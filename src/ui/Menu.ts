import { Logger } from "../utils/logger";
import Popover from "./Popover";
import { el, icon } from "./dom";

const log = new Logger("Menu");

interface ItemBase {
  label: string;
  /** A second, smaller line under the label */
  detail?: string;
  disabled?: boolean;
}

export type MenuItem =
  | { type: "header"; label: string }
  | { type: "separator" }
  | (ItemBase & {
      type: "action";
      icon?: string;
      danger?: boolean;
      /** Keep the menu open after choosing the item */
      keepOpen?: boolean;
      onSelect: () => unknown;
    })
  | (ItemBase & {
      type: "checkbox" | "radio";
      checked: boolean;
      /** The menu stays open and is rebuilt once this settles */
      onSelect: () => unknown;
    })
  /** Any other content, e.g. a slider; its inputs join the arrow key focus */
  | { type: "custom"; element: HTMLElement };

const FOCUSABLE =
  ".livekit-menu-item:not(:disabled), .livekit-menu-custom :is(input, select, button):not(:disabled)";

/**
 * A Discord-style menu, opened from a button or as a context menu: actions,
 * checkboxes, radio items, headers, separators, and custom content. The arrow
 * keys, Home and End move between items; Escape closes it.
 *
 * The content is rebuilt from `build` each time the menu opens and after a
 * checkbox or radio item is chosen, so it always shows the current state.
 */
export default class Menu {
  private readonly popover: Popover;

  /**
   * @param className   CSS classes for the menu element
   * @param label       Returns the menu's accessible name
   * @param build       Returns the menu's items
   */
  constructor(
    className: string,
    private readonly label: () => string,
    private readonly build: () => MenuItem[],
    onClose?: () => void,
  ) {
    this.popover = new Popover(`livekit-menu ${className}`, onClose, "menu");
    this.popover.element.tabIndex = -1;
    this.popover.element.addEventListener("keydown", this.onKeyDown);
  }

  get element(): HTMLElement {
    return this.popover.element;
  }

  get isOpen(): boolean {
    return this.popover.isOpen;
  }

  /**
   * Open the menu against an element.
   * @param anchor    The element to place the menu against
   * @param control   The button that opened the menu, if not the anchor
   */
  openAt(anchor: HTMLElement, control: HTMLElement = anchor): void {
    this.render();
    this.popover.openAt(anchor, control);
    this.element.focus({ preventScroll: true });
  }

  /**
   * Open the menu at a point, e.g. as a context menu.
   * @param control   The element the menu belongs to
   */
  openAtPoint(x: number, y: number, control?: HTMLElement): void {
    this.render();
    this.popover.openAtPoint(x, y, control);
    this.element.focus({ preventScroll: true });
  }

  toggle(anchor: HTMLElement, control: HTMLElement = anchor): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.openAt(anchor, control);
    }
  }

  close(): void {
    this.popover.close();
  }

  /**
   * Rebuild the content, e.g. after the state it shows changed. Focus stays
   * on the item at the same position.
   */
  refresh(): void {
    if (!this.isOpen) {
      return;
    }
    const items = this.focusableItems();
    const focused = items.findIndex(
      (item) => item === this.element.ownerDocument.activeElement,
    );
    this.render();
    this.popover.reposition();
    if (focused >= 0) {
      this.focusableItems()[focused]?.focus({ preventScroll: true });
    }
  }

  private render(): void {
    this.element.ariaLabel = this.label();
    this.element.replaceChildren(
      ...this.build().map((item) => this.renderItem(item)),
    );
  }

  private renderItem(item: MenuItem): HTMLElement {
    switch (item.type) {
      case "header":
        return el("div", {
          className: "livekit-menu-header",
          text: item.label,
          attrs: { role: "presentation" },
        });
      case "separator":
        return el("div", {
          className: "livekit-menu-separator",
          attrs: { role: "separator" },
        });
      case "custom":
        return el("div", {
          className: "livekit-menu-custom",
          children: [item.element],
        });
    }

    const button = el("button", {
      className: "livekit-menu-item",
      attrs: { type: "button", tabindex: "-1" },
      children: [
        el("span", {
          className: "livekit-menu-item-text",
          children: [
            el("span", {
              className: "livekit-menu-item-label",
              text: item.label,
            }),
            item.detail &&
              el("span", {
                className: "livekit-menu-item-detail",
                text: item.detail,
              }),
          ],
        }),
      ],
    });
    button.disabled = !!item.disabled;

    if (item.type === "action") {
      button.setAttribute("role", "menuitem");
      button.classList.toggle("is-danger", !!item.danger);
      if (item.icon) {
        button.append(icon(item.icon, "livekit-menu-item-icon"));
      }
    } else {
      button.setAttribute(
        "role",
        item.type === "radio" ? "menuitemradio" : "menuitemcheckbox",
      );
      button.setAttribute("aria-checked", String(item.checked));
      button.classList.toggle("is-checked", item.checked);
      button.append(
        el("span", {
          className: `livekit-menu-${item.type}`,
          attrs: { "aria-hidden": "true" },
          children: [item.type === "checkbox" && icon("fa-check")],
        }),
      );
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const keepOpen = item.type !== "action" || !!item.keepOpen;
      if (!keepOpen) {
        this.close();
      }
      Promise.resolve(item.onSelect())
        .catch((error: unknown) => {
          log.error("Error choosing a menu item:", error);
        })
        .finally(() => {
          if (keepOpen) {
            this.refresh();
          }
        });
    });
    return button;
  }

  private focusableItems(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const items = this.focusableItems();
    if (!items.length) {
      return;
    }
    const focused = this.element.ownerDocument.activeElement;
    // Sliders keep Home and End (and left/right) for their value
    if (
      focused instanceof HTMLInputElement &&
      focused.type === "range" &&
      (event.key === "Home" || event.key === "End")
    ) {
      return;
    }
    const current = items.findIndex((item) => item === focused);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : (current + 1) % items.length;
        break;
      case "ArrowUp":
        next = current < 0 ? items.length - 1 : current - 1;
        if (next < 0) {
          next = items.length - 1;
        }
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[next].focus({ preventScroll: true });
  };
}
