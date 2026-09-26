/**
 * CPU models of the two particle steps (#759), for the fast tests: each runs its shader's
 * arithmetic, in 32-bit floats, on exactly what its step handed the GPU — the WebGPU step's
 * words and records, the WebGL2 step's uniforms, texels and viewport — and keeps its state as
 * the GPU would: 32-bit storage, or two half-float targets in turn. What the GPU itself does
 * is the measurer's (`tests/browser/probes/particles-step-*.ts`).
 */
import { PARTICLE_FLOATS } from '../../../sdk-core/src/fluids/particles.ts';
import { fromHalf, toHalf } from '../../../sdk-core/src/lighting/ltcTable.ts';
import { written, type FakeWrite } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { PARTICLE_WORKGROUP } from './webgpuParticles.ts';
import { PARTICLE_ROW } from './webglParticles.ts';

type Store = (value: number) => number;
type Ring = { first: number; count: number; capacity: number };
const f = Math.fround;
/** The nearest half float, what a half-float target keeps. */
const f16 = (x: number) => fromHalf(toHalf(x));

/** Both shaders' body for one particle: its eight words from `from`, stored in `into`. */
function move(from: ArrayLike<number>, at: number, a: ArrayLike<number>, dt: number) {
  const p = Array.from({ length: PARTICLE_FLOATS }, (_, k) => from[at + k]),
    step = f(dt);
  if (p[3] < p[7]) {
    for (let c = 0; c < 3; c++) {
      p[4 + c] = f(p[4 + c] + f(a[c] * step));
      p[c] = f(p[c] + f(p[4 + c] * step));
    }
    p[3] = f(p[3] + step);
  }
  return p;
}

/** Slot `i`'s record this image, or -1: the ring's `k < count`. */
const bornAt = (i: number, { first, count, capacity }: Ring) => {
  const k = (i + capacity - first) % capacity;
  return k < count ? k : -1;
};

/** The WebGPU step as `PARTICLES_WGSL` runs it: one invocation per dispatched slot. */
export function webgpuModel(capacity: number) {
  const state = new Float32Array(capacity * PARTICLE_FLOATS);
  return {
    particle: (i: number) => [...state.subarray(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS)],
    /** One dispatch of `groups` workgroups, handed the `words` and `records` writes. */
    step(words: FakeWrite, records: FakeWrite | undefined, groups: number) {
      const bytes = new Uint8Array(written(words)).buffer,
        floats = new Float32Array(bytes),
        [first, count, size] = new Uint32Array(bytes, 16, 3);
      const staged = records ? written(records) : new Float32Array();
      for (let i = 0; i < Math.min(size, groups * PARTICLE_WORKGROUP); i++) {
        const k = bornAt(i, { first, count, capacity: size });
        const p = move(
          k < 0 ? state : staged,
          (k < 0 ? i : k) * PARTICLE_FLOATS,
          floats,
          floats[3],
        );
        state.set(p, i * PARTICLE_FLOATS);
      }
    },
  };
}

/** The WebGL2 step as `PARTICLES_GLSL` runs it: one fragment per texel of the viewport, read
 *  from one half-float target and written, `store`d, to the other. */
export function webglModel(capacity: number, store: Store = f16) {
  const texels = 2 * PARTICLE_ROW,
    size = Math.ceil(capacity / PARTICLE_ROW) * texels * 4;
  let [read, write] = [new Float32Array(size), new Float32Array(size)];
  const staged = new Float32Array(size);
  return {
    particle: (i: number) => [...read.subarray(i * PARTICLE_FLOATS, (i + 1) * PARTICLE_FLOATS)],
    /** One draw, from the calls it made by name: its texel uploads, `uStep` and `uRing`, and
     *  the rows of its viewport. */
    step(of: (name: string) => unknown[][]) {
      const [, ...uStep] = of('uniform4f')[0] as number[],
        [, first, count, ring] = of('uniform3i')[0] as number[],
        rows = (of('viewport').at(-1) as number[])[3];
      for (const [, , x, y, width, height, , , data, from] of of('texSubImage2D') as number[][]) {
        const records = (data as unknown as Float32Array).subarray(from, from + width * height * 4);
        staged.set(records, (y * texels + x) * 4);
      }
      for (let t = 0; t < rows * texels; t++) {
        const i = t >> 1,
          k = i < ring ? bornAt(i, { first, count, capacity: ring }) : -1;
        const p =
          i >= ring ? [] : move(k < 0 ? read : staged, (k < 0 ? i : k) * 8, uStep, uStep[3]);
        for (let c = 0; c < 4; c++) write[t * 4 + c] = store(p[(t & 1) * 4 + c] ?? 0);
      }
      [read, write] = [write, read];
    },
  };
}

/** An encoder that records its compute passes and their dispatches. */
export function computeRecorder() {
  const passes: { label?: string; dispatches: number[] }[] = [];
  const encoder = {
    beginComputePass: ({ label }: GPUComputePassDescriptor) => {
      const pass = { label, dispatches: [] as number[] };
      passes.push(pass);
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups: (x: number) => void pass.dispatches.push(x),
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
  return { encoder, passes };
}
