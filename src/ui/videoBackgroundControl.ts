import { MODULE_NAME } from "../utils/constants";
import { supportsVideoBackground } from "../VideoBackground";
import { localize, segmentedControl, settingRow } from "./controls";

/**
 * The choice of camera background effect: none or blur. Used in the voice
 * settings popover, which applies it right away (`apply`), and in the A/V
 * settings window, which saves it with the form (`name`).
 *
 * @param failed    The effect failed to start on this computer
 */
export function videoBackgroundRow({
  name,
  apply = false,
  failed = false,
}: {
  name: string;
  apply?: boolean;
  failed?: boolean;
}): HTMLElement {
  const supported = supportsVideoBackground();
  const value = game.settings?.get(MODULE_NAME, "videoBackground") ?? "none";
  const hint = !supported
    ? localize("videoBackgroundUnsupported")
    : failed && value !== "none"
      ? localize("videoBackgroundFailedHint")
      : localize("videoBackgroundHint");
  return settingRow({
    label: localize("videoBackground"),
    hint,
    control: segmentedControl({
      name,
      label: localize("videoBackground"),
      value: supported ? value : "none",
      options: [
        { value: "none", label: localize("videoBackgroundNone") },
        {
          value: "blur",
          label: localize("videoBackgroundBlur"),
          disabled: !supported,
        },
      ],
      onChange: apply
        ? (selected) => {
            void game.settings?.set(MODULE_NAME, "videoBackground", selected);
          }
        : undefined,
    }),
  });
}
