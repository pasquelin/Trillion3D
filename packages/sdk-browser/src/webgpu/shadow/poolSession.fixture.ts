// The session the shadow pool tests run (#831, #1345): a sun, a pool allocated at its setting at a
// first frame, reports that ask it pages, a device that refuses what a limit says.
import {
  SUN,
  VIEW,
  planFrame,
  report,
  sunPages,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { asWebgpuDevice } from '../../../../../tests/kit/gpu/webgpuDevice.ts';
import { createWebgpuLightState, type WebgpuLightState } from '../pages/state/lights.ts';
import { shadowPoolShapeOf, sizeShadowPool } from './poolSize.ts';
import { followShadowCeiling } from './poolCeiling.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

type Fake = { size: number[]; destroyed: boolean };

/** A device 8 192 texels wide that refuses, as out of memory, every texture past `limit.bytes`. */
function device(limit: { bytes: number }) {
  const gpu = asWebgpuDevice({
    limits: { maxTextureDimension2D: 8192, maxBufferSize: 2 ** 28 },
    createTexture: ({ size }: { size: number[] }) => {
      if (size[0] * size[1] * (size[2] ?? 1) * 4 > limit.bytes) gpu.raise('Out of memory');
      const texture: Fake & Record<string, unknown> = { size, destroyed: false };
      return Object.assign(texture, {
        depthOrArrayLayers: size[2] ?? 1,
        destroy: () => void (texture.destroyed = true),
        createView: (view?: GPUTextureViewDescriptor) => ({ layer: view?.baseArrayLayer ?? -1 }),
      });
    },
    createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
    queue: { writeBuffer() {}, submit() {} },
  });
  return { device: gpu.device };
}

/** `count` sun pages round the eye, forty a row, a level of 1 600 after another from the fourth
 *  above the finest: all within the clipmap's extent. */
function sunGrid(plan: WebgpuLightState['plan'], slice: number, count: number) {
  const pages: number[][] = [];
  for (let i = 0; i < count; i++) pages.push([(i % 40) - 20, (Math.floor(i / 40) % 40) - 20]);
  return pages.flatMap((page, i) =>
    sunPages(plan, slice, plan.sun.finest[slice] + 4 + Math.floor(i / 1600), [page]),
  );
}

/** A session with a sun, its pool allocated at the first frame — `shadowPoolPages` of them, the
 *  setting's by default — and a first report naming nothing: nothing said yet; its atlas records
 *  the textures it takes. */
export async function session(shadowPoolPages?: number) {
  installGpuGlobals();
  const limit = { bytes: Infinity },
    gpu = device(limit),
    context = { shadowPoolPages },
    shape = shadowPoolShapeOf(context, gpu.device.limits),
    lights = createWebgpuLightState(shape.side, undefined, undefined, shape.layers),
    said: Array<[string, Record<string, unknown>]> = [],
    taken: Fake[] = [];
  const make = (size: number[]) =>
    gpu.device.createTexture({ size, format: 'depth32float', usage: 0 });
  lights.shadows = {
    get texture() {
      return taken.at(-1);
    },
    allocationBytes: 0,
    transmittanceHeld: false,
    makePool: (side: number, layers: number) => make([side * 128, side * 128, layers]),
    sizePool: (_: number, __: number, made: Fake) => void taken.push(made),
  } as unknown as NonNullable<typeof lights.shadows>;
  lights.store.add({ ...SUN, id: 'shadow sun' });
  const rt = {
    lights,
    context,
    capture: { capturing: false },
    setup: { viewport: [1280, 720] },
    blendState: { blendGpu: [] },
    gpu: { device: gpu.device },
    run: { lost: false, frame: 0, gate: { resourcesChanged() {} } },
    signal: new AbortController().signal,
    diag: {
      engineDiagnostic: (phase: string, _: string, context: Record<string, unknown>) =>
        said.push([phase, context]),
      diagnosticFailure: (phase: string, error: unknown) => said.push([phase, { error }]),
    },
  } as unknown as WebgpuPagesRuntime;
  sizeShadowPool(rt);
  await lights.shadowGrant?.done;
  let at = 0;
  /** Two frames: the first reports `count` pages of the sun, the second's plan reads the report,
   *  under a view that rests or, `moving`, steps a millimetre a frame. Then the pool weighs what it
   *  asked (`followShadowCeiling`). */
  const ask = (count: number, moving = false) => {
    const { plan, store } = lights,
      view = () => (moving ? { ...VIEW, position: [at * 1e-3, 5, 0] as const } : VIEW);
    planFrame(plan, store, at, view());
    plan.commit();
    report(plan, store, at, count ? sunGrid(plan, store.sliceOf(0), count) : []);
    planFrame(plan, store, ++at, view());
    plan.commit();
    at++;
    followShadowCeiling(rt);
  };
  ask(0);
  said.length = 0;
  return { rt, lights, limit, said, ask, taken };
}
