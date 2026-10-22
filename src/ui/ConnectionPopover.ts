import { ConnectionState } from "livekit-client";
import { isLiveKitCloud } from "../KrispNoiseFilter";
import type LiveKitClient from "../LiveKitClient";
import { LANG_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import Popover from "./Popover";
import { button } from "./buttons";
import { localize } from "./controls";
import { el, uniqueId } from "./dom";

const log = new Logger("ConnectionPopover");

const REFRESH_MS = 2000;

/**
 * Details about the voice connection, opened from the voice panel's status:
 * ping, connection quality, the server and its region, the audio codec,
 * packet loss and jitter, the noise suppression and input sensitivity in use,
 * and a button to reconnect.
 */
export default class ConnectionPopover {
  private readonly popover = new Popover("livekit-connection-details", () => {
    window.clearInterval(this.timer);
  });
  private timer?: number;

  constructor(private readonly client: LiveKitClient) {}

  get isOpen(): boolean {
    return this.popover.isOpen;
  }

  /**
   * @param anchor    The element to show the popover against
   * @param control   The button that opened it
   */
  toggle(anchor: HTMLElement, control: HTMLElement): void {
    if (this.popover.isOpen) {
      this.popover.close();
      return;
    }
    void this.render().then(() => {
      this.popover.openAt(anchor, control);
      this.timer = window.setInterval(() => {
        void this.render();
      }, REFRESH_MS);
    });
  }

  close(): void {
    this.popover.close();
  }

  private async render(): Promise<void> {
    const client = this.client;
    const room = client.liveKitRoom;
    const state = room?.state ?? ConnectionState.Disconnected;
    const connected = state === ConnectionState.Connected;
    const rows: [string, string][] = [];

    rows.push([localize("connectionStatus"), statusLabel(state)]);
    if (connected) {
      const stats = await client.audioTrack
        ?.getSenderStats()
        .catch((error: unknown) => {
          log.debug("Unable to read the sender statistics:", error);
          return undefined;
        });
      const ping = await client.getPingMs().catch(() => undefined);
      if (ping !== undefined) {
        rows.push([localize("ping"), `${ping.toString()} ms`]);
      }
      const quality = room?.localParticipant.connectionQuality ?? "unknown";
      rows.push([
        localize("connectionQualityLabel"),
        game.i18n?.localize(`${LANG_NAME}.connectionQuality.${quality}`) ??
          quality,
      ]);
      const server = room?.serverInfo;
      const serverName = [
        isLiveKitCloud(room, client.liveKitServerAddress)
          ? "LiveKit Cloud"
          : "LiveKit",
        server?.version,
      ]
        .filter(Boolean)
        .join(" ");
      rows.push([localize("server"), serverName]);
      if (server?.region) {
        rows.push([localize("region"), server.region]);
      }
      const codec = client.getAudioCodec();
      if (codec) {
        rows.push([localize("audioCodec"), codec]);
      }
      if (stats?.packetsSent !== undefined) {
        const lost = stats.packetsLost ?? 0;
        const total = stats.packetsSent + lost;
        rows.push([
          localize("packetLoss"),
          `${(total ? (lost / total) * 100 : 0).toFixed(1)}%`,
        ]);
      }
      if (stats?.jitter !== undefined) {
        rows.push([
          localize("jitter"),
          `${Math.round(stats.jitter * 1000).toString()} ms`,
        ]);
      }
    }

    const model = client.getAudioProcessingConfig().model;
    rows.push([
      localize("noiseSuppressionModel"),
      model
        ? client.getNoiseModelLabel(model)
        : localize("noiseSuppressionOff"),
    ]);
    rows.push([localize("inputSensitivity"), this.sensitivityLabel()]);

    const titleId = uniqueId("title");
    this.popover.element.setAttribute("aria-labelledby", titleId);
    this.popover.element.dataset.status = connected ? "connected" : "other";
    this.popover.element.replaceChildren(
      el("h3", {
        className: "livekit-popover-title",
        text: localize("connectionDetails"),
        attrs: { id: titleId },
      }),
      el("dl", {
        className: "livekit-details",
        children: rows.flatMap(([label, value]) => [
          el("dt", { text: label }),
          el("dd", { text: value }),
        ]),
      }),
      el("footer", {
        className: "livekit-popover-footer",
        children: [
          button({
            label: localize("reconnect"),
            icon: el("i", {
              className: "fa-solid fa-rotate",
              attrs: { "aria-hidden": "true" },
            }),
            onClick: () => {
              this.reconnect();
            },
          }),
        ],
      }),
    );
    this.popover.reposition();
  }

  private sensitivityLabel(): string {
    if (this.client.settings.client.voice.mode !== "always") {
      return localize("inputModePushToTalk");
    }
    const gate = this.client.voiceGate;
    if (!gate) {
      return localize("inputSensitivityOff");
    }
    const { auto } = this.client.getVoiceGateSettings();
    const threshold = gate.report?.threshold;
    const value =
      threshold === undefined ? "" : ` (${threshold.toString()} dB)`;
    return `${localize(auto ? "inputSensitivityAuto" : "inputSensitivityManual")}${value}`;
  }

  private reconnect(): void {
    const master = this.client.avMaster;
    this.close();
    master
      .disconnect()
      .then(() => master.connect())
      .catch((error: unknown) => {
        log.error("Error reconnecting:", error);
      });
  }
}

function statusLabel(state: ConnectionState): string {
  const status =
    state === ConnectionState.Connected
      ? "Connected"
      : state === ConnectionState.Disconnected
        ? "Disconnected"
        : state === ConnectionState.Connecting
          ? "Connecting"
          : "Reconnecting";
  return localize(`voiceStatus${status}`);
}
