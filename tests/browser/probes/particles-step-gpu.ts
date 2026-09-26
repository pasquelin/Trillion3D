// The engine's particle step (#420), actually run in Chromium WebGPU: the committed WGSL
// (`PARTICLES_WGSL`) compiles, and one step of a small pool ten kilometres from the world origin
// moves a newborn particle by its sub-millimetre drift, leaves one born dead and a slot nobody
// emitted into as they are. The words are the engine's own: the pool stages the records, the
// step writes the uniform (`writeStepWords`); only this proof reads the state back.
//
// node --experimental-strip-types tests/browser/probes/particles-step-gpu.ts
import assert from 'node:assert/strict';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts';
import {
  PARTICLES_WGSL,
  PARTICLE_WORKGROUP,
  createStepWords,
  writeStepWords,
} from '../../../packages/sdk-browser/src/particles/webgpuParticles.ts';

type Args = { shader: string; step: number[]; staged: number[]; capacity: number; groups: number };

/** Run in the page: the three bindings of the step, one dispatch, the state read back. */
async function executer({ shader, step, staged, capacity, groups }: Args) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const made = (data: ArrayBufferView<ArrayBuffer> | number, usage: number) => {
    const size = typeof data === 'number' ? data : data.byteLength;
    const buffer = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
    if (typeof data !== 'number') device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  };
  const uniform = made(new Uint32Array(step), GPUBufferUsage.UNIFORM),
    records = made(new Float32Array(staged), GPUBufferUsage.STORAGE),
    state = made(capacity * 32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
    read = made(capacity * 32, GPUBufferUsage.MAP_READ);
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [uniform, records, state].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(groups);
  pass.end();
  encoder.copyBufferToBuffer(state, 0, read, 0, capacity * 32);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const particles = Array.from(new Float32Array(read.getMappedRange()).subarray(0, 24));
  read.unmap();
  const info = await appareil.fermer();
  return { adaptateur: info.court, particles, erreurs };
}

const far = 10_000,
  dt = 1 / 60,
  pool = new ParticlePool({ capacity: 100, emitPerFrame: 4, origin: [far, 0, far] });
pool.emit(far + 0.5, 2, far, 0.024, 1, 0, 4); // drifts 0.4 mm along x in one step
pool.emit(far, 3, far, 5, 5, 5, 0); // born dead: kept as staged, never moved
pool.advance(dt);
const words = createStepWords();
writeStepWords(words, pool, pool.flush());
const resultat = await dansPageWebgpu(
  executer,
  {
    shader: PARTICLES_WGSL,
    step: Array.from(words.uints),
    staged: Array.from(pool.staging),
    capacity: pool.capacity,
    groups: Math.ceil(pool.capacity / PARTICLE_WORKGROUP),
  },
  { titre: 'Trillion3D particle step' },
);
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual(resultat.compilation ?? [], []);
assert.deepEqual(resultat.erreurs, []);
const [x, y, , age] = resultat.particles!;
assert.ok(x > 0.5, `the newborn drifted from 0.5 m, the origin's frame: x = ${x}`);
assert.ok(Math.abs(x - (0.5 + 0.024 * dt)) < 1e-6, `by 0.4 mm: x = ${x}`);
assert.ok(y > 2, 'and rose, gravity taken off its speed');
assert.equal(age, Math.fround(dt), 'its age is the step');
assert.deepEqual(
  resultat.particles!.slice(8, 16),
  [0, 3, 0, 0, 5, 5, 5, 0],
  'born dead: as staged',
);
assert.deepEqual(resultat.particles!.slice(16, 24), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted');
console.log('OK: the particle step actually run — see particles-step-gpu.ts');
