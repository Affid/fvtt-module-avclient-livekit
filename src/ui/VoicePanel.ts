import { ConnectionQuality, ConnectionState } from "livekit-client";
import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME, MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import Avatar from "./Avatar";
import { iconButton, setIconButtonState } from "./buttons";
import { localize } from "./controls";
import { clamp, el, icon, setTooltip, surface } from "./dom";

const log = new Logger("VoicePanel");

const PING_INTERVAL_MS = 2000;
const MARGIN = 8;
// How far the pointer moves before the status row starts dragging the panel
const DRAG_THRESHOLD = 4;

/**
 * A Discord-style voice panel: connection status and ping, a disconnect
 * button, and the local user's mute, deafen, noise suppression, and settings
 * controls. It floats above Foundry's player list and can be dragged by its
 * status row.
 */
export default class VoicePanel {
  readonly element: HTMLElement;
  private readonly statusText = el("span", {
    className: "livekit-panel-status-text",
    attrs: { role: "status" },
  });
  private readonly statusIcon = icon("fa-signal", "livekit-panel-signal");
  private readonly subtext = el("span", { className: "livekit-panel-subtext" });
  private readonly connectionButton: HTMLButtonElement;
  private readonly avatar = new Avatar({ className: "livekit-panel-avatar" });
  private readonly userName = el("span", { className: "livekit-panel-name" });
  private readonly userSubtext = el("span", {
    className: "livekit-panel-subtext",
  });
  private readonly muteButton: HTMLButtonElement;
  private readonly deafenButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly noiseButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private pingMs: number | undefined;
  private pingTimer: number | undefined;

  constructor(private readonly client: LiveKitClient) {
    this.connectionButton = iconButton({
      icon: "fa-phone-slash",
      label: localize("disconnect"),
      className: "livekit-panel-connection",
      onClick: () => {
        this.toggleConnection();
      },
    });
    this.muteButton = iconButton({
      icon: "fa-microphone",
      label: localize("mute"),
      onClick: () => {
        this.client.voiceControls.toggleMute();
      },
    });
    this.deafenButton = iconButton({
      icon: "fa-headphones",
      label: localize("deafen"),
      onClick: () => {
        this.client.voiceControls.toggleDeafen();
      },
    });
    this.cameraButton = iconButton({
      icon: "fa-video",
      label: localize("cameraOff"),
      onClick: () => {
        this.client.voiceControls.toggleCamera();
      },
    });
    // The menus open above the panel rather than over it
    this.noiseButton = iconButton({
      icon: "fa-wand-magic-sparkles",
      label: localize("enhancedNoiseCancellation"),
      onClick: () => {
        this.client.noiseModelMenu.toggle(this.element, this.noiseButton);
      },
    });
    this.noiseButton.setAttribute("aria-haspopup", "menu");
    this.settingsButton = iconButton({
      icon: "fa-gear",
      label: localize("voiceSettings"),
      onClick: () => {
        this.client.audioSettingsPopover.toggle(
          this.element,
          this.settingsButton,
        );
      },
    });
    this.settingsButton.setAttribute("aria-haspopup", "dialog");

    // The status opens the connection details
    const statusButton = el("button", {
      className: "livekit-panel-status-info",
      title: localize("connectionDetails"),
      attrs: { type: "button", "aria-haspopup": "dialog" },
      children: [
        el("span", {
          className: "livekit-panel-status-line",
          children: [this.statusIcon, this.statusText],
        }),
        this.subtext,
      ],
    });
    statusButton.addEventListener("click", () => {
      this.client.connectionPopover.toggle(this.element, statusButton);
    });
    const statusRow = el("div", {
      className: "livekit-panel-status",
      children: [statusButton, this.connectionButton],
    });
    this.makeDraggable(statusRow);

    this.element = surface(
      el("section", {
        className: "livekit-voice-panel",
        attrs: { "aria-label": localize("voicePanel") },
        children: [
          statusRow,
          el("div", {
            className: "livekit-panel-user",
            children: [
              this.avatar.element,
              el("div", {
                className: "livekit-panel-user-info",
                children: [this.userName, this.userSubtext],
              }),
              el("div", {
                className: "livekit-panel-buttons",
                attrs: {
                  role: "toolbar",
                  "aria-label": localize("voicePanel"),
                },
                children: [
                  this.muteButton,
                  this.deafenButton,
                  this.cameraButton,
                  this.noiseButton,
                  this.settingsButton,
                ],
              }),
            ],
          }),
        ],
      }),
    );
  }

