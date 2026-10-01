import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { Texture } from '../texture/index.ts';
import type { LabelHandle } from './index.ts';
import { createCanvas, GlobalFonts, type Canvas } from '@napi-rs/canvas';

// A redistributable font, pinned by the lockfile: glyph tests do not depend on machine fonts.
assert.ok(
  GlobalFonts.registerFromPath(
    fileURLToPath(
      import.meta.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
    ),
    'LabelTest',
  ),
  'the pinned Noto Sans test font is available',
);
export const LABEL_FONT = '32px LabelTest';

/** The page supplies real CPU Canvas2D; only font readiness is controllable by the test. */
export function labelCanvas(t: TestContext, load = async (_font: string, _text: string) => {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      fonts: { load },
      createElement(tag: string) {
        assert.equal(tag, 'canvas');
        return createCanvas(1, 1);
      },
    },
  });
  t.after(() =>
    previous
      ? Object.defineProperty(globalThis, 'document', previous)
      : Reflect.deleteProperty(globalThis, 'document'),
  );
}

/** The actual glyph alpha pixels, read back from the image held by the draw material. */
export function glyphPixels(image: unknown) {
  const canvas = image as Canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    width: canvas.width,
    height: canvas.height,
    alpha: rgba.filter((_, at) => at % 4 === 3),
  };
}

/** The real texture sampled by a public label's sprite material. */
export function labelTexture(label: LabelHandle) {
  const material = label.object.material;
  assert.ok(!Array.isArray(material));
  const map = material.map;
  assert.ok(map instanceof Texture);
  return map;
}
