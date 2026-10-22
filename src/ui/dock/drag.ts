import { clamp } from "../dom";

const MARGIN = 8;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Keep a box within the window.
 */
export function clampToViewport(rect: Rect): Rect {
  const width = Math.min(rect.width, window.innerWidth - 2 * MARGIN);
  const height = Math.min(rect.height, window.innerHeight - 2 * MARGIN);
  return {
    width,
    height,
    left: clamp(rect.left, MARGIN, window.innerWidth - width - MARGIN),
    top: clamp(rect.top, MARGIN, window.innerHeight - height - MARGIN),
  };
}

/**
 * Follow a pointer drag that starts on `handle` with the primary button,
 * ignoring drags that start on buttons and other controls.
 */
function onDrag(
  handle: HTMLElement,
  onStart: () => void,
  onMove: (dx: number, dy: number) => void,
  onEnd: () => void,
): void {
  handle.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest("button, input, select, a")
    ) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
    onStart();
    const move = (moveEvent: PointerEvent) => {
      onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onEnd();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}

/**
 * Move a fixed-position element by dragging `handle`.
 * @param onEnd   Gets the element's box once the drag ends
 */
export function makeDraggable(
  handle: HTMLElement,
  target: HTMLElement,
  onEnd: (rect: Rect) => void,
): void {
  let start: DOMRect;
  onDrag(
    handle,
    () => {
      start = target.getBoundingClientRect();
      target.classList.add("dragging");
    },
    (dx, dy) => {
      const rect = clampToViewport({
        left: start.left + dx,
        top: start.top + dy,
        width: start.width,
        height: start.height,
      });
      target.style.left = `${rect.left.toString()}px`;
      target.style.top = `${rect.top.toString()}px`;
    },
    () => {
      target.classList.remove("dragging");
      const { left, top, width, height } = target.getBoundingClientRect();
      onEnd({ left, top, width, height });
    },
  );
}

export type Edge = "right" | "bottom" | "left" | "top";

/**
 * Resize an element by dragging `handle`, on the edges `edges` returns when
 * the drag starts.
 * @param onEnd   Gets the element's box once the drag ends
 */
export function makeResizable(
  handle: HTMLElement,
  target: HTMLElement,
  {
    edges,
    minWidth,
    minHeight = 0,
    keepHeight = false,
    onEnd,
  }: {
    edges: () => Edge[];
    minWidth: number;
    minHeight?: number;
    /** Only change the width; the height follows the content */
    keepHeight?: boolean;
    onEnd: (rect: Rect) => void;
  },
): void {
  let start: DOMRect;
  let dragEdges: Edge[] = [];
  onDrag(
    handle,
    () => {
      start = target.getBoundingClientRect();
      dragEdges = edges();
      target.classList.add("resizing");
    },
    (dx, dy) => {
      if (dragEdges.includes("right")) {
        target.style.width = `${Math.max(start.width + dx, minWidth).toString()}px`;
      }
      if (dragEdges.includes("left")) {
        target.style.width = `${Math.max(start.width - dx, minWidth).toString()}px`;
      }
      if (!keepHeight && dragEdges.includes("bottom")) {
        target.style.height = `${Math.max(start.height + dy, minHeight).toString()}px`;
      }
      if (!keepHeight && dragEdges.includes("top")) {
        target.style.height = `${Math.max(start.height - dy, minHeight).toString()}px`;
      }
    },
    () => {
      target.classList.remove("resizing");
      const { left, top, width, height } = target.getBoundingClientRect();
      onEnd({ left, top, width, height });
    },
  );
}
