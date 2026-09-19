/** Colour demos: the engine's own curve and HSL conversion, on values the reader moves. */
import { hslToLinearRgb, linearToSrgb, srgbToLinear } from './engine.js';
import { canvasView, formatNumber, slider, swatchView, valueView } from './demoKit.js';
import { drawCurve } from './demoDraw.js';

const show = (v) => Array.from(v, formatNumber).join(', ');

export const COLOR_DEMOS = {
  srgbToLinear: {
    controls: [slider('v', 'encoded sRGB value', 0, 1, 0.5, 0.01)],
    run(state) {
      const linear = srgbToLinear(state.v);
      const back = linearToSrgb(linear);
      return [
        valueView('the curve, both ways', [
          ['srgbToLinear(c)', formatNumber(linear)],
          ['linearToSrgb of that', formatNumber(back)],
          ['round-trip error', formatNumber(Math.abs(back - state.v))],
        ]),
        swatchView('the same value, encoded and linear', [
          { css: grey(state.v), label: `encoded ${formatNumber(state.v)}` },
          { css: grey(linear), label: `linear ${formatNumber(linear)}` },
        ]),
        canvasView(
          'the curve over the whole range',
          (context, width, height) => drawCurve(context, width, height, srgbToLinear),
          180,
        ),
      ];
    },
  },
  hslToLinearRgb: {
    controls: [
      slider('h', 'hue', 0, 1, 0.08, 0.005),
      slider('s', 'saturation', 0, 1, 0.8, 0.01),
      slider('l', 'lightness', 0, 1, 0.5, 0.01),
    ],
    run(state) {
      const rgb = new Float64Array(3);
      hslToLinearRgb(rgb, 0, state.h, state.s, state.l);
      const encoded = Array.from(rgb, linearToSrgb);
      return [
        valueView('hslToLinearRgb(out, 0, h, s, l)', [
          ['linear rgb', show(rgb)],
          ['encoded for the screen', encoded.map(formatNumber).join(', ')],
        ]),
        swatchView('what those numbers are', [
          {
            css: `rgb(${encoded.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)).join(',')})`,
            label: 'the colour',
          },
        ]),
      ];
    },
  },
};

function grey(value) {
  const level = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `rgb(${level},${level},${level})`;
}
