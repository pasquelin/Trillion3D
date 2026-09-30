// #1281: the reference-scoped sun window is one session parameter: the transparent and water
// passes read the shadows of the session window too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceSunWindow } from '../../frame/referenceMode.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { blendShader } from '../blend/shader.ts';
import { waterCompositeShader, waterRoutedShader } from '../water/compositeWgsl.ts';

const BLEND_SHADER = blendShader();
const WATER_COMPOSITE_SHADER = waterCompositeShader();

/** The window a reference session at the boss's case runs with: 1117 CSS at DPR 2, 55°. */
const REFERENCE_SUN_WINDOW = referenceSunWindow(1117 * 2, 55);

test('the transparent and water passes read the shadows of the session window too', () => {
  const window = new RegExp(`SUN_WINDOW_PAGES:i32=${REFERENCE_SUN_WINDOW}\\b`);
  const ordinary = new RegExp(`SUN_WINDOW_PAGES:i32=${SUN_WINDOW}\\b`);
  for (const [pass, text] of Object.entries({
    blend: blendShader(REFERENCE_SUN_WINDOW),
    water: waterCompositeShader(REFERENCE_SUN_WINDOW),
    routed: waterRoutedShader(REFERENCE_SUN_WINDOW),
  })) {
    assert.match(text, window, pass);
    assert.doesNotMatch(text, ordinary, pass);
  }
  // No window: the ordinary text, the one every ordinary session compiles.
  assert.equal(blendShader(SUN_WINDOW), BLEND_SHADER);
  assert.equal(waterCompositeShader(SUN_WINDOW), WATER_COMPOSITE_SHADER);
  assert.match(BLEND_SHADER, ordinary);
});
