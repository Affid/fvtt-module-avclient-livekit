import type { LocalVideoTrack, TrackProcessor, Track } from "livekit-client";
import type {
  BackgroundProcessorWrapper,
  BackgroundTransformer,
  SwitchBackgroundProcessorOptions,
} from "@livekit/track-processors";
import type { ImageSegmenterResult } from "@mediapipe/tasks-vision";
import MaskSmoother from "./MaskSmoother";
import { getModuleAssetRoute } from "./utils/helpers";
import { Logger } from "./utils/logger";

const log = new Logger("VideoBackground");

type TrackProcessorsModule = typeof import("@livekit/track-processors");

/** What is done with the background of the camera video */
export type VideoBackgroundMode = "none" | "blur" | "image";

/**
 * How well the person is told from the background: MediaPipe's selfie model,
 * or its multiclass selfie model, which knows hair and is cleaner around the
 * head, but is 16 MB and takes more graphics power.
 */
export type VideoBackgroundQuality = "standard" | "high";

const MODELS: Record<VideoBackgroundQuality, string> = {
  standard: "mediapipe/selfie_segmenter.tflite",
  high: "mediapipe/selfie_multiclass_256x256.tflite",
};

/**
 * The background effect to apply: how strongly to blur (0 to 1), or the
 * image's URL; and the quality
 */
export type VideoBackground =
  | { mode: "none" }
  | { mode: "blur"; strength: number; quality: VideoBackgroundQuality }
  | { mode: "image"; url: string; quality: VideoBackgroundQuality };

/** The quality each running effect was started with */
const processorQuality = new WeakMap<object, VideoBackgroundQuality>();

/**
 * Backgrounds that come with Foundry itself: the art of its setup screen.
 * Paths are relative to Foundry's root.
 */
export const VIDEO_BACKGROUND_PRESETS: { path: string; label: string }[] = [
  { path: "ui/backgrounds/setup.webp", label: "videoBackgroundFantasy" },
  { path: "ui/backgrounds/setup-scifi.webp", label: "videoBackgroundSciFi" },
];

/** The background image could not be loaded */
export class VideoBackgroundImageError extends Error {}

/**
 * LiveKit's blur radius at full strength. It blurs a quarter-size copy of the
 * frame with a Gaussian of a quarter of the radius, of up to 16 pixels each
 * way, so 60 is about as strong as it gets.
 */
const MAX_BLUR_RADIUS = 60;

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

/**
 * The URL of a background image chosen in Foundry: a full URL as is, or a
 * path on the Foundry server.
 */
export function videoBackgroundImageUrl(path: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) {
    return path;
  }
  const getRoute = (
    foundry as unknown as { utils?: { getRoute?: (path: string) => string } }
  ).utils?.getRoute;
  const relative = path.replace(/^\/+/, "");
  return typeof getRoute === "function" ? getRoute(relative) : `/${relative}`;
}

/**
 * Make sure an image can be used before giving it to LiveKit, which would
 * otherwise put the person on an empty background. It is loaded the way
 * LiveKit loads it, so an image on another server needs to allow it (CORS).
 */
async function checkImage(url: string): Promise<void> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
  } catch (error: unknown) {
    throw new VideoBackgroundImageError(`Unable to load ${url}`, {
      cause: error,
    });
  }
}

function switchOptions(
  background: Exclude<VideoBackground, { mode: "none" }>,
): SwitchBackgroundProcessorOptions {
  return background.mode === "image"
    ? { mode: "virtual-background", imagePath: background.url }
    : {
        mode: "background-blur",
        blurRadius: Math.max(
          6,
          Math.round(MAX_BLUR_RADIUS * background.strength),
        ),
      };
}

/**
 * Try a blur strength out on a blur that is running, e.g. while its slider
 * moves. Nothing is done if the effect isn't blurring.
 */
