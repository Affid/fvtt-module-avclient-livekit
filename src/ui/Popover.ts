import { clamp, el, surface } from "./dom";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/**
 * A floating popup anchored to an element or a point. It closes when clicking
 * outside of it or pressing Escape, and removes its element when closed.
 * Focus returns to the anchor when the popover closes with focus inside it.
 *
 * It opens in the document of the element it belongs to, which may be the
 * camera dock's own window rather than Foundry's.
 */
export default class Popover {
  readonly element: HTMLElement;
  private anchor: HTMLElement | null = null;
  /** The document the popover is open in */
  private doc: Document = document;
  private expandedControl: HTMLElement | null = null;
  private readonly onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (
      target instanceof Node &&
      (this.element.contains(target) ||
        this.anchor?.contains(target) ||
        this.expandedControl?.contains(target))
    ) {
      return;
    }
    this.close();
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  };

  /**
   * @param className     CSS classes for the popover element
   * @param onClose       Called once when the popover closes
   * @param role          The popover's ARIA role
   */
  constructor(
    className: string,
    private readonly onClose?: () => void,
    role = "dialog",
  ) {
    this.element = surface(
      el("div", {
        className: `livekit-popover ${className}`,
        attrs: { role },
      }),
    );
  }

  get isOpen(): boolean {
    return this.element.isConnected;
  }

  /**
   * Show the popover above (or, without room, below) an element.
   * @param anchor    The element to place the popover against
   * @param control   The button that opened the popover, if not the anchor;
   *                  it is marked as expanded while the popover is open
   */
  openAt(anchor: HTMLElement, control: HTMLElement = anchor): void {
    this.anchor = anchor;
    this.setExpandedControl(control);
    this.show(anchor.ownerDocument);
    this.reposition();
  }

  /**
   * Show the popover at a point, e.g. where a context menu was requested.
   * @param control   The element the popover belongs to, which gets focus
   *                  back when it closes
   */
  openAtPoint(x: number, y: number, control?: HTMLElement): void {
    this.anchor = null;
    this.setExpandedControl(control ?? null);
    this.show(control?.ownerDocument ?? document);
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
      this.viewport.height - anchorRect.bottom - VIEWPORT_MARGIN - ANCHOR_GAP;

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
    const hadFocus = this.element.contains(this.doc.activeElement);
    this.doc.removeEventListener("pointerdown", this.onPointerDown, true);
    this.doc.removeEventListener("keydown", this.onKeyDown, true);
    this.element.remove();
    const control = this.expandedControl;
    this.setExpandedControl(null);
    this.anchor = null;
    if (hadFocus && control?.isConnected) {
      control.focus({ preventScroll: true });
    }
    this.onClose?.();
  }

  private setExpandedControl(control: HTMLElement | null): void {
    if (this.expandedControl?.hasAttribute("aria-expanded")) {
      this.expandedControl.setAttribute("aria-expanded", "false");
    }
    this.expandedControl = control;
    if (control instanceof HTMLButtonElement) {
      control.setAttribute("aria-expanded", "true");
    }
  }

  private show(doc: Document): void {
    if (this.isOpen && doc !== this.doc) {
      this.close();
    }
    if (!this.isOpen) {
      this.doc = doc;
      doc.body.append(this.element);
      doc.addEventListener("pointerdown", this.onPointerDown, true);
      doc.addEventListener("keydown", this.onKeyDown, true);
    }
  }

  /** The size of the window the popover is open in */
  private get viewport(): { width: number; height: number } {
    const view = this.doc.defaultView ?? window;
    return { width: view.innerWidth, height: view.innerHeight };
  }

  private place(left: number, top: number, width: number, height: number) {
    const viewport = this.viewport;
    this.element.style.left = `${clamp(
      left,
      VIEWPORT_MARGIN,
      viewport.width - width - VIEWPORT_MARGIN,
    ).toString()}px`;
    this.element.style.top = `${clamp(
      top,
      VIEWPORT_MARGIN,
      viewport.height - height - VIEWPORT_MARGIN,
    ).toString()}px`;
  }
}
