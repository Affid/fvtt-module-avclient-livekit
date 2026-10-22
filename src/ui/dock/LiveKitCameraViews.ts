import { ConnectionQuality } from "livekit-client";
import type { DockFloatingState } from "../../../types/avclient-livekit";
import type LiveKitClient from "../../LiveKitClient";
import { MODULE_NAME } from "../../utils/constants";
import { Logger } from "../../utils/logger";
import { iconButton, setIconButtonState } from "../buttons";
import { localize } from "../controls";
import { el, icon, surface } from "../dom";
import Menu, { type MenuItem } from "../Menu";
import CameraTile, { type TileState, type UserContext } from "./CameraTile";
import TileWindow from "./TileWindow";
import {
  clampToViewport,
  makeDraggable,
  makeResizable,
  type Edge,
  type Rect,
} from "./drag";

const log = new Logger("LiveKitCameraViews");

export type DockLayout = "grid" | "focus" | "compact";
type DockPosition = "left" | "right" | "top" | "bottom";

const LAYOUTS: { layout: DockLayout; icon: string }[] = [
  { layout: "grid", icon: "fa-table-cells-large" },
  { layout: "focus", icon: "fa-expand" },
  { layout: "compact", icon: "fa-list" },
];
const POSITIONS: DockPosition[] = ["left", "right", "top", "bottom"];

const MIN_DOCK_WIDTH = 160;
const MAX_DOCK_WIDTH = 640;
const MIN_FLOATING: Rect = { left: 0, top: 0, width: 240, height: 160 };
// How long a new speaker must keep speaking before the focus follows them
const FOLLOW_DELAY_MS = 800;

/**
 * The parts of Foundry's CameraViews the dock builds on. The types know it
 * only as of Foundry v13.
 */
interface CameraViewsBase {
  element: HTMLElement;
  rendered: boolean;
  readonly hidden: boolean;
  readonly isVertical: boolean;
  readonly isHorizontal: boolean;
  render(options?: object): Promise<unknown>;
  _prepareUserContext(userId: string): UserContext | undefined;
  _onRender(context: object, options: object): Promise<void>;
  _onFirstRender(context: object, options: object): Promise<void>;
  _configureRenderOptions(options: object): void;
}

const CameraViews = foundry.applications.apps.av
  .CameraViews as unknown as (new (options?: object) => CameraViewsBase) & {
  _sortUsers(a: UserContext, b: UserContext): number;
};

/**
 * The Discord-style camera dock, used in place of Foundry's when the
 * Discord-style interface is on. It keeps Foundry's camera dock API (it is
 * `ui.webrtc`), and Foundry's settings for where the dock is, its width,
 * collapsing it, nameplates, border colors, and each user's popped out and
 * hidden state, but draws its own tiles:
 *
 * - Layouts: a grid, one user in focus with the others in a strip, or a
 *   compact list of avatars.
 * - Docked on any side of the screen, or floating (moved by its header and
 *   resized by its corner), and collapsed to a slim bar.
 * - Tiles can be popped out into windows of their own.
 *
 * The tiles are kept between renders, so videos never restart.
 */
export default class LiveKitCameraViews extends CameraViews {
  static DEFAULT_OPTIONS = {
    classes: ["livekit-dock"],
    // The dock places and sizes itself (see place)
    window: { positioned: false },
  };

  private readonly tiles = new Map<string, CameraTile>();
  private readonly windows = new Map<string, TileWindow>();
  private readonly contexts = new Map<string, UserContext>();
  private focusUserId?: string;
  /** The focus was picked, rather than chosen by default */
  private focusPicked = false;
  private followTimer?: number;
  private built = false;