  /**
   * Show the panel if it should be visible, and hide it otherwise.
   */
  sync(): void {
    const visible =
      document.body.classList.contains("livekit-discord-ui") &&
      !this.client.useExternalAV &&
      this.client.settings.get("world", "mode") !==
        foundry.av.AVSettings.AV_MODES.DISABLED;

    // In the dock, or floating above the player list
    const dock = this.client.dock;
    const docked = visible && !!dock?.canHostPanel();
    if (!visible) {
      if (this.element.isConnected) {
        this.element.remove();
        window.removeEventListener("resize", this.onResize);
      }
    } else if (docked && dock) {
      if (this.element.parentElement !== dock.panelSlot) {
        dock.panelSlot.append(this.element);
        this.element.style.removeProperty("left");
        this.element.style.removeProperty("top");
      }
    } else if (this.element.parentElement !== document.body) {
      document.body.append(this.element);
      this.element.classList.remove("is-docked");
      this.position();
    }
    this.element.classList.toggle("is-docked", docked);
    if (visible) {
      window.addEventListener("resize", this.onResize);
    }
    this.update();
  }

  /** The panel is in the camera dock */
  private get docked(): boolean {
    return this.element.classList.contains("is-docked");
  }

  /**
   * Refresh everything shown in the panel.
   */
  update(): void {
    if (!this.element.isConnected) {
      this.stopPing();
      return;
    }

    // Connection status
    const room = this.client.liveKitRoom;
    const state = room?.state ?? ConnectionState.Disconnected;
    const connected = state === ConnectionState.Connected;
    const status =
      state === ConnectionState.Connected
        ? "connected"
        : state === ConnectionState.Disconnected
          ? "disconnected"
          : state === ConnectionState.Connecting
            ? "connecting"
            : "reconnecting";
    this.element.dataset.status = status;
    this.statusText.textContent = localize(
      `voiceStatus${status.charAt(0).toUpperCase()}${status.slice(1)}`,
    );

    const quality = room?.localParticipant.connectionQuality;
    const shownQuality =
      connected && quality ? quality : ConnectionQuality.Unknown;
    this.statusIcon.dataset.quality = shownQuality;
    setTooltip(
      this.statusIcon,
      game.i18n?.localize(`${LANG_NAME}.connectionQuality.${shownQuality}`) ??
        shownQuality,
    );
    this.statusIcon.setAttribute("role", "img");

    const place = this.client.breakoutRoom
      ? localize("breakoutRoom")
      : (game.world?.title ?? "");
    this.subtext.textContent =
      connected && this.pingMs !== undefined
        ? `${place} · ${this.pingMs.toString()} ms`
        : place;

    setIconButtonState(this.connectionButton, {
      icon: connected ? "fa-phone-slash" : "fa-phone",
      label: localize(connected ? "disconnect" : "connect"),
      disabled:
        state === ConnectionState.Connecting ||
        state === ConnectionState.Reconnecting,
    });
    this.connectionButton.classList.toggle("is-danger", connected);
    this.connectionButton.classList.toggle("is-active", !connected);

    if (connected) {
      this.startPing();
    } else {
      this.stopPing();
      this.pingMs = undefined;
    }

    // Local user
    const userId = game.user?.id ?? "";
    this.avatar.setSource(game.user?.avatar);
    this.avatar.setSpeaking(this.client.isUserSpeaking(userId));
    this.userName.textContent = game.user?.name ?? "";

    const runningModel = this.client.getAudioProcessingConfig().model;
    this.userSubtext.textContent = runningModel
      ? this.client.getNoiseModelLabel(runningModel)
      : localize("noiseSuppressionOff");

    const voice = this.client.voiceControls;
    const muted = voice.isMuted();
    const deafened = voice.isDeafened();
    setIconButtonState(this.muteButton, {
      icon: muted ? "fa-microphone-slash" : "fa-microphone",
      label: localize(muted ? "unmute" : "mute"),
      off: muted,
      pressed: muted,
    });
    setIconButtonState(this.deafenButton, {
      label: localize(deafened ? "undeafen" : "deafen"),
      off: deafened,
      slashed: deafened,
      pressed: deafened,
    });
    setIconButtonState(this.noiseButton, { active: !!runningModel });

    const cameraOff = voice.isCameraOff();
    this.cameraButton.hidden = !voice.canUseCamera();
    setIconButtonState(this.cameraButton, {
      icon: cameraOff ? "fa-video-slash" : "fa-video",
      label: localize(cameraOff ? "cameraOn" : "cameraOff"),
      off: cameraOff,
      pressed: cameraOff,
    });
  }

