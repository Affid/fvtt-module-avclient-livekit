import { MODULE_NAME } from "./constants";
import { Logger } from "./logger";

const log = new Logger();

/**
 * Typescript Interfaces
 */

// AV Device Info object
interface DeviceInfo {
  deviceId: string;
  groupId: string;
  label: string;
  kind: "audio" | "video";
}

/**
 * Helper methods
 */

/**
 * Issue a delayed (debounced) reload to the whole window.
 * Allows settings to get saved before reload
 */
export const delayReload: () => void = foundry.utils.debounce(() => {
  window.location.reload();
}, 100);

export const debounceRender: () => void = foundry.utils.debounce(
  () => game.webrtc?.render(),
  200,
);

export const debounceRefreshView: (userId: string) => void =
  foundry.utils.debounce((userId: string) => {
    ui.webrtc?.render({ parts: [userId] }).catch((error: unknown) => {
      log.error("Error refreshing user view:", error);
    });
  }, 200);

export const sleep: (delay: number) => Promise<void> = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

/**
 * Build an absolute route to a file served from this module's directory,
 * respecting any Foundry route prefix when the helper is available.
 * @param {string} assetPath    The path relative to the module root
 */
export function getModuleAssetRoute(assetPath: string): string {
  const relative = `modules/${MODULE_NAME}/${assetPath}`;
  const getRoute = (
    foundry as unknown as {
      utils?: { getRoute?: (path: string) => string };
    }
  ).utils?.getRoute;
  return typeof getRoute === "function" ? getRoute(relative) : `/${relative}`;
}

/**
 * Resume an AudioContext without blocking. A context created before any user
 * interaction starts suspended, and awaiting resume() would block until the
 * user interacts with the page, so resume in the background and again on the
 * first interaction.
 * @param {AudioContext} audioContext   The context to resume
 */
export function resumeAudioContext(audioContext: AudioContext): void {
  if (audioContext.state !== "suspended") {
    return;
  }
  const resume = () => {
    if (audioContext.state === "suspended") {
      audioContext.resume().catch((error: unknown) => {
        log.warn("Unable to resume audio context:", error);
      });
    }
  };
  for (const type of ["pointerdown", "keydown"]) {
    window.addEventListener(type, resume, { once: true, capture: true });
  }
  resume();
}

export function callWhenReady(fnToCall: () => unknown): void {
  if (game.ready) {
    log.debug("callWhenReady now", fnToCall);
    fnToCall();
  } else {
    log.debug("callWhenReady ready", fnToCall);
    Hooks.once("ready", fnToCall);
  }
}

/**
 * Transform the device info array from enumerated devices into an object with {id: label} keys
 * @param {Array} list    The list of devices
 */
export function deviceInfoToObject(
  list: DeviceInfo[],
  kind: "audio" | "video",
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const device of list) {
    if (device.kind === kind) {
      obj[device.deviceId] =
        (device.label || game.i18n?.localize("WEBRTC.UnknownDevice")) ??
        "unknown";
    }
  }

  return obj;
}
