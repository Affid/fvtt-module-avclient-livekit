import type { LocalVideoTrack, TrackProcessor, Track } from "livekit-client";
import type {
  BackgroundProcessorWrapper,
  SwitchBackgroundProcessorOptions,
} from "@livekit/track-processors";
import { getModuleAssetRoute } from "./utils/helpers";

type TrackProcessorsModule = typeof import("@livekit/track-processors");

/** What is done with the background of the camera video */
export type VideoBackgroundMode = "none" | "blur";

/** How strongly the background is blurred, in pixels of LiveKit's blur */
const BLUR_RADIUS = 10;

let processorsModule: Promise<TrackProcessorsModule> | undefined;

/**
 * LiveKit's track processors, with MediaPipe, are only loaded once a
 * background effect is used.
 */
function loadTrackProcessors(): Promise<TrackProcessorsModule> {
  processorsModule ??= import("@livekit/track-processors").catch(
    (error: unknown) => {
      // Allow a later retry, e.g. after a transient network error
      processorsModule = undefined;
      throw error;
    },
  );
  return processorsModule;
}

let supported: boolean | undefined;

/**
 * Whether this browser can blur or replace the camera's background: the
 * same checks as LiveKit's supportsBackgroundProcessors, without loading the
 * package.
 */
export function supportsVideoBackground(): boolean {
  supported ??=
    typeof OffscreenCanvas !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof createImageBitmap !== "undefined" &&
    !!document.createElement("canvas").getContext("webgl2") &&
    ("MediaStreamTrackProcessor" in window ||
      "captureStream" in HTMLCanvasElement.prototype);
  return supported;
}

function switchOptions(): SwitchBackgroundProcessorOptions {
  return { mode: "background-blur", blurRadius: BLUR_RADIUS };
}

/**
 * MediaPipe's loader takes a global `Module` as its Emscripten settings, and
 * clears it once loaded. Foundry has a global `Module` too (a deprecated alias
 * of foundry.packages.Module), which breaks it: hide that while MediaPipe
 * starts, and put it back afterwards.
 */
async function withoutFoundryModuleGlobal<T>(
  start: () => Promise<T>,
): Promise<T> {
  const global = globalThis as { Module?: unknown };
  const foundryModule = (
    foundry as unknown as { packages?: { Module?: unknown } }
  ).packages?.Module;
  if (!("Module" in global) || foundryModule === undefined) {
    return start();
  }
  global.Module = undefined;
  try {
    return await start();
  } finally {
    global.Module = foundryModule;
  }
}

function isBackgroundProcessor(
  processor: TrackProcessor<Track.Kind> | undefined,
): processor is BackgroundProcessorWrapper {
  return (
    !!processor &&
    "switchTo" in processor &&
    typeof processor.switchTo === "function"
  );
}

/**
 * Put the background effect on the camera track: LiveKit's background
 * processor, running MediaPipe's selfie segmentation from this module's own
 * files. An effect already on the track is switched in place, which avoids a
 * flash of the unprocessed video.
 */
export async function applyVideoBackground(
  track: LocalVideoTrack,
  mode: VideoBackgroundMode,
): Promise<void> {
  const current = track.getProcessor();
  if (mode === "none") {
    if (current) {
      await track.stopProcessor();
    }
    return;
  }
  if (isBackgroundProcessor(current)) {
    await current.switchTo(switchOptions());
    return;
  }
  const { BackgroundProcessor } = await loadTrackProcessors();
  const processor = BackgroundProcessor(
    {
      ...switchOptions(),
      assetPaths: {
        tasksVisionFileSet: getModuleAssetRoute("mediapipe"),
        modelAssetPath: getModuleAssetRoute(
          "mediapipe/selfie_segmenter.tflite",
        ),
      },
    },
    "livekit-video-background",
  );
  // MediaPipe starts again whenever the camera restarts
  const transformer = processor.transformer;
  const init = transformer.init.bind(transformer);
  transformer.init = (options) =>
    withoutFoundryModuleGlobal(() => init(options));
  await track.setProcessor(processor);
}