  private readonly title = el("span", { className: "livekit-dock-count" });
  private readonly stage = el("div", { className: "livekit-dock-stage" });
  private readonly list = el("div", {
    className: "livekit-dock-list",
    attrs: { role: "list" },
  });
  /** Where the voice panel goes when it is in the dock */
  readonly panelSlot = el("div", { className: "livekit-dock-panel" });
  private readonly resizeHandle = el("div", {
    className: "livekit-resize-handle",
    attrs: { "aria-hidden": "true" },
  });
  private readonly layoutButton = iconButton({
    icon: "fa-table-cells-large",
    label: localize("dockView"),
    onClick: () => {
      this.viewMenu.toggle(this.layoutButton);
    },
  });
  private readonly collapseButton = iconButton({
    icon: "fa-chevron-left",
    label: localize("dockCollapse"),
    onClick: () => {
      void this.setCollapsed(!this.collapsed);
    },
  });
  private readonly viewMenu = new Menu(
    "livekit-dock-menu",
    () => localize("dockView"),
    () => this.viewMenuItems(),
  );

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  private get client(): LiveKitClient | undefined {
    return game.webrtc?.client._liveKitClient;
  }

  get layout(): DockLayout {
    const layout = game.settings?.get(MODULE_NAME, "dockLayout");
    return layout === "focus" || layout === "compact" ? layout : "grid";
  }

  private get floatingState(): DockFloatingState {
    return (
      game.settings?.get(MODULE_NAME, "dockFloating") ?? {
        floating: false,
      }
    );
  }

  get isFloating(): boolean {
    return this.floatingState.floating;
  }

  private get collapsed(): boolean {
    return game.webrtc?.settings.client.hideDock === true;
  }

  private get dockPosition(): DockPosition {
    const position = game.webrtc?.settings.client.dockPosition;
    return POSITIONS.find((entry) => entry === position) ?? "left";
  }

  /**
   * A floating dock takes no room from the rest of the interface, so Foundry
   * doesn't make room for it (e.g. in the hotbar).
   * @override
   */
  get isVertical(): boolean {
    return !this.isFloating && super.isVertical;
  }

  /** @override */
  get isHorizontal(): boolean {
    return !this.isFloating && super.isHorizontal;
  }

  /* -------------------------------------------- */
  /*  Foundry's camera dock API                   */
  /* -------------------------------------------- */

  /** @override */
  getUserCameraView(userId: string): HTMLElement | null {
    return this.tiles.get(userId)?.element ?? null;
  }

  /** @override */
  getUserVideoElement(userId: string): HTMLVideoElement | null {
    return this.tiles.get(userId)?.video ?? null;
  }

