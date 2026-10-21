/**
 * Small DOM helpers shared by the module's Discord-style UI components.
 */

type Child = Node | string | null | undefined | false;

interface ElementOptions {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  children?: Child[];
}

/**
 * Create an element with classes, text, attributes and children.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { className, text, title, attrs, children }: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  if (title) {
    element.dataset.tooltip = title;
    element.ariaLabel = title;
  }
  for (const [name, value] of Object.entries(attrs ?? {})) {
    element.setAttribute(name, value);
  }
  for (const child of children ?? []) {
    if (child) {
      element.append(child);
    }
  }
  return element;
}

/**
 * Create a Font Awesome icon element.
 */
export function icon(name: string, className = ""): HTMLElement {
  return el("i", { className: `fa-solid fa-fw ${name} ${className}`.trim() });
}

/**
 * Create an icon-only button.
 */
export function iconButton(
  iconName: string,
  title: string,
  onClick: (event: MouseEvent) => void,
  className = "",
): HTMLButtonElement {
  const button = el("button", {
    className: `livekit-icon-button ${className}`.trim(),
    title,
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
 * Clamp a value to a range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/**
 * A floating popup anchored to an element or a point. It closes when clicking
 * outside of it or pressing Escape, and removes its element when closed.
 */
export class Popover {
  readonly element: HTMLElement;
  private anchor: HTMLElement | null = null;
  private readonly onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (
      target instanceof Node &&
      (this.element.contains(target) || this.anchor?.contains(target))
    ) {
      return;
    }
    this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      this.close();
    }
  };

  /**
   * @param className     CSS classes for the popover element
   * @param onClose       Called once when the popover closes
   */
  constructor(
    className: string,
    private readonly onClose?: () => void,
  ) {
    this.element = el("div", {
      className: `livekit-popover ${className}`,
      attrs: { role: "dialog" },
    });
  }

  get isOpen(): boolean {
    return this.element.isConnected;
  }

  /**
   * Show the popover above (or, without room, below) an element.
   */
  openAt(anchor: HTMLElement): void {
    this.anchor = anchor;
    this.show();
    this.reposition();
  }

  /**
   * Show the popover at a point, e.g. where a context menu was requested.
   */
  openAtPoint(x: number, y: number): void {
    this.anchor = null;
    this.show();
    const { width, height } = this.element.getBoundingClientRect();
    this.place(x, y, width, height);
  }

  /**
   * Re-position the popover against its anchor, e.g. after its content
   * changed size.
   */
  reposition(): void {
    if (!this.anchor || !this.isOpen) {
      return;
    }
    const anchorRect = this.anchor.getBoundingClientRect();
    const roomAbove = anchorRect.top - VIEWPORT_MARGIN - ANCHOR_GAP;
    const roomBelow =
      window.innerHeight - anchorRect.bottom - VIEWPORT_MARGIN - ANCHOR_GAP;

    // Open on the side with room, and limit the height to that room (the
    // content scrolls) rather than covering the anchor
    this.element.style.removeProperty("--livekit-popover-room");
    const naturalHeight = this.element.getBoundingClientRect().height;
    const above = roomAbove >= naturalHeight || roomAbove >= roomBelow;
    this.element.style.setProperty(
      "--livekit-popover-room",
      `${Math.max(above ? roomAbove : roomBelow, 0).toString()}px`,
    );

    const { width, height } = this.element.getBoundingClientRect();
    const top = above
      ? anchorRect.top - height - ANCHOR_GAP
      : anchorRect.bottom + ANCHOR_GAP;
    this.place(anchorRect.left, top, width, height);
  }

  close(): void {
    if (!this.isOpen) {
      return;
    }
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    this.element.remove();
    this.anchor = null;
    this.onClose?.();
  }

  private show(): void {
    if (!this.isOpen) {
      document.body.append(this.element);
      document.addEventListener("pointerdown", this.onPointerDown, true);
      document.addEventListener("keydown", this.onKeyDown, true);
    }
  }

  private place(left: number, top: number, width: number, height: number) {
    this.element.style.left = `${clamp(
      left,
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN,
    ).toString()}px`;
    this.element.style.top = `${clamp(
      top,
      VIEWPORT_MARGIN,
      window.innerHeight - height - VIEWPORT_MARGIN,
    ).toString()}px`;
  }
}
