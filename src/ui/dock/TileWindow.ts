import { iconButton } from "../buttons";
import { localize } from "../controls";
import { el, surface } from "../dom";
import type CameraTile from "./CameraTile";
import { clampToViewport, makeDraggable, makeResizable } from "./drag";

const MIN_WIDTH = 160;

/**
 * A camera tile popped out of the dock into a window of its own, which can be
 * moved and resized. Its place is kept in Foundry's per-user A/V settings,
 * like Foundry's own popped-out camera views.
 */
export default class TileWindow {
  readonly element: HTMLElement;
  private readonly title = el("span", {
    className: "livekit-tile-window-title",
  });

  constructor(
    readonly tile: CameraTile,
    {
      left,
      top,
      width,
      onDock,
      onMove,
    }: {
      left?: number;
      top?: number;
      width?: number;
      /** Put the tile back in the dock */
      onDock: () => void;
      /** The window was moved or resized */
      onMove: (position: { left: number; top: number; width: number }) => void;
    },
  ) {
    const header = el("header", {
      className: "livekit-tile-window-header",
      children: [
        this.title,
        iconButton({
          icon: "fa-arrow-right-to-bracket",
          label: localize("returnToDock"),
          onClick: onDock,
        }),
      ],
    });
    const resizeHandle = el("div", {
      className: "livekit-resize-handle",
      attrs: { "aria-hidden": "true" },
    });
    this.element = surface(
      el("section", {
        className: "livekit-tile-window",
        attrs: { "data-user": tile.userId },
        children: [header, resizeHandle],
      }),
    );

    const report = () => {
      const rect = this.element.getBoundingClientRect();
      onMove({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      });
    };
    makeDraggable(header, this.element, report);
    makeResizable(resizeHandle, this.element, {
      edges: () => ["right"],
      minWidth: MIN_WIDTH,
      keepHeight: true,
      onEnd: report,
    });

    const position = clampToViewport({
      left: left ?? 100,
      top: top ?? 100,
      width: Math.max(width ?? 320, MIN_WIDTH),
      height: 0,
    });
    this.element.style.left = `${position.left.toString()}px`;
    this.element.style.top = `${position.top.toString()}px`;
    this.element.style.width = `${position.width.toString()}px`;
  }

  setTitle(title: string): void {
    this.title.textContent = title;
    this.element.ariaLabel = title;
  }
}