export async function previewVideoBlur(
  track: LocalVideoTrack | null,
  strength: number,
): Promise<void> {
  const current = track?.getProcessor();
  if (isBackgroundProcessor(current) && current.mode === "background-blur") {
    await current.switchTo(
      switchOptions({
        mode: "blur",
        strength,
        quality: processorQuality.get(current) ?? "standard",
      }),
    );
  }
}

/**
 * Steady the mask over time (see MaskSmoother): have MediaPipe give its
 * confidence of the person rather than a yes or no for each pixel, blend it
 * with the masks before it, and hand LiveKit the result in place of the mask
 * it would get.
 *
 * @returns Disposes of the smoother
 */
async function steadyMask(
  transformer: BackgroundTransformer,
): Promise<(() => void) | undefined> {
  const segmenter = transformer.imageSegmenter;
  const gl = transformer.canvas?.getContext("webgl2");
  if (!segmenter || !gl) {
    return undefined;
  }
  // A model with a "background" category (the multiclass selfie model) gives
  // its confidence directly; the selfie model gives the person's, the last
  // of its masks
  const labels = segmenter.getLabels().map((label) => label.toLowerCase());
  const backgroundIndex = labels.indexOf("background");
  log.debug("Segmenter labels:", labels);
  const smoother = new MaskSmoother(gl, backgroundIndex < 0);
  try {
    await segmenter.setOptions({
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  } catch (error: unknown) {
    smoother.dispose();
    throw error;
  }
  const segment = segmenter.segmentForVideo.bind(segmenter) as (
    frame: VideoFrame,
    timestamp: number,
    callback: (result: ImageSegmenterResult) => void,
  ) => void;
  segmenter.segmentForVideo = ((
    frame: VideoFrame,
    timestamp: number,
    callback: (result: unknown) => void,
  ) => {
    segment(frame, timestamp, (result) => {
      const masks = result.confidenceMasks ?? [];
      const mask = backgroundIndex < 0 ? masks.at(-1) : masks[backgroundIndex];
      if (!mask) {
        callback(result);
        return;
      }
      const texture = smoother.update(
        mask.getAsWebGLTexture(),
        mask.width,
        mask.height,
      );
      callback({
        categoryMask: { getAsWebGLTexture: () => texture },
        close: () => {
          result.close();
        },
      });
    });
  }) as typeof segmenter.segmentForVideo;
  return () => {
    smoother.dispose();
  };
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
 *
 * @throws VideoBackgroundImageError if the image can't be loaded; the track
 *         is left as it was
 */
export async function applyVideoBackground(
  track: LocalVideoTrack,
  background: VideoBackground,
): Promise<void> {
  const current = track.getProcessor();
  if (background.mode === "none") {
    if (current) {
      await track.stopProcessor();
    }
    return;
  }
  if (background.mode === "image") {
    await checkImage(background.url);
  }
  if (
    isBackgroundProcessor(current) &&
    processorQuality.get(current) === background.quality
  ) {
    await current.switchTo(switchOptions(background));
    return;
  }
  const { BackgroundProcessor } = await loadTrackProcessors();
  const processor = BackgroundProcessor(
    {
      ...switchOptions(background),
      assetPaths: {
        tasksVisionFileSet: getModuleAssetRoute("mediapipe"),
        modelAssetPath: getModuleAssetRoute(MODELS[background.quality]),
      },
    },
    "livekit-video-background",
  );
  processorQuality.set(processor, background.quality);
  // MediaPipe starts again whenever the camera restarts
  const transformer = processor.transformer;
  const init = transformer.init.bind(transformer);
  const destroy = transformer.destroy.bind(transformer);
  let disposeSmoother: (() => void) | undefined;
  transformer.init = async (options) => {
    await withoutFoundryModuleGlobal(() => init(options));
    disposeSmoother = await steadyMask(transformer).catch((error: unknown) => {
      // The mask stays as LiveKit makes it
      log.warn("Unable to steady the camera background mask:", error);
      return undefined;
    });
  };
  transformer.destroy = async (options) => {
    disposeSmoother?.();
    disposeSmoother = undefined;
    await destroy(options);
  };
  await track.setProcessor(processor);
}
