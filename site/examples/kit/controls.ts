import { overlay } from './overlay.ts';

/**
 * What an example declares for one control, the kind read from the value itself:
 * `[min, max, value]` or `[min, max, value, step]` a slider, `'#rrggbb'` a colour picker,
 * `true`/`false` a toggle, `['a', 'b', …]` a choice starting on its first option, a function a
 * button.
 */
export type ControlSpec =
  | readonly [number, number, number]
  | readonly [number, number, number, number]
  | `#${string}`
  | boolean
  | readonly string[]
  | (() => void);

/** The live value of a declared control: a button has none. */
type ControlValue<Spec> = Spec extends readonly number[]
  ? number
  : Spec extends readonly string[]
    ? string
    : Spec extends boolean
      ? boolean
      : Spec extends () => void
        ? never
        : string;

export type ControlValues<Specs> = {
  -readonly [Key in keyof Specs as Specs[Key] extends () => void ? never : Key]: ControlValue<
    Specs[Key]
  >;
};

/** One control as the panel draws it. */
type Control =
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step: number }
  | { kind: 'colour'; key: string; label: string }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'choice'; key: string; label: string; options: readonly string[] }
  | { kind: 'button'; key: string; label: string; press: () => void };

/** `lightIntensity` → `Light intensity`: the label a key reads as. */
export function labelOf(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isSlider = (spec: readonly (number | string)[]): spec is readonly number[] =>
  typeof spec[0] === 'number';

/** Reads the declared specs into the controls to draw and the values they start at. */
export function describe(specs: Record<string, ControlSpec>) {
  const controls: Control[] = [];
  const values: Record<string, number | string | boolean> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const label = labelOf(key);
    if (typeof spec === 'function') controls.push({ kind: 'button', key, label, press: spec });
    else if (typeof spec === 'boolean') {
      controls.push({ kind: 'toggle', key, label });
      values[key] = spec;
    } else if (typeof spec === 'string') {
      if (!/^#[0-9a-f]{6}$/i.test(spec)) throw new Error(`${key}: a colour is '#rrggbb'`);
      controls.push({ kind: 'colour', key, label });
      values[key] = spec.toLowerCase();
    } else if (isSlider(spec)) {
      const [min, max, value, step = 10 ** Math.floor(Math.log10((max - min) / 100))] = spec;
      if (!(min < max) || value < min || value > max)
        throw new Error(`${key}: a slider is [min, max, value], the value between the two`);
      controls.push({ kind: 'slider', key, label, min, max, step });
      values[key] = value;
    } else {
      if (!spec.length) throw new Error(`${key}: a choice needs at least one option`);
      controls.push({ kind: 'choice', key, label, options: spec });
      values[key] = spec[0];
    }
  }
  return { controls, values };
}

/** A slider's value as printed beside it: as many decimals as its step carries. */
export function printed(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step))));
  return value.toFixed(decimals);
}

function field(control: Control, values: Record<string, unknown>, changed: () => void) {
  const set = (value: unknown) => {
    values[control.key] = value;
    changed();
  };
  if (control.kind === 'button') {
    const button = document.createElement('button');
    button.className = 'btn btn-xs btn-primary btn-outline w-full';
    button.textContent = control.label;
    button.onclick = control.press;
    return button;
  }
  const row = document.createElement('label');
  row.className = 'flex items-center gap-2';
  const name = document.createElement('span');
  name.className = 'w-24 shrink-0 truncate text-xs';
  name.textContent = control.label;
  row.append(name);
  if (control.kind === 'choice') {
    const select = document.createElement('select');
    select.className = 'select select-xs min-w-0 flex-1';
    select.append(...control.options.map((option) => new Option(option, option)));
    select.onchange = () => set(select.value);
    row.append(select);
    return row;
  }
  const input = document.createElement('input');
  row.append(input);
  if (control.kind === 'toggle') {
    input.type = 'checkbox';
    input.className = 'toggle toggle-xs toggle-primary';
    input.checked = Boolean(values[control.key]);
    input.onchange = () => set(input.checked);
  } else if (control.kind === 'colour') {
    input.type = 'color';
    input.className = 'h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0';
    input.value = String(values[control.key]);
    input.oninput = () => set(input.value);
  } else {
    const { min, max, step } = control;
    Object.assign(input, { type: 'range', min, max, step, value: values[control.key] });
    input.className = 'range range-xs range-primary min-w-0 flex-1';
    const shown = document.createElement('output');
    shown.className = 'w-10 text-right text-xs tabular-nums';
    const show = () => (shown.textContent = printed(input.valueAsNumber, step));
    input.oninput = () => (show(), set(input.valueAsNumber));
    show();
    row.append(shown);
  }
  return row;
}

/**
 * A settings panel in the top-right corner of the example, one row per declared control. The
 * returned object holds the live values; `onChange(values, key)` runs once at start, with no
 * key, then after every change. The page hosting the example shows or hides the panel by posting
 * `{ type: 'wg:controls', visible }`; standalone, it is shown.
 */
export function controls<const Specs extends Record<string, ControlSpec>>(
  specs: Specs,
  onChange: (values: ControlValues<Specs>, key?: keyof ControlValues<Specs>) => void = () => {},
): ControlValues<Specs> {
  const { controls: declared, values } = describe(specs);
  const live = values as ControlValues<Specs>;
  const box = document.createElement('details');
  box.className =
    'pointer-events-auto absolute top-3 right-3 w-64 max-w-[calc(100vw-1.5rem)] card bg-base-100/85 text-sm shadow-xl backdrop-blur';
  box.toggleAttribute('open', innerWidth >= 640);
  const title = document.createElement('summary');
  title.className = 'cursor-pointer select-none px-3 py-2 font-semibold';
  title.textContent = 'Controls';
  const rows = document.createElement('div');
  rows.className = 'flex flex-col gap-2 px-3 pb-3';
  for (const control of declared)
    rows.append(field(control, values, () => onChange(live, control.key as never)));
  box.append(title, rows);
  overlay().append(box);
  addEventListener('message', (event) => {
    const data = event.data as { type?: unknown; visible?: unknown } | null;
    if (event.source !== parent || data?.type !== 'wg:controls') return;
    box.hidden = !data.visible;
  });
  onChange(live);
  return live;
}