  /**
   * Foundry calls this with whether a user intends to broadcast (e.g. always
   * in Voice Activity mode), not whether they speak. The dock shows who
   * speaks from LiveKit instead (see setSpeaking).
   * @override
   */
  setUserIsSpeaking(): void {
    // Ignored
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * No template parts: the dock builds its own content.
   * @override
   */
  _configureRenderParts(): Record<string, never> {
    return {};
  }

  /** @override */
  _configureRenderOptions(options: { parts?: string[] }): void {
    super._configureRenderOptions(options);
    // Foundry asks to render single users; the dock always updates as a
    // whole, and Foundry's own handling of user parts doesn't apply
    options.parts = [];
  }

  /** @override */
  _renderHTML(): Promise<Record<string, never>> {
    return Promise.resolve({});
  }

  /** @override */
  _replaceHTML(_result: unknown, content: HTMLElement): void {
    if (!this.built) {
      this.build(content);
    }
    this.sync();
  }

  /** @override */
  async _onRender(context: object, options: object): Promise<void> {
    // Foundry's camera dock places the dock next to the interface
    await super._onRender(context, options);
    this.place();
    this.attachMedia();
    // The voice panel may live in the dock, or float above the player list,
    // which moves with the dock
    this.client?.voicePanelIfCreated?.sync();
  }

  /** @override */
  async _onFirstRender(context: object, options: object): Promise<void> {
    await super._onFirstRender(context, options);
    window.addEventListener("resize", this.onWindowResize);
  }

  /**
   * Keep a floating dock and popped out tiles within the window.
   */
  private readonly onWindowResize = foundry.utils.debounce(() => {
    if (this.isFloating) {
      this.place();
    }
    for (const window of this.windows.values()) {
      const rect = window.element.getBoundingClientRect();
      const clamped = clampToViewport(rect);
      window.element.style.left = `${clamped.left.toString()}px`;
      window.element.style.top = `${clamped.top.toString()}px`;
    }
  }, 100);

  private build(content: HTMLElement): void {
    this.built = true;
    surface(this.element);
    this.element.setAttribute("role", "region");
    this.element.ariaLabel = localize("dock");

    const header = el("header", {
      className: "livekit-dock-header",
      children: [
        el("span", {
          className: "livekit-dock-title",
          children: [icon("fa-volume-high"), this.title],
        }),
        el("div", {
          className: "livekit-dock-tools",
          children: [this.layoutButton, this.collapseButton],
        }),
      ],
    });
    this.layoutButton.setAttribute("aria-haspopup", "menu");

    makeDraggable(header, this.element, (rect) => {
      if (this.isFloating) {
        void this.saveFloating(rect);
      }
    });
    // A docked dock only resizes on its inner edge; a floating one by its
    // corner
    const innerEdge: Record<DockPosition, Edge> = {
      left: "right",
      right: "left",
      top: "bottom",
      bottom: "top",
    };
    makeResizable(this.resizeHandle, this.element, {
      edges: () =>
        this.isFloating ? ["right", "bottom"] : [innerEdge[this.dockPosition]],
      minWidth: MIN_DOCK_WIDTH,
      minHeight: MIN_FLOATING.height,
      onEnd: (rect) => {
        this.onResized(rect);
      },
    });
    header.addEventListener(
      "pointerdown",
      (event) => {
        // Only a floating dock moves
        if (!this.isFloating) {
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );

    content.replaceChildren(
      header,
      el("div", {
        className: "livekit-dock-body",
        children: [this.stage, this.list],
      }),
      this.panelSlot,
      this.resizeHandle,
    );
  }

  /**
   * Bring the tiles up to date with the connected users and their state.
   */
  private sync(): void {
    const client = this.client;
    const avClient = game.webrtc?.client;
    if (!client || !avClient) {
      return;
    }

    // The users to show, in Foundry's order
    const contexts = avClient
      .getConnectedUsers()
      .map((userId) => this._prepareUserContext(userId))
      .filter(
        (context): context is UserContext =>
          !!context && !context.settings.blocked,
      )
      .sort((a, b) => CameraViews._sortUsers(a, b));
    this.contexts.clear();
    for (const context of contexts) {
      this.contexts.set(context.user.id ?? "", context);
    }

    // Remove the tiles of users who left
    for (const [userId, tile] of this.tiles) {
      if (!this.contexts.has(userId)) {
        this.removeTile(userId, tile);
      }
    }

    if (!this.focusUserId || !this.contexts.has(this.focusUserId)) {
      this.focusPicked = false;
    }
    if (!this.focusPicked) {
      this.focusUserId = this.defaultFocus(contexts);
    }

    // Where the next tile goes in each container, so tiles only move when
    // their place changes
    const cursors = new Map<HTMLElement, Element | null>([
      [this.stage, this.stage.firstElementChild],
      [this.list, this.list.firstElementChild],
    ]);
    for (const context of contexts) {
      const userId = context.user.id ?? "";
      let tile = this.tiles.get(userId);
      if (!tile) {
        tile = new CameraTile(userId, context.local, this.tileHost);
        this.tiles.set(userId, tile);
      }
      tile.update(context, this.tileState(context));
      this.placeTile(tile, context, cursors);
    }

    const count = contexts.length;
    this.title.textContent =
      game.i18n?.format("LIVEKITAVCLIENT.dockCount", {
        count: count.toString(),
      }) ?? count.toString();
    this.element.dataset.count = count.toString();
    this.updateTools();
  }

  /**
   * Refresh the tiles without a full render, e.g. after a user's voice state
   * changed.
   */
  refresh(): void {
    if (this.rendered && this.built) {
      this.sync();
    }
  }

  /**
   * Show whether a user is speaking. In the focus layout, the focus can
   * follow whoever speaks.
   */
  setSpeaking(userId: string, speaking: boolean): void {
    this.tiles.get(userId)?.setSpeaking(speaking);
    if (
      !speaking ||
      this.layout !== "focus" ||
      !(game.settings?.get(MODULE_NAME, "dockFollowSpeaker") ?? false) ||
      userId === game.user?.id ||
      userId === this.focusUserId
    ) {
      return;
    }
    window.clearTimeout(this.followTimer);
    this.followTimer = window.setTimeout(() => {
      if (this.layout === "focus" && this.client?.isUserSpeaking(userId)) {
        this.focus(userId);
      }
    }, FOLLOW_DELAY_MS);
  }

  private tileState(context: UserContext): TileState {
    const client = this.client;
    const userId = context.user.id ?? "";
    const videoHiddenByMe =
      game.settings?.get(MODULE_NAME, "userVideoHidden")[userId] === true;
    const quality =
      client?.liveKitParticipants.get(userId)?.connectionQuality ??
      ConnectionQuality.Unknown;
    return {
      speaking: client?.isUserSpeaking(userId) ?? false,
      muted: client?.isUserMuted(userId) ?? false,
      deafened: client?.voiceControls.isUserDeafened(userId) ?? false,
      locallyMuted: client?.userAudioMixer.isLocallyMuted(userId) ?? false,
      videoHiddenByMe,
      showVideo:
        context.video.show &&
        !videoHiddenByMe &&
        (client?.isUserVideoOn(userId) ?? false),
      quality,
      borderColor: game.webrtc?.settings.client.borderColors === true,
      focused: this.layout === "focus" && userId === this.focusUserId,
      cameraUsed: client?.voiceControls.canUseCamera() ?? true,
    };
  }

  /**
   * The user the focus layout shows large when no one was picked: the first
   * other user with video, else the first other user, else ourselves.
   */
  private defaultFocus(contexts: UserContext[]): string | undefined {
    // Popped out users have windows of their own
    const docked = contexts.filter((context) => !context.settings.popout);
    const others = docked.filter((context) => !context.local);
    const choice =
      others.find((context) => context.hasVideo) ??
      others.at(0) ??
      docked.at(0);
    return choice?.user.id ?? undefined;
  }

  /**
   * Put a tile where it belongs: in its own window if popped out, the stage
   * if it is in focus, or the list.
   */
  private placeTile(
    tile: CameraTile,
    context: UserContext,
    cursors: Map<HTMLElement, Element | null>,
  ): void {
    const userId = tile.userId;
    if (context.settings.popout) {
      let window = this.windows.get(userId);
      if (!window) {
        window = new TileWindow(tile, {
          left: context.settings.left,
          top: context.settings.top,
          width: context.settings.width,
          onDock: () => {
            void this.setPoppedOut(userId, false);
          },
          onMove: (position) => {
            const current = game.webrtc?.settings.client.users[userId] ?? {};
            game.webrtc?.settings.set("client", `users.${userId}`, {
              ...current,
              ...position,
            });
          },
        });
        this.windows.set(userId, window);
        document.body.append(window.element);
      }
      window.setTitle(context.user.name);
      moveInto(window.element, tile, window.element.lastElementChild);
      return;
    }
    this.closeWindow(userId);
    const parent =
      this.layout === "focus" && userId === this.focusUserId
        ? this.stage
        : this.list;
    // A cursor whose tile moved elsewhere no longer marks a place here
    let cursor = cursors.get(parent) ?? null;
    if (cursor?.parentElement !== parent) {
      cursor = null;
    }
    if (tile.element === cursor) {
      cursors.set(parent, cursor.nextElementSibling);
    } else {
      moveInto(parent, tile, cursor);
    }
  }

  private removeTile(userId: string, tile: CameraTile): void {
    this.client?.getUserVideoTrack(userId)?.detach(tile.video);
    tile.element.remove();
    this.tiles.delete(userId);
    this.closeWindow(userId);
  }

  private closeWindow(userId: string): void {
    this.windows.get(userId)?.element.remove();
    this.windows.delete(userId);
  }

  /**
   * Attach each user's video (and audio) to their tile, as Foundry's camera
   * dock does after rendering.
   */
  private attachMedia(): void {
    const avClient = game.webrtc?.client;
    for (const [userId, tile] of this.tiles) {
      avClient?.setUserVideo(userId, tile.video).catch((error: unknown) => {
        log.error("Error setting the video of", userId, error);
      });
    }
  }

  /**
   * Place the dock: docked next to the interface (as Foundry already did) or
   * floating, and its size.
   */
  private place(): void {
    const element = this.element;
    const floating = this.isFloating;
    element.dataset.layout = this.layout;
    element.dataset.placement = floating ? "float" : this.dockPosition;
    element.classList.toggle("is-floating", floating);
    element.classList.toggle("is-collapsed", this.collapsed);
    element.classList.toggle(
      "hide-quality",
      !(game.settings?.get(MODULE_NAME, "displayConnectionQuality") ?? true),
    );

    const width = clampWidth(game.webrtc?.settings.client.dockWidth);
    if (floating) {
      const state = this.floatingState;
      const rect = clampToViewport({
        left: state.left ?? window.innerWidth - 480,
        top: state.top ?? 80,
        width: Math.max(state.width ?? 400, MIN_FLOATING.width),
        height: Math.max(state.height ?? 320, MIN_FLOATING.height),
      });
      Object.assign(element.style, {
        left: `${rect.left.toString()}px`,
        top: `${rect.top.toString()}px`,
        width: `${rect.width.toString()}px`,
        height: `${rect.height.toString()}px`,
      });
      element.style.removeProperty("--av-width");
    } else {
      for (const property of ["left", "top", "width", "height"]) {
        element.style.removeProperty(property);
      }
      element.style.setProperty("--av-width", `${width.toString()}px`);
    }
  }

  private updateTools(): void {
    const layout = LAYOUTS.find((entry) => entry.layout === this.layout);
    setIconButtonState(this.layoutButton, {
      icon: layout?.icon ?? "fa-table-cells-large",
    });
    const collapsed = this.collapsed;
    const towards: Record<DockPosition, [string, string]> = {
      left: ["left", "right"],
      right: ["right", "left"],
      top: ["up", "down"],
      bottom: ["down", "up"],
    };
    const [collapse, expand] = this.isFloating
      ? ["up", "down"]
      : towards[this.dockPosition];
    setIconButtonState(this.collapseButton, {
      icon: `fa-chevron-${collapsed ? expand : collapse}`,
      label: localize(collapsed ? "dockExpand" : "dockCollapse"),
      pressed: collapsed,
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  private readonly tileHost = {
    activate: (userId: string) => {
      // In the slim bar, a click opens the dock again
      if (this.collapsed) {
        void this.setCollapsed(false);
      } else if (this.layout !== "compact") {
        this.focus(userId);
      }
    },
    openMenu: (userId: string, x: number, y: number, control: HTMLElement) => {
      this.client?.userMenu.open(userId, x, y, control);
    },
    toggleOwnMute: () => {
      this.client?.voiceControls.toggleMute();
    },
    toggleOwnVideo: () => {
      this.client?.voiceControls.toggleCamera();
    },
  };

  /**
   * Whether the voice panel goes in the dock: when asked to and the dock
   * shows (it hides when every user is popped out).
   */
  canHostPanel(): boolean {
    return (
      this.rendered &&
      this.built &&
      !this.element.hidden &&
      (game.settings?.get(MODULE_NAME, "voicePanelInDock") ?? true)
    );
  }

  /**
   * Show a user large, in the focus layout.
   */
  focus(userId: string): void {
    this.focusUserId = userId;
    this.focusPicked = true;
    if (this.layout === "focus") {
      this.refresh();
    } else {
      void this.setLayout("focus");
    }
  }

  async setLayout(layout: DockLayout): Promise<void> {
    window.clearTimeout(this.followTimer);
    await game.settings?.set(MODULE_NAME, "dockLayout", layout);
    await this.render();
  }

  async setPlacement(position: DockPosition | "float"): Promise<void> {
    if (position === "float") {
      await this.saveFloating({ ...this.floatingState, floating: true });
    } else {
      await game.settings?.set(MODULE_NAME, "dockFloating", {
        ...this.floatingState,
        floating: false,
      });
      game.webrtc?.settings.set("client", "dockPosition", position);
    }
    await this.render();
    resizeHotbar();
  }

  async setCollapsed(collapsed: boolean): Promise<void> {
    game.webrtc?.settings.set("client", "hideDock", collapsed);
    await this.render();
    resizeHotbar();
  }

  /**
   * Pop a user's tile out into a window of its own, or put it back.
   */
  async setPoppedOut(userId: string, popout: boolean): Promise<void> {
    game.webrtc?.settings.set("client", `users.${userId}.popout`, popout);
    await this.render();
  }

  isPoppedOut(userId: string): boolean {
    return this.windows.has(userId);
  }

  /**
   * Show a user's video in the browser's picture-in-picture window.
   */
  async pictureInPicture(userId: string): Promise<void> {
    const video = this.tiles.get(userId)?.video;
    if (video && document.pictureInPictureEnabled) {
      await video.requestPictureInPicture();
    }
  }

  canPictureInPicture(userId: string): boolean {
    const tile = this.tiles.get(userId);
    return (
      document.pictureInPictureEnabled &&
      !!tile?.video.srcObject &&
      tile.element.classList.contains("is-video")
    );
  }

  private async saveFloating(state: Partial<DockFloatingState>): Promise<void> {
    await game.settings?.set(MODULE_NAME, "dockFloating", {
      ...this.floatingState,
      ...state,
      floating: state.floating ?? this.floatingState.floating,
    });
  }

  private onResized(rect: Rect): void {
    if (this.isFloating) {
      void this.saveFloating(rect);
      return;
    }
    // Docked: the width (or, on the top or bottom, the height) sets
    // Foundry's dock width
    const size = this.isHorizontal ? (rect.height * 4) / 3 : rect.width;
    game.webrtc?.settings.set("client", "dockWidth", clampWidth(size));
    void this.render();
  }

  private viewMenuItems(): MenuItem[] {
    const layout = this.layout;
    const placement = this.isFloating ? "float" : this.dockPosition;
    return [
      { type: "header", label: localize("dockLayoutTitle") },
      ...LAYOUTS.map(
        (entry): MenuItem => ({
          type: "radio",
          label: localize(`dockLayout.${entry.layout}`),
          checked: layout === entry.layout,
          onSelect: () => this.setLayout(entry.layout),
        }),
      ),
      {
        type: "checkbox",
        label: localize("dockFollowSpeaker"),
        detail: localize("dockFollowSpeakerHint"),
        checked: game.settings?.get(MODULE_NAME, "dockFollowSpeaker") ?? false,
        onSelect: () =>
          game.settings?.set(
            MODULE_NAME,
            "dockFollowSpeaker",
            !(game.settings.get(MODULE_NAME, "dockFollowSpeaker") ?? false),
          ),
      },
      {
        type: "checkbox",
        label: localize("voicePanelInDock"),
        checked: game.settings?.get(MODULE_NAME, "voicePanelInDock") ?? true,
        onSelect: () =>
          game.settings?.set(
            MODULE_NAME,
            "voicePanelInDock",
            !(game.settings.get(MODULE_NAME, "voicePanelInDock") ?? true),
          ),
      },
      { type: "separator" },
      { type: "header", label: localize("clientSetting.dockPosition") },
      ...[...POSITIONS, "float" as const].map(
        (position): MenuItem => ({
          type: "radio",
          label: localize(
            position === "float" ? "dockFloating" : `dockPosition.${position}`,
          ),
          checked: placement === position,
          onSelect: () => this.setPlacement(position),
        }),
      ),
    ];
  }
}

/**
 * Move a tile into a container, before `before` (or at the end), keeping its
 * video playing. Browsers that can't move an element with its state restart
 * the video instead.
 */
function moveInto(
  parent: HTMLElement,
  tile: CameraTile,
  before: Element | null,
): void {
  const node = tile.element;
  if (before?.parentElement !== parent) {
    before = null;
  }
  if ("moveBefore" in parent && node.isConnected && parent.isConnected) {
    try {
      parent.moveBefore(node, before);
      return;
    } catch {
      // Fall back to inserting it
    }
  }
  parent.insertBefore(node, before);
  if (tile.video.srcObject) {
    tile.video.play().catch(() => undefined);
  }
}

/**
 * Let the hotbar make room for the dock, as Foundry does when the dock moves.
 */
function resizeHotbar(): void {
  (
    ui.hotbar as unknown as { _onResize?: () => void } | undefined
  )?._onResize?.();
}

function clampWidth(width: number | undefined): number {
  return Math.round(
    Math.min(Math.max(width ?? 240, MIN_DOCK_WIDTH), MAX_DOCK_WIDTH),
  );
}
