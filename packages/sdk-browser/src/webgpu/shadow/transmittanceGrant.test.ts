// #992: the transmittance layer is asked of the shadows' one grant, then of the device under an
// out-of-memory check, never inside a frame; past the grant or refused, it is named and the opaque
// shadows stay whole. A layer asked late has every mapped page drawn again once it lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STALE_FULL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { refreshWebgpuMaterials } from '../pages/io/refreshMaterials.ts';
import { deviceAnswering } from '../frame/deviceAnswer.ts';
import { frameTransmittance, grantShadowTransmittance } from './transmittanceGrant.ts';

const HELD = 1000,
  BYTES = shadowTransmittanceBytes(8);

/** A runtime whose pool of 8 pages a side is sized and holds `HELD` bytes; `refuse` has the device
 *  refuse the layer as out of memory. */
function sized(refuse = false) {
  const lights = createWebgpuLightState(8),
    taken: unknown[] = [],
    said: string[] = [],
    layer = {
      bytes: BYTES,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
  let changed = 0;
  lights.shadows = {
    texture: {},
    allocationBytes: HELD,
    get transmittanceHeld() {
      return taken.length > 0;
    },
    makeTransmittance: () => layer,
    takeTransmittance: (made: unknown) => void taken.push(made),
    readTransmittance: () => taken[0],
  } as never;
  const device = {
    pushErrorScope() {},
    popErrorScope: async () => (refuse ? { message: 'Out of memory' } : null),
  };
  const rt = {
    lights,
    gpu: { device },
    run: { lost: false, frame: 7, gate: { resourcesChanged: () => changed++ } },
    diag: {
      engineDiagnostic: (phase: string, _: string, context: Record<string, unknown>) =>
        void said.push(`${phase}:${String(context.pressure ?? context.pool)}`),
      diagnosticFailure: (phase: string) => void said.push(phase),
    },
    signal: new AbortController().signal,
  } as unknown as WebgpuPagesRuntime;
  return { rt, lights, layer, taken, said, changed: () => changed };
}

test('a layer the grant and the device hold is taken, counted in the peak, with no event', async () => {
  const { rt, lights, layer, taken, said, changed } = sized();
  await grantShadowTransmittance(rt);
  assert.deepEqual(taken, [layer]);
  assert.equal(lights.memory.peakBytes, HELD + BYTES, 'the peak counts the layer with the pool');
  assert.deepEqual([lights.memory.events, lights.memory.bias, said], [[], 0, []]);
  assert.equal(changed(), 1, 'the next frame reads it');
});

test('a layer past the grant is never made nor asked again, and said by name', async () => {
  const { rt, lights, taken, said } = sized();
  await grantShadowTransmittance(rt, HELD + BYTES - 1);
  await grantShadowTransmittance(rt, HELD + BYTES - 1);
  assert.deepEqual(taken, []);
  assert.deepEqual(lights.memory.events, ['transmittance-over-grant'], 'said once');
  assert.deepEqual(said, ['shadow-memory:transmittance-over-grant']);
  assert.equal(lights.transmittanceDenied, true);
});

test('a layer the device refuses is freed and named; the opaque shadows are kept whole', async () => {
  const { rt, lights, layer, taken, said } = sized(true);
  await grantShadowTransmittance(rt);
  assert.deepEqual(taken, []);
  assert.equal(layer.destroyed, true, 'what the device refused is freed');
  assert.deepEqual(lights.memory.events, ['transmittance-refused']);
  assert.deepEqual(said, ['gpu-out-of-memory:shadow-transmittance']);
  assert.equal(lights.memory.bias, 0, 'the pool keeps its resolution');
  assert.equal(lights.shadowReason, null, 'the shadows stay on');
  assert.equal(frameTransmittance(rt, {} as GPUCommandEncoder), undefined);
  assert.equal(lights.shadowGrant, undefined, 'never asked again, no frame held for it');
});

test('a layer asked late holds the frames until it lands, then every mapped page is redrawn', async () => {
  const { rt, lights, layer } = sized(),
    { pool } = lights.plan;
  pool.owner[3] = 5;
  const encoder = {} as GPUCommandEncoder;
  assert.equal(frameTransmittance(rt, encoder), undefined, 'not yet granted: not read');
  const grant = lights.shadowGrant!;
  assert.equal(grant.settled, false, 'the next frames are held on it');
  await grant.done;
  assert.equal(pool.dirty[3], STALE_FULL, 'the mapped page is drawn again, with the layer');
  assert.equal(pool.dirty[4], 0, 'a free page is left alone');
  assert.equal(frameTransmittance(rt, encoder), layer);
  assert.equal(lights.shadowGrant, grant, 'asked once');
});

test('a blended surface rewritten to cast asks its layer before any frame, drawn at the first', async () => {
  const { rt, lights, layer } = sized(),
    surface = { transparentShadow: false, blending: 'normal', transmission: 0, opacity: 0.5 };
  Object.assign(rt, {
    blendState: { blendGpu: [{ surface }] },
    layout: { rows: { tableEpoch: 0 } },
    vis: {},
  });
  Object.assign(rt.run.gate, { sceneMoved() {} });
  surface.transparentShadow = true;
  refreshWebgpuMaterials(rt);
  const grant = lights.shadowGrant!;
  assert.equal(grant?.settled, false, 'asked by the rewrite, before any frame is encoded');
  assert.equal(deviceAnswering(rt), true, 'the next frame is held on it');
  await grant.done;
  assert.equal(frameTransmittance(rt, {} as GPUCommandEncoder), layer, 'the first frame reads it');
  assert.equal(lights.shadowGrant, grant, 'asked once');
});
