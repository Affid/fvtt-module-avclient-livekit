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
 * The class of every top-level element of the Discord-style interface (the
 * voice panel, popovers, menus and the settings window). It sets the kit's
 * type and focus styles, and styles Foundry's tooltips for everything inside.
 */
export const SURFACE_CLASS = "livekit-surface";

/** Foundry adds this class to its tooltip for elements inside a surface */
const TOOLTIP_CLASS = "livekit-tooltip";

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
    setTooltip(element, title);
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
 * Make an element a surface of the Discord-style interface.
 */
export function surface<T extends HTMLElement>(element: T): T {
  element.classList.add(SURFACE_CLASS);
  element.dataset.tooltipClass = TOOLTIP_CLASS;
  return element;
}

/**
 * Give an element a tooltip (shown by Foundry's tooltip manager) and the same
 * accessible label.
 */
export function setTooltip(
  element: HTMLElement,
  label: string,
  direction?: "UP" | "DOWN" | "LEFT" | "RIGHT",
): void {
  element.dataset.tooltip = label;
  element.ariaLabel = label;
  if (direction) {
    element.dataset.tooltipDirection = direction;
  }
}

/**
 * Create a Font Awesome icon element, hidden from screen readers.
 */
export function icon(name: string, className = ""): HTMLElement {
  return el("i", {
    className: `fa-solid fa-fw ${name} ${className}`.trim(),
    attrs: { "aria-hidden": "true" },
  });
}

/**
 * Clamp a value to a range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

let nextId = 0;

/**
 * A document-unique element ID, e.g. to link a label to its control.
 */
export function uniqueId(prefix: string): string {
  nextId += 1;
  return `livekit-${prefix}-${nextId.toString()}`;
}
