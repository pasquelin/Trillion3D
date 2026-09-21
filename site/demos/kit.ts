import type { Locale } from '../content/locale.ts';
import { localizeDemoText } from '../content/i18n/demo.fr.ts';

/** A demo's control: every demo drives its model with numeric sliders. */
export interface DemoControlDef {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface MatrixView {
  kind: 'matrix';
  title?: string;
  values: number[];
  note?: string;
}

interface ValuesView {
  kind: 'values';
  title?: string;
  rows: [string, string | number][];
}

interface VerdictView {
  kind: 'verdict';
  title?: string;
  ok: boolean;
  text: string;
}

export interface SwatchItem {
  label: string;
  css: string;
}

interface SwatchView {
  kind: 'swatch';
  title?: string;
  swatches: SwatchItem[];
}

export interface DrawingView {
  kind: 'canvas';
  title?: string;
  height: number;
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

export type DemoViewItem = MatrixView | ValuesView | VerdictView | SwatchView | DrawingView;

/** Every demo's `run` reads only numeric fields from the state its controls maintain. */
export type DemoState = Record<string, number>;

export interface DemoDef {
  controls?: DemoControlDef[];
  run: (state: DemoState) => DemoViewItem[];
}

export function slider(
  name: string,
  label: string,
  min: number,
  max: number,
  value: number,
  step?: number,
) {
  return { name, label, min, max, value, step: step ?? (max - min) / 100 };
}

export function matrixView(title: string, matrix: Float64Array, note?: string) {
  return { kind: 'matrix' as const, title, values: Array.from(matrix), note };
}

export function valueView(title: string, rows: [string, string | number][]) {
  return { kind: 'values' as const, title, rows };
}

export function verdictView(title: string, ok: boolean, text: string) {
  return { kind: 'verdict' as const, title, ok, text };
}

export function swatchView(title: string, swatches: SwatchItem[]) {
  return { kind: 'swatch' as const, title, swatches };
}

export function canvasView(
  title: string,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  height = 260,
) {
  return { kind: 'canvas' as const, title, paint, height };
}

export function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 1e6 || absolute < 1e-4) return value.toExponential(2);
  return value.toFixed(absolute >= 100 ? 1 : 4).replace(/\.?0+$/, '');
}

export function localizedCanvasContext(context: CanvasRenderingContext2D, locale: Locale) {
  if (locale !== 'fr') return context;
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === 'fillText')
        return (text: string, ...rest: [x: number, y: number, maxWidth?: number]) =>
          target.fillText(localizeDemoText(String(text), locale), ...rest);
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      Reflect.set(target, property, value);
      return true;
    },
  });
}
