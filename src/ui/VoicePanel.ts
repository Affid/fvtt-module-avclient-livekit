import { ConnectionQuality, ConnectionState } from "livekit-client";
import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME, MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import { clamp, el, icon, iconButton } from "./dom";

const log = new Logger("VoicePanel");

const DEFAULT_AVATAR = "icons/svg/mystery-man.svg";
const PING_INTERVAL_MS = 2000;
const MARGIN = 8;

const localize = (key: string) =>
  game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;

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
  });
  private readonly statusIcon = icon("fa-signal", "livekit-panel-signal");
  private readonly subtext = el("span", { className: "livekit-panel-subtext" });
  private readonly connectionButton: HTMLButtonElement;
  private readonly avatarImage = el("img", { attrs: { alt: "" } });
  private readonly avatar = el("div", {
    className: "livekit-panel-avatar",
    children: [this.avatarImage],
  });
  private readonly userName = el("span", { className: "livekit-panel-name" });
  private readonly userSubtext = el("span", {
    className: "livekit-panel-subtext",
  });
  private readonly muteButton: HTMLButtonElement;
  private readonly deafenButton: HTMLButtonElement;
  private readonly noiseButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private pingMs: number | undefined;
  private pingTimer: number | undefined;

  constructor(private readonly client: LiveKitClient) {
    this.connectionButton = iconButton(
      "fa-phone-slash",
      "",
      () => {
        this.toggleConnection();
      },
      "livekit-panel-connection",
    );
    this.muteButton = iconButton("fa-microphone", "", () => {
      this.client.voiceControls.toggleMute();
    });
    this.deafenButton = iconButton("fa-headphones", "", () => {
      this.client.voiceControls.toggleDeafen();
    });
    this.noiseButton = iconButton(
      "fa-wand-magic-sparkles",
      localize("enhancedNoiseCancellation"),
      () => {
        this.client.toggleNoiseModelMenu(this.noiseButton, this.element);
      },
    );
    this.settingsButton = iconButton(
      "fa-gear",
      localize("voiceSettings"),
      () => {
        // Open above the panel rather than over it
        this.client.audioSettingsPopover.toggle(this.element);
      },
    );

    const statusRow = el("div", {
      className: "livekit-panel-status",
      children: [
        el("div", {
          className: "livekit-panel-status-info",
          children: [
            el("div", {
              className: "livekit-panel-status-line",
              children: [this.statusIcon, this.statusText],
            }),
            this.subtext,
          ],
        }),
        this.connectionButton,
      ],
    });
    this.makeDraggable(statusRow);

    this.element = el("section", {
      className: "livekit-voice-panel",
      attrs: { "aria-label": localize("voicePanel") },
      children: [
        statusRow,
        el("div", {
          className: "livekit-panel-user",
          children: [
            this.avatar,
            el("div", {
              className: "livekit-panel-user-info",
              children: [this.userName, this.userSubtext],
            }),
            el("div", {
              className: "livekit-panel-buttons",
              children: [
                this.muteButton,
                this.deafenButton,
                this.noiseButton,
                this.settingsButton,
              ],
            }),
          ],
        }),
      ],
    });
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

    if (visible && !this.element.isConnected) {
      document.body.append(this.element);
      this.position();
      window.addEventListener("resize", this.onResize);
    } else if (!visible && this.element.isConnected) {
      this.element.remove();
      window.removeEventListener("resize", this.onResize);
    }
    this.update();
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
    this.statusIcon.dataset.quality =
      connected && quality ? quality : ConnectionQuality.Unknown;

    const place = this.client.breakoutRoom
      ? localize("breakoutRoom")
      : (game.world?.title ?? "");
    this.subtext.textContent =
      connected && this.pingMs !== undefined
        ? `${place} · ${this.pingMs.toString()} ms`
        : place;

    const connectionLabel = localize(connected ? "disconnect" : "connect");
    this.connectionButton.replaceChildren(
      icon(connected ? "fa-phone-slash" : "fa-phone"),
    );
    this.connectionButton.dataset.tooltip = connectionLabel;
    this.connectionButton.ariaLabel = connectionLabel;
    this.connectionButton.disabled =
      state === ConnectionState.Connecting ||
      state === ConnectionState.Reconnecting;

    if (connected) {
      this.startPing();
    } else {
      this.stopPing();
      this.pingMs = undefined;
    }

    // Local user
    const userId = game.user?.id ?? "";
    const avatarSource = game.user?.avatar ?? DEFAULT_AVATAR;
    if (this.avatarImage.getAttribute("src") !== avatarSource) {
      this.avatarImage.setAttribute("src", avatarSource);
    }
    this.avatar.classList.toggle(
      "livekit-speaking",
      this.client.cameraViewDecorator.isSpeaking(userId),
    );
    this.userName.textContent = game.user?.name ?? "";

    const runningModel = this.client.getAudioProcessingConfig().model;
    this.userSubtext.textContent = runningModel
      ? this.client.getNoiseModelLabel(runningModel)
      : localize("noiseSuppressionOff");

    const voice = this.client.voiceControls;
    const muted = voice.isMuted();
    const deafened = voice.isDeafened();
    this.setToggle(
      this.muteButton,
      muted,
      muted ? "fa-microphone-slash" : "fa-microphone",
      localize(muted ? "unmute" : "mute"),
    );
    this.setToggle(
      this.deafenButton,
      deafened,
      "fa-headphones",
      localize(deafened ? "undeafen" : "deafen"),
    );
    this.deafenButton.classList.toggle("livekit-slashed", deafened);
    this.noiseButton.classList.toggle("active", !!runningModel);
  }

  setSpeaking(speaking: boolean): void {
    this.avatar.classList.toggle("livekit-speaking", speaking);
  }

  private setToggle(
    button: HTMLButtonElement,
    on: boolean,
    iconName: string,
    label: string,
  ): void {
    button.replaceChildren(icon(iconName));
    button.classList.toggle("livekit-off", on);
    button.dataset.tooltip = label;
    button.ariaLabel = label;
    button.setAttribute("aria-pressed", String(on));
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
        const stats = await this.client.audioTrack?.getSenderStats();
        const rtt = stats?.roundTripTime;
        const pingMs = rtt !== undefined ? Math.round(rtt * 1000) : undefined;
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

  private makeDraggable(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as Element).closest("button")) {
        return;
      }
      event.preventDefault();
      const start = this.element.getBoundingClientRect();
      const offsetX = event.clientX - start.left;
      const offsetY = event.clientY - start.top;
      handle.setPointerCapture(event.pointerId);
      this.element.classList.add("dragging");

      const onMove = (moveEvent: PointerEvent) => {
        this.element.style.left = `${clamp(moveEvent.clientX - offsetX, MARGIN, window.innerWidth - start.width - MARGIN).toString()}px`;
        this.element.style.top = `${clamp(moveEvent.clientY - offsetY, MARGIN, window.innerHeight - start.height - MARGIN).toString()}px`;
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
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
