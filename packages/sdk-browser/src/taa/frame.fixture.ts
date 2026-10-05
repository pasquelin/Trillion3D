import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { beginTaaFrame, encodeTaaPass, taaRenderMatrix } from './frame.ts';
import { createTaaFrameState } from './frameState.ts';
import { createScaleControl } from '../frame/scaleControl.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { TaaInputs } from './inputs.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

/** The strict minimum of an engine: the fake pass, its inputs, the camera and the revisions. */
export function runtime() {
  const encoded: unknown[] = [];
  const output = { color: {}, share: {} };
  const flags = { flags: true } as unknown as GPUTextureView;
  const temporal = {
    uniform: {} as GPUBuffer,
    motion: {
      buffer: {} as GPUBuffer,
      moved: false,
      updates: [] as boolean[],
      resets: 0,
      update(_eye: ArrayLike<number>, scan: boolean) {
        this.updates.push(scan);
      },
      reset() {
        this.resets++;
      },
    },
    frame: createTaaFrameState(),
    inputs: {} as TaaInputs,
    checkpoint() {},
    replay: () => false,
    encode(_encoder: unknown, inputs: unknown) {
      encoded.push(inputs);
      return output;
    },
  };
  const size = () => [64, 32];
  const rt = {
    gpu: { temporal, temporalWanted: true, depthView: {}, hdrView: {}, cache: { buffer: {} } },
    vis: { visView: { ids: true }, pageTable: { pages: true }, concatPos: {}, concatUv: {} },
    run: { diagnostic: 'beauty', gpuDrawCalls: 0, frame: 0, gate: { revisions: { scene: 1 } } },
    capture: { capturing: false },
    lights: { vsm: { settle: { renderedTotal: 0 } } },
  } as unknown as WebgpuPagesRuntime;
  rt.gpu.surfaces = { views: () => [{}, {}, {}, flags] } as never;
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() });
  Object.assign(rt, { scale: createScaleControl(undefined) });
  const { device, writes } = fakeDevice();
  const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera;
  /** A whole frame: input, render matrix, pass; returns the written uniform, or `null`. */
  const frame = (quiet: boolean, asIs = true) => {
    beginTaaFrame(rt, cam, quiet);
    taaRenderMatrix(rt, cam);
    const before = writes.length;
    encodeTaaPass(rt, device, {} as GPUCommandEncoder, cam, rt.gpu.hdrView!, asIs);
    return writes.length > before ? (writes[writes.length - 1].data as Float32Array) : null;
  };
  return { rt, cam, temporal, encoded, frame, flags };
}
