/**
 * Discord-style form controls shared by the voice settings popover, the menus
 * and the A/V settings window, so they all look and behave the same.
 *
 * Controls can either apply a change immediately (`onChange`) or be part of a
 * form (`name`), in which case the form collects their value on submit.
 */
import { LANG_NAME } from "../utils/constants";
import { el, uniqueId } from "./dom";

export const localize = (key: string): string =>
  game.i18n?.localize(`${LANG_NAME}.${key}`) ?? key;

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * A labelled setting row: a label and optional hint, with a control either
 * below them or, for `inline` rows, on the right. A form field (or the first
 * one inside `control`) is labelled and described by the row; buttons keep
 * their own text.
 */
export function settingRow({
  label,
  hint,
  control,
  inline = false,
}: {
  label: string;
  hint?: string | Node;
  control: Node;
  inline?: boolean;
}): HTMLElement {
  const input =
    control instanceof HTMLElement
      ? control.matches("input, select, textarea")
        ? control
        : control.querySelector<HTMLElement>("input, select, textarea")
      : null;
  const labelElement = el(input ? "label" : "span", {
    className: "livekit-setting-label",
    text: label,
  });
  const hintElement =
    hint &&
    el("p", {
      className: "livekit-setting-hint",
      attrs: { id: uniqueId("hint") },
      children: [hint],
    });
  if (input) {
    input.id ||= uniqueId("control");
    labelElement.setAttribute("for", input.id);
    input.removeAttribute("aria-label");
    if (hintElement) {
      input.setAttribute("aria-describedby", hintElement.id);
    }
  }
  return el("div", {
    className: `livekit-setting ${inline ? "inline" : ""}`.trim(),
    children: [
      el("div", {
        className: "livekit-setting-text",
        children: [labelElement, hintElement],
      }),
      control,
    ],
  });
}

/**
 * A select menu. With `dtype: "Number"`, Foundry's form handling submits the
 * value as a number.
 */
export function selectInput({
  name,
  label,
  options,
  value,
  dtype,
  disabled = false,
  onChange,
}: {
  name?: string;
  label: string;
  options: Option[];
  value: string;
  dtype?: "Number";
  disabled?: boolean;
  onChange?: (value: string) => void;
}): HTMLSelectElement {
  const select = el("select", {
    className: "livekit-select",
    attrs: { "aria-label": label },
    children: options.map((option) => {
      const element = el("option", {
        text: option.label,
        attrs: { value: option.value },
      });
      element.selected = option.value === value;
      element.disabled = !!option.disabled && option.value !== value;
      return element;
    }),
  });
  if (name) {
    select.name = name;
  }
  if (dtype) {
    select.dataset.dtype = dtype;
  }
  select.disabled = disabled;
  if (onChange) {
    select.addEventListener("change", () => {
      onChange(select.value);
    });
  }
  return select;
}

/**
 * A text or number field.
 */
export function textInput({
  name,
  value,
  type = "text",
  className = "",
  attrs = {},
}: {
  name: string;
  value: string;
  type?: "text" | "password" | "number";
  className?: string;
  attrs?: Record<string, string>;
}): HTMLInputElement {
  return el("input", {
    className:
      `${type === "number" ? "livekit-number" : "livekit-text"} ${className}`.trim(),
    attrs: { type, name, value, spellcheck: "false", ...attrs },
  });
}

/**
 * A labelled on/off switch, with an optional hint below the label.
 */
export function switchInput({
  name,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  name?: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}): HTMLElement {
  const labelId = uniqueId("label");
  const hintId = hint ? uniqueId("hint") : undefined;
  const input = el("input", {
    attrs: {
      type: "checkbox",
      role: "switch",
      "aria-labelledby": labelId,
      ...(hintId ? { "aria-describedby": hintId } : {}),
    },
  });
  if (name) {
    input.name = name;
  }
  input.checked = checked;
  input.disabled = disabled;
  if (onChange) {
    input.addEventListener("change", () => {
      onChange(input.checked);
    });
  }
  return el("label", {
    className: `livekit-switch ${disabled ? "disabled" : ""}`.trim(),
    children: [
      el("span", {
        className: "livekit-setting-text",
        children: [
          el("span", {
            className: "livekit-setting-label",
            text: label,
            attrs: { id: labelId },
          }),
          hint &&
            el("span", {
              className: "livekit-setting-hint",
              text: hint,
              attrs: { id: hintId ?? "" },
            }),
        ],
      }),
      input,
      el("span", {
        className: "livekit-switch-track",
        attrs: { "aria-hidden": "true" },
      }),
    ],
  });
}

/**
 * Radio inputs sharing a name, for `radioGroup` and `segmentedControl`.
 */
function radioInputs({
  name,
  value,
  options,
  itemClass,
  onChange,
}: {
  name: string;
  value: string;
  options: Option[];
  itemClass: string;
  onChange?: (value: string) => void;
}): HTMLElement[] {
  return options.map((option) => {
    const input = el("input", {
      attrs: { type: "radio", name, value: option.value },
    });
    input.checked = option.value === value;
    input.disabled = !!option.disabled;
    if (onChange) {
      input.addEventListener("change", () => {
        onChange(option.value);
      });
    }
    return el("label", {
      className: itemClass,
      children: [input, el("span", { text: option.label })],
    });
  });
}

