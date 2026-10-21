import type { KrispNoiseFilterProcessor } from "@livekit/krisp-noise-filter";
import { ConnectionState, type Room } from "livekit-client";
import { Logger } from "./utils/logger";

const log = new Logger("KrispNoiseFilter");

type KrispModule = typeof import("@livekit/krisp-noise-filter");

// ServerInfo_Edition.Cloud from @livekit/protocol, which livekit-client
// doesn't re-export
const LIVEKIT_CLOUD_EDITION = 1;

let krispModule: Promise<KrispModule> | undefined;

/**
 * Load the Krisp noise filter on demand. The package is large (about 6MB), so
 * it is split into its own chunk and only fetched when Krisp may be used. When
 * initialized, the filter itself downloads its models from LiveKit
 * (integrations.livekit.io).
 */
function loadKrispModule(): Promise<KrispModule> {
  krispModule ??= import("@livekit/krisp-noise-filter").catch(
    (error: unknown) => {
      // Allow a later retry, e.g. after a transient network error
      krispModule = undefined;
      throw error;
    },
  );
  return krispModule;
}

/**
 * Whether the Krisp noise filter can run in this browser. Older browsers (for
 * example older Safari versions) are not supported, and may not even be able
 * to load the filter.
 */
export async function isKrispSupported(): Promise<boolean> {
  try {
    const { isKrispNoiseFilterSupported } = await loadKrispModule();
    return isKrispNoiseFilterSupported();
  } catch (error: unknown) {
    log.warn("Unable to load the Krisp noise filter:", error);
    return false;
  }
}

/**
 * Create a Krisp noise filter TrackProcessor.
 */
export async function createKrispNoiseFilter(): Promise<KrispNoiseFilterProcessor> {
  const { KrispNoiseFilter } = await loadKrispModule();
  return KrispNoiseFilter();
}

/**
 * Whether the room is connected to a LiveKit Cloud server. The Krisp filter
 * is licensed through LiveKit Cloud and does nothing on other servers.
 * @param {Room | null} room            The LiveKit room
 * @param {string} [serverAddress]      The server address the room connected to
 */
export function isLiveKitCloud(
  room: Room | null,
  serverAddress?: string,
): boolean {
  if (room?.state !== ConnectionState.Connected) {
    return false;
  }
  if (Number(room.serverInfo?.edition) === LIVEKIT_CLOUD_EDITION) {
    return true;
  }
  if (!serverAddress) {
    return false;
  }
  try {
    const { hostname } = new URL(`wss://${serverAddress}`);
    return (
      hostname.endsWith(".livekit.cloud") || hostname.endsWith(".livekit.run")
    );
  } catch {
    return false;
  }
}