  setSpeaking(speaking: boolean): void {
    this.avatar.setSpeaking(speaking);
  }

  private toggleConnection(): void {
    const connected =
      this.client.liveKitRoom?.state === ConnectionState.Connected;
    this.connectionButton.disabled = true;
    const action = connected
      ? this.client.avMaster.disconnect().then(() => {
          this.client.render();
        })
      : this.client.avMaster.connect();
    action
      .catch((error: unknown) => {
        log.error("Error changing the voice connection:", error);
      })
      .finally(() => {
        this.update();
      });
  }

  private startPing(): void {
    if (this.pingTimer !== undefined) {
      return;
    }
    const measure = async () => {
      try {
        const pingMs = await this.client.getPingMs();
        if (pingMs !== this.pingMs) {
          this.pingMs = pingMs;
          this.update();
        }
      } catch (error: unknown) {
        log.debug("Unable to read the connection round trip time:", error);
      }
    };
    void measure();
    this.pingTimer = window.setInterval(() => void measure(), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== undefined) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  /**
   * Place the panel at its saved position, or above Foundry's player list.
   */
  private position(): void {
    if (this.docked) {
      return;
    }
    const saved = game.settings?.get(MODULE_NAME, "voicePanelPosition");
    const { width, height } = this.element.getBoundingClientRect();
    let left: number;
    let top: number;
    if (
      saved &&
      typeof saved.left === "number" &&
      typeof saved.top === "number"
    ) {
      ({ left, top } = saved);
    } else {
      const players = document
        .getElementById("players")
        ?.getBoundingClientRect();
      left = players ? players.left : MARGIN * 2;
      top = (players ? players.top : window.innerHeight) - height - MARGIN;
    }
    this.element.style.left = `${clamp(left, MARGIN, window.innerWidth - width - MARGIN).toString()}px`;
    this.element.style.top = `${clamp(top, MARGIN, window.innerHeight - height - MARGIN).toString()}px`;
  }

  private readonly onResize = () => {
    this.position();
  };

  /**
   * Move the panel by dragging its status row, including the status itself:
   * a drag starts once the pointer moves a little, so a click still opens the
   * connection details.
   */
  private makeDraggable(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      const target = event.target as Element;
      if (
        this.docked ||
        event.button !== 0 ||
        target.closest("button:not(.livekit-panel-status-info)")
      ) {
        return;
      }
      const start = this.element.getBoundingClientRect();
      const offsetX = event.clientX - start.left;
      const offsetY = event.clientY - start.top;
      let dragging = false;

      const onMove = (moveEvent: PointerEvent) => {
        if (
          !dragging &&
          Math.hypot(
            moveEvent.clientX - event.clientX,
            moveEvent.clientY - event.clientY,
          ) < DRAG_THRESHOLD
        ) {
          return;
        }
        if (!dragging) {
          dragging = true;
          handle.setPointerCapture(event.pointerId);
          this.element.classList.add("dragging");
        }
        this.element.style.left = `${clamp(moveEvent.clientX - offsetX, MARGIN, window.innerWidth - start.width - MARGIN).toString()}px`;
        this.element.style.top = `${clamp(moveEvent.clientY - offsetY, MARGIN, window.innerHeight - start.height - MARGIN).toString()}px`;
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        if (!dragging) {
          return;
        }
        // The click that ends a drag doesn't open the connection details
        handle.addEventListener(
          "click",
          (clickEvent) => {
            clickEvent.stopPropagation();
          },
          { capture: true, once: true },
        );
        this.element.classList.remove("dragging");
        const { left, top } = this.element.getBoundingClientRect();
        game.settings
          ?.set(MODULE_NAME, "voicePanelPosition", { left, top })
          .catch((error: unknown) => {
            log.error("Error saving the voice panel position:", error);
          });
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}