/**
 * A group of radio buttons styled as rows.
 */
export function radioGroup({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: Option[];
  onChange?: (value: string) => void;
}): HTMLElement {
  return el("div", {
    className: "livekit-radio-group",
    attrs: { role: "radiogroup", "aria-label": label },
    children: radioInputs({
      name,
      value,
      options,
      itemClass: "livekit-radio",
      onChange,
    }),
  });
}

/**
 * A row of joined buttons of which one is selected, for a few short choices.
 */
export function segmentedControl({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: Option[];
  onChange?: (value: string) => void;
}): HTMLElement {
  return el("div", {
    className: "livekit-segmented",
    attrs: { role: "radiogroup", "aria-label": label },
    children: radioInputs({
      name,
      value,
      options,
      itemClass: "livekit-segment",
      onChange,
    }),
  });
}

/**
 * A slider with its label and current value above it. `onInput` follows the
 * slider while it moves; `onChange` gets the value once it is let go.
 */
export function slider({
  name,
  label,
  min,
  max,
  step = 1,
  value,
  format = (current) => current.toString(),
  onInput,
  onChange,
}: {
  name?: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (value: number) => string;
  onInput?: (value: number) => void;
  onChange?: (value: number) => void;
}): HTMLElement {
  const input = el("input", {
    className: "livekit-slider",
    attrs: {
      type: "range",
      min: min.toString(),
      max: max.toString(),
      step: step.toString(),
      value: value.toString(),
    },
  });
  if (name) {
    input.name = name;
  }
  const output = el("output", {
    className: "livekit-slider-value",
    text: format(value),
  });
  const update = () => {
    const current = Number(input.value);
    output.textContent = format(current);
    input.setAttribute("aria-valuetext", format(current));
    input.style.setProperty(
      "--fill",
      `${(((current - min) / (max - min)) * 100).toString()}%`,
    );
  };
  update();
  input.addEventListener("input", () => {
    update();
    onInput?.(Number(input.value));
  });
  input.addEventListener("change", () => {
    onChange?.(Number(input.value));
  });
  return el("label", {
    className: "livekit-slider-field",
    children: [
      el("span", {
        className: "livekit-slider-header",
        children: [
          el("span", { className: "livekit-setting-label", text: label }),
          output,
        ],
      }),
      input,
    ],
  });
}

/* -------------------------------------------- */
/*  Push to talk                                */
/* -------------------------------------------- */

export interface KeyBinding {
  key: string;
  modifiers?: string[];
}

interface Keybindings {
  actions: Map<string, unknown>;
  get(namespace: string, action: string): KeyBinding[];
  set(namespace: string, action: string, bindings: KeyBinding[]): Promise<void>;
}

function getKeybindings(): Keybindings | undefined {
  const keybindings = game.keybindings as unknown as Keybindings | undefined;
  return keybindings?.actions.has("core.pushToTalk") ? keybindings : undefined;
}

/**
 * The push to talk key bindings, or undefined if Foundry has no push to talk
 * key binding.
 */
export function getPushToTalkBindings(): KeyBinding[] | undefined {
  return getKeybindings()?.get("core", "pushToTalk");
}

export function setPushToTalkKey(code: string): Promise<void> {
  return (
    getKeybindings()?.set("core", "pushToTalk", [
      { key: code, modifiers: [] },
    ]) ?? Promise.resolve()
  );
}

/**
 * A readable name for a KeyboardEvent.code, using Foundry's helper when
 * available.
 */
export function keyDisplayName(code: string): string {
  const keyboardManager = (
    foundry as unknown as {
      helpers?: {
        interaction?: {
          KeyboardManager?: {
            getKeycodeDisplayString?: (code: string) => string;
          };
        };
      };
    }
  ).helpers?.interaction?.KeyboardManager;
  return (
    keyboardManager?.getKeycodeDisplayString?.(code) ??
    code.replace(/^(Key|Digit)/, "")
  );
}

function describeBindings(bindings: KeyBinding[]): string {
  return (
    bindings
      .map((binding) =>
        [...(binding.modifiers ?? []), keyDisplayName(binding.key)].join(" + "),
      )
      .join(", ") || localize("pushToTalkUnbound")
  );
}

/**
 * A button showing the push to talk shortcut. Clicking it records the next
 * key press (Escape cancels) and passes its code to `onRecord`.
 */
export function keybindRecorder(
  bindings: KeyBinding[],
  onRecord: (code: string) => void,
): HTMLButtonElement {
  const button = el("button", {
    className: "livekit-keybind",
    text: describeBindings(bindings),
    attrs: { type: "button", "aria-live": "polite" },
  });
  button.addEventListener("click", () => {
    button.textContent = localize("pushToTalkRecord");
    button.classList.add("recording");
    const stop = () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      button.removeEventListener("blur", onBlur);
      button.classList.remove("recording");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      stop();
      if (event.code === "Escape") {
        button.textContent = describeBindings(bindings);
        return;
      }
      button.textContent = describeBindings([{ key: event.code }]);
      onRecord(event.code);
    };
    const onBlur = () => {
      stop();
      button.textContent = describeBindings(bindings);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    button.addEventListener("blur", onBlur);
  });
  return button;
}
