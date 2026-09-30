// The session the shadow pool resize tests run (#1208, #1345): a sun, a pool seeded at a first
// frame, reports that ask it pages, a device that refuses what a limit says and records the page
// moves it is handed.
import { SEED_POOL_SIDE } from '../../../../sdk-core/src/scene/light-shadow/poolDemand.ts';
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
import { sizeShadowPool } from './poolSize.ts';
import { shadowBufferBytes } from '../../gpu/shadow/shadowData.ts';
import { followShadowDemand } from './poolResize.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

type Fake = { size: number[]; destroyed: boolean };

/** A device 8 192 texels wide that refuses, as out of memory, every texture past `limit.bytes`,
 *  and records the page moves it is given: the passes (target layer, instances) and the copies. */
function device(limit: { bytes: number }) {
  const passes: number[][] = [],
    copies: number[][] = [],
    moves: Uint32Array[] = [];
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
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: ({ depthStencilAttachment }: GPURenderPassDescriptor) => ({
        setPipeline() {},
        setBindGroup() {},
        draw: (_: number, count: number, __: number, first: number) =>
          passes.push([
            (depthStencilAttachment!.view as unknown as { layer: number }).layer,
            count,
            first,
          ]),
        end() {},
      }),
      copyTextureToTexture: (_: unknown, to: { origin: number[] }) => copies.push(to.origin),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (_: unknown, __: number, data: Uint32Array) => moves.push(data.slice()),
      submit() {},
    },
  });
  return { device: gpu.device, passes, copies, moves };
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

/** A session with a sun, its pool seeded — the budget's whole pool, then, when `sized`, the seed
 *  its first report asks for nothing: what the tests grow and shrink from, nothing said or moved
 *  yet —; its atlas records what it takes. */
export async function session(transmittance = false, sized = true) {
  installGpuGlobals();
  const limit = { bytes: Infinity },
    gpu = device(limit),
    lights = createWebgpuLightState(SEED_POOL_SIDE),
    said: Array<[string, Record<string, unknown>]> = [];
  /** A transmittance layer: its two textures, as the mover reads them. */
  const make = (size: number[]) =>
    gpu.device.createTexture({ size, format: 'depth32float', usage: 0 });
  const makeLayer = () => ({
    bytes: 0,
    colour: make([8192, 8192, 2]),
    nearest: make([1, 1, 1]),
    destroy() {},
  });
  let texture: Fake | undefined,
    layer: object | undefined = transmittance ? makeLayer() : undefined;
  lights.shadows = {
    get texture() {
      return texture;
    },
    allocationBytes: 0,
    bufferBytes: shadowBufferBytes(lights.plan.table.heldEntries),
    get transmittanceHeld() {
      return !!layer;
    },
    makePool: (side: number, layers: number) => make([side * 128, side * 128, layers]),
    makeTransmittance: makeLayer,
    sizePool(_: number, __: number, made: Fake, next = layer) {
      const held = texture && { texture, transmittance: layer };
      [texture, layer] = [made, next];
      return held;
    },
  } as unknown as NonNullable<typeof lights.shadows>;
  lights.store.add({ ...SUN, id: 'shadow sun' });
  const rt = {
    lights,
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
  /** The pool follows the latest report read, the resize it asks answered. */
  const follow = async () => {
    followShadowDemand(rt);
    await lights.shadowGrant?.done;
  };
  let at = 0;
  /** Two frames: the first reports `count` pages of the sun, the second's plan reads the report,
   *  under a view that rests or, `moving`, steps a millimetre a frame. Then the pool follows the
   *  demand, the resize it asks answered. */
  const ask = async (count: number, moving = false) => {
    const { plan, store } = lights,
      view = () => (moving ? { ...VIEW, position: [at * 1e-3, 5, 0] } : VIEW);
    planFrame(plan, store, at, view());
    plan.commit();
    report(plan, store, at, count ? sunGrid(plan, store.sliceOf(0), count) : []);
    planFrame(plan, store, ++at, view());
    plan.commit();
    at++;
    await follow();
  };
  if (sized) {
    await ask(0);
    for (const list of [said, gpu.passes, gpu.copies, gpu.moves]) list.length = 0;
  }
  /** The first frame the tests' own reports may take. */
  const base = at;
  return { rt, lights, gpu, limit, said, ask, follow, base, texture: () => texture };
}
