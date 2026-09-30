/**
 * The decision evidence for #958 (CMP-16): the gain the frame's own bound takes off the only scene
 * with compiled lamps, beside the audit's fixed pre-exposure cut it was asked to match. The scene
 * is `aerial-410` (`bench/runner/scenes/aerial.ts`): 600 point lamps, each 400 cd at 18 m (`LAMP`),
 * drawn on surfaces whose least roughness is 0.7 (`aerialModel.ts` walls). The compiler publishes
 * intensity in W/sr — one candela is 1/683 W/sr (`asset-compiler-rust/src/compiler_lights.rs`,
 * `LUMENS_PER_WATT`) — so a lamp's peak is 400/683. The audit's cut bounds the pre-exposure
 * irradiance at 1e-2 W/m² (`958-audit-cut` @ `e0c89bb2c`): 18 → 7.7775 m, a shadow footprint
 * −81.3 %; refused for the 4–8 LSB it loses at night. The frame's bound cuts at the exposure and
 * curve's own quantum instead, and on the same lamp gains one to a few per cent — an order of
 * magnitude under the cut. Compiler-side range math alone, no Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { irradianceQuantum, visibleReach } from './lightReach.ts';

/** `aerial-410`'s one lamp (`bench/runner/scenes/aerial.ts`) and the scene's least roughness. */
const PEAK = 400 / 683,
  RANGE = 18,
  ROUGHNESS = 0.7;
const EXPOSURES = [1, 2, 4, 8] as const;
const CURVES = ['aces', 'linear'] as const;

test('the frame bound gains one to a few per cent on the reference scene, under the audit cut', () => {
  // The audit's fixed pre-exposure floor of 1e-2 W/m², through the same closed form.
  const cut = visibleReach(RANGE, PEAK, 1e-2);
  assert.ok(Math.abs(cut - 7.7775) < 0.01, `the audit's cut is ${cut} m`);
  assert.ok(Math.abs(1 - (cut / RANGE) ** 2 - 0.813) < 0.01, 'its shadow footprint');
  // The frame's own quantum, on the same lamp, at the night campaign's exposures and curves.
  let widest = { range: 0, footprint: 0 };
  for (const toneMapping of CURVES)
    for (const exposure of EXPOSURES) {
      const reach = visibleReach(
        RANGE,
        PEAK,
        irradianceQuantum({ exposure, toneMapping }, ROUGHNESS),
      );
      widest = {
        range: Math.max(widest.range, 1 - reach / RANGE),
        footprint: Math.max(widest.footprint, 1 - (reach / RANGE) ** 2),
      };
    }
  assert.ok(widest.range < 0.05, `the widest range gain is ${widest.range}`);
  assert.ok(widest.footprint < 0.1, `the widest shadow-footprint gain is ${widest.footprint}`);
  assert.ok(widest.range < (1 - cut / RANGE) / 10, 'an order of magnitude under the fixed cut');
});
