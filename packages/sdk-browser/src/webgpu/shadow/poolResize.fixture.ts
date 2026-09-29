// The session the shadow pool resize tests run (#1208): a sun, a pool sized at a first frame, a
// device that refuses what a limit says and records the page moves it is handed.
import { shadowPoolSide } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { asWebgpuDevice } from '../../../../../tests/kit/gpu/webgpuDevice.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { sizeShadowPool } from './poolSize.ts';
import { followShadowView } from './poolResize.ts';
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

/** A session with a sun, its pool sized at `viewport`; its atlas records what it takes. */
export async function session(viewport: [number, number], transmittance = false) {
  installGpuGlobals();
  const limit = { bytes: Infinity },
    gpu = device(limit),
    lights = createWebgpuLightState(shadowPoolSide(300, 150)),
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
    setup: { viewport },
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
  /** A frame at `width × height`: the resize it asks, answered. */
  const frame = async (width: number, height: number) => {
    viewport[0] = width;
    viewport[1] = height;
    followShadowView(rt);
    await lights.shadowGrant?.done;
  };
  return { rt, lights, gpu, limit, said, frame, texture: () => texture };
}
