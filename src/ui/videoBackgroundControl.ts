import type LiveKitClient from "../LiveKitClient";
import { MODULE_NAME } from "../utils/constants";
import { Logger } from "../utils/logger";
import {
  supportsVideoBackground,
  VIDEO_BACKGROUND_PRESETS,
  videoBackgroundImageUrl,
} from "../VideoBackground";
import { localize, segmentedControl, settingRow, slider } from "./controls";
import { el, icon, setTooltip } from "./dom";

const log = new Logger("videoBackgroundControl");

/**
 * The camera background effect: none, blur with its strength, or an image,
 * picked from Foundry's own art or the user's. Changes apply right away. In the A/V
 * settings window the choice also has a form field (`name`), so saving the
 * form keeps it.
 */
export function videoBackgroundRow({
  name,
  client,
  showQuality = false,
}: {
  name: string;
  client?: LiveKitClient;
  /** Also offer the quality, which the full settings do */
  showQuality?: boolean;
}): HTMLElement {
  const container = el("div", { className: "livekit-video-background" });
  const render = () => {
    container.replaceChildren(...build());
  };
  const set = (
    key: "videoBackground" | "videoBackgroundImage" | "videoBackgroundQuality",
    value: string,
  ) =>
    game.settings
      ?.set(MODULE_NAME, key, value)
      .then(render)
      .catch((error: unknown) => {
        log.error("Error changing the camera background:", error);
      });

  const build = (): Node[] => {
    const supported = supportsVideoBackground();
    const mode = supported
      ? (game.settings?.get(MODULE_NAME, "videoBackground") ?? "none")
      : "none";
    const image = game.settings?.get(MODULE_NAME, "videoBackgroundImage") ?? "";
    const imageFailed =
      mode === "image" &&
      client?.failedVideoBackgroundImage === videoBackgroundImageUrl(image);
    const hint = !supported
      ? localize("videoBackgroundUnsupported")
      : client?.videoBackgroundFailed && mode !== "none"
        ? localize("videoBackgroundFailedHint")
        : imageFailed
          ? localize("videoBackgroundImageFailedHint")
          : localize("videoBackgroundHint");
    return [
      settingRow({
        label: localize("videoBackground"),
        hint,
        control: segmentedControl({
          name,
          label: localize("videoBackground"),
          value: mode,
          options: [
            { value: "none", label: localize("videoBackgroundNone") },
            {
              value: "blur",
              label: localize("videoBackgroundBlur"),
              disabled: !supported,
            },
            {
              value: "image",
              label: localize("videoBackgroundImage"),
              disabled: !supported,
            },
          ],
          onChange: (value) => void set("videoBackground", value),
        }),
      }),
      ...(mode === "blur" ? [blurStrength(client)] : []),
      ...(mode === "image" ? [imageChoices(image, set)] : []),
      ...(showQuality && mode !== "none"
        ? [
            settingRow({
              label: localize("videoBackgroundQuality"),
              hint: localize("videoBackgroundQualityHint"),
              control: segmentedControl({
                name: `${name}-quality`,
                label: localize("videoBackgroundQuality"),
                value:
                  game.settings?.get(MODULE_NAME, "videoBackgroundQuality") ??
                  "high",
                options: [
                  {
                    value: "standard",
                    label: localize("videoBackgroundQualityStandard"),
                  },
                  {
                    value: "high",
                    label: localize("videoBackgroundQualityHigh"),
                  },
                ],
                onChange: (value) => void set("videoBackgroundQuality", value),
              }),
            }),
          ]
        : []),
    ];
  };

  render();
  return container;
}

/**
 * How strongly to blur, tried out on the camera while the slider moves and
 * saved once it is let go.
 */
function blurStrength(client: LiveKitClient | undefined): HTMLElement {
  const strength = game.settings?.get(MODULE_NAME, "videoBlurStrength") ?? 0.5;
  return slider({
    label: localize("videoBlurStrength"),
    min: 10,
    max: 100,
    step: 5,
    value: Math.round(strength * 100),
    format: (value) => `${Math.round(value).toString()}%`,
    onInput: (value) => {
      client?.previewVideoBlur(value / 100);
    },
    onChange: (value) => {
      game.settings
        ?.set(MODULE_NAME, "videoBlurStrength", value / 100)
        .catch((error: unknown) => {
          log.error("Error changing the blur strength:", error);
        });
    },
  });
}

/**
 * Thumbnails of the background images to pick from: Foundry's own, the
 * user's own if they picked one, and a button to pick one.
 */
function imageChoices(
  current: string,
  set: (
    key: "videoBackgroundImage",
    value: string,
  ) => Promise<void> | undefined,
): HTMLElement {
  const custom =
    game.settings?.get(MODULE_NAME, "videoBackgroundCustomImage") ?? "";
  const choices = [
    ...VIDEO_BACKGROUND_PRESETS.map((preset) => ({
      path: preset.path,
      label: localize(preset.label),
    })),
    ...(custom
      ? [{ path: custom, label: localize("videoBackgroundCustom") }]
      : []),
  ];
  const pickButton = el("button", {
    className: "livekit-background-choice livekit-background-pick",
    attrs: { type: "button", "aria-label": localize("videoBackgroundPick") },
    children: [icon("fa-plus")],
  });
  setTooltip(pickButton, localize("videoBackgroundPick"));
  pickButton.addEventListener("click", () => {
    void pickImage(custom || current).then(async (path) => {
      if (!path) {
        return;
      }
      await game.settings?.set(MODULE_NAME, "videoBackgroundCustomImage", path);
      await set("videoBackgroundImage", path);
    });
  });

  return el("div", {
    className: "livekit-background-choices",
    attrs: { role: "group", "aria-label": localize("videoBackgroundImage") },
    children: [
      ...choices.map((choice) => {
        const button = el("button", {
          className: "livekit-background-choice",
          attrs: {
            type: "button",
            "aria-label": choice.label,
            "aria-pressed": String(choice.path === current),
          },
          children: [
            el("img", {
              attrs: {
                src: videoBackgroundImageUrl(choice.path),
                alt: "",
                loading: "lazy",
                draggable: "false",
              },
            }),
          ],
        });
        setTooltip(button, choice.label);
        button.addEventListener("click", () => {
          void set("videoBackgroundImage", choice.path);
        });
        return button;
      }),
      pickButton,
    ],
  });
}

/**
 * Let the user pick an image: with Foundry's file browser, or, for users who
 * may not browse files, by entering its address.
 */
async function pickImage(current: string): Promise<string | undefined> {
  if (game.user?.can("FILES_BROWSE")) {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    return new Promise((resolve) => {
      const picker = new FilePicker({
        type: "image",
        current,
        callback: (path: string) => {
          resolve(path);
        },
      });
      void picker.render({ force: true });
    });
  }
  const input = el("input", {
    attrs: {
      type: "text",
      name: "url",
      placeholder: "https://…",
      value: current,
      "aria-label": localize("videoBackgroundAddress"),
    },
  });
  const result: unknown = await foundry.applications.api.DialogV2.prompt({
    window: { title: localize("videoBackgroundPick") },
    content: el("div", {
      children: [
        el("p", { text: localize("videoBackgroundAddressHint") }),
        input,
      ],
    }).outerHTML,
    ok: {
      label: localize("videoBackgroundUse"),
      callback: (_event: Event, button: HTMLButtonElement) =>
        (button.form?.elements.namedItem("url") as HTMLInputElement | null)
          ?.value,
    },
    rejectClose: false,
  });
  return typeof result === "string" && result.trim()
    ? result.trim()
    : undefined;
}
