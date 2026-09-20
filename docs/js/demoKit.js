import { localizeDemoText } from './i18n/demo.fr.js';

export function slider(name, label, min, max, value, step) {
  return { kind: 'slider', name, label, min, max, value, step: step ?? (max - min) / 100 };
}

export function choice(name, label, options, value) {
  return { kind: 'choice', name, label, options, value: value ?? options[0].value };
}

export function matrixView(title, matrix, note) {
  return { kind: 'matrix', title, values: Array.from(matrix), note };
}

export function valueView(title, rows) {
  return { kind: 'values', title, rows };
}

export function verdictView(title, ok, text) {
  return { kind: 'verdict', title, ok, text };
}

export function swatchView(title, swatches) {
  return { kind: 'swatch', title, swatches };
}

export function canvasView(title, paint, height = 260) {
  return { kind: 'canvas', title, paint, height };
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 1e6 || absolute < 1e-4) return value.toExponential(2);
  return value.toFixed(absolute >= 100 ? 1 : 4).replace(/\.?0+$/, '');
}

export function localizedCanvasContext(context, locale) {
  if (locale !== 'fr') return context;
  return new Proxy(context, {
    get(target, property) {
      if (property === 'fillText')
        return (value, ...arguments_) =>
          target.fillText(localizeDemoText(String(value), locale), ...arguments_);
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}
