import type LiveKitClient from "../LiveKitClient";
import { MODULE_NAME } from "../utils/constants";
import Menu, { type MenuItem } from "./Menu";
import { localize } from "./controls";

/**
 * The noise suppression menu, opened from the voice panel or the camera
 * dock: pick a noise suppression model (or none), toggle the audio
 * refinements, or reset everything to the defaults.
 */
export default class NoiseModelMenu {
  private readonly menu: Menu;

  constructor(private readonly client: LiveKitClient) {
    this.menu = new Menu(
      "livekit-noise-menu",
      () => localize("noiseSuppressionModel"),
      () => this.items(),
    );
  }

  get isOpen(): boolean {
    return this.menu.isOpen;
  }

  /**
   * @param anchor    The element to show the menu against
   * @param control   The button that opened the menu, if not the anchor
   */
  toggle(anchor: HTMLElement, control: HTMLElement = anchor): void {
    this.menu.toggle(anchor, control);
  }

  close(): void {
    this.menu.close();
  }

  private items(): MenuItem[] {
    const client = this.client;
    const krispActive = client.getAudioProcessingConfig().model === "krisp";
    const changed = () => {
      client.onNoiseSettingsChanged();
    };

    // Unavailable models can't be picked, but stay visible when selected
    const models: MenuItem[] = client.getNoiseModelOptions().map((option) => ({
      type: "radio",
      label: option.label,
      detail: option.detail,
      checked: option.selected,
      disabled: !option.selectable && !option.selected,
      onSelect: () => client.selectNoiseModel(option.model).then(changed),
    }));

    // The refinements apply whether or not a model is selected, except auto
    // gain control, which is not used while Krisp is active. The noise gate
    // is in the voice settings, as the input sensitivity.
    const refinement = (
      key: "audioAutoGainControl" | "audioEchoCancellation",
      disabled: boolean,
    ): MenuItem => {
      const value = game.settings?.get(MODULE_NAME, key) ?? false;
      return {
        type: "checkbox",
        label: localize(key),
        detail: disabled ? localize("krispRefinementDisabled") : undefined,
        checked: value && !disabled,
        disabled,
        onSelect: () =>
          game.settings?.set(MODULE_NAME, key, !value).then(changed),
      };
    };

    return [
      { type: "header", label: localize("noiseSuppressionModel") },
      ...models,
      { type: "separator" },
      { type: "header", label: localize("noiseRefinements") },
      refinement("audioAutoGainControl", krispActive),
      refinement("audioEchoCancellation", false),
      { type: "separator" },
      {
        type: "action",
        label: localize("noiseResetDefaults"),
        icon: "fa-rotate-left",
        keepOpen: true,
        onSelect: () => client.resetNoiseSettings().then(changed),
      },
    ];
  }
}
