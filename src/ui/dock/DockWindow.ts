import { getPushToTalkBindings } from "../controls";

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

function documentPictureInPicture(): DocumentPictureInPicture | undefined {
  return (
    window as unknown as {
      documentPictureInPicture?: DocumentPictureInPicture;
    }
  ).documentPictureInPicture;
}

/**
 * Whether the browser can show the camera dock in a window of its own:
 * Document Picture-in-Picture, in Chrome and Edge. LiveKit knows videos in
 * it are visible, so it keeps sending them while Foundry is in the
 * background.
 */
export function supportsDockWindow(): boolean {
  return !!documentPictureInPicture();
}

/**
 * The camera dock's own window: an always-on-top Picture-in-Picture window
 * with Foundry's styles, which the dock moves its content into.
 */
export default class DockWindow {
  /** Elements given a native tooltip in the window, to take it off again */
  private readonly titled = new Set<HTMLElement>();

  private constructor(
    readonly window: Window,
    private readonly onClose: () => void,
  ) {
    copyStyles(window.document);
    window.addEventListener("pagehide", this.onPageHide, { once: true });
    // Foundry's tooltips only work in its own window: use native ones
    window.document.addEventListener("pointerover", this.onPointerOver);
    // Push to talk keeps working while the window has focus
    for (const type of ["keydown", "keyup"] as const) {
      window.addEventListener(type, this.forwardPushToTalk);
    }
  }

  /**
   * Open the window. It must be called from a user's action, e.g. a click.
   *
   * @param onClose   Called once when the window closes, however it closes
   */
  static async open(
    size: { width: number; height: number },
    title: string,
    onClose: () => void,
  ): Promise<DockWindow | undefined> {
    const pictureInPicture = documentPictureInPicture();
    if (!pictureInPicture) {
      return undefined;
    }
    const pipWindow = await pictureInPicture.requestWindow({
      width: Math.round(size.width),
      height: Math.round(size.height),
    });
    pipWindow.document.title = title;
    return new DockWindow(pipWindow, onClose);
  }

  get document(): Document {
    return this.window.document;
  }

  close(): void {
    this.window.close();
  }

  private readonly onPageHide = () => {
    for (const element of this.titled) {
      element.removeAttribute("title");
    }
    this.titled.clear();
    this.onClose();
  };

  private readonly onPointerOver = (event: Event) => {
    // Elements here may come from either window, so no instanceof checks
    const source = event.target as Partial<Element> | null;
    const target =
      typeof source?.closest === "function"
        ? source.closest<HTMLElement>("[data-tooltip]")
        : null;
    const text = target?.dataset.tooltip;
    if (target && text && target.title !== text) {
      target.title = text;
      this.titled.add(target);
    }
  };

  private readonly forwardPushToTalk = (event: KeyboardEvent) => {
    const bindings = getPushToTalkBindings() ?? [];
    if (!bindings.some((binding) => binding.key === event.code)) {
      return;
    }
    // Foundry's keybindings listen in its own window
    document.body.dispatchEvent(
      new KeyboardEvent(event.type, {
        key: event.key,
        code: event.code,
        location: event.location,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    event.preventDefault();
  };
}

/**
 * Give a document Foundry's styles, theme and fonts: link the same style
 * sheets (so their relative URLs resolve), copy inline ones, and copy the
 * classes the styles depend on.
 */
function copyStyles(target: Document): void {
  const base = target.createElement("base");
  base.href = document.baseURI;
  target.head.append(base);
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      if (sheet.media.mediaText) {
        link.media = sheet.media.mediaText;
      }
      target.head.append(link);
      continue;
    }
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      target.head.append(style);
    } catch {
      // A style sheet that can't be read can't be copied
    }
  }
  target.documentElement.className = document.documentElement.className;
  const rootStyle = document.documentElement.getAttribute("style");
  if (rootStyle) {
    target.documentElement.setAttribute("style", rootStyle);
  }
  target.body.className = `${document.body.className} livekit-dock-window`;
}
