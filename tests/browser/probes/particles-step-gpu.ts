// The engine's particle step (#420), actually run in Chromium WebGPU: the committed WGSL compiles,
// and one step of a pool ten kilometres from the world origin moves a newborn particle by its
// 0.4 mm drift, leaves one born dead and a slot nobody emitted into as they are. The words are the
// engine's: the pool stages the records, `createStepWords` writes the uniform; only this proof
// reads the state back.
//
// node --experimental-strip-types tests/browser/probes/particles-step-gpu.ts
import assert from 'node:assert/strict';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts';
import * as step from '../../../packages/sdk-browser/src/particles/webgpuParticles.ts';

type Args = { shader: string; words: number[]; staged: number[]; bytes: number; groups: number };

/** Run in the page: the step's three bindings, one dispatch, the state read back. */
async function executer({ shader, words, staged, bytes, groups }: Args) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module } });
  const { UNIFORM, STORAGE, COPY_DST, COPY_SRC, MAP_READ } = GPUBufferUsage;
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
  const [uniform, records, state, read] = [
    buffer(32, UNIFORM | COPY_DST),
    buffer(staged.length * 4, STORAGE | COPY_DST),
    buffer(bytes, STORAGE | COPY_SRC),
    buffer(bytes, MAP_READ | COPY_DST),
  ];
  device.queue.writeBuffer(uniform, 0, new Uint32Array(words));
  device.queue.writeBuffer(records, 0, new Float32Array(staged));
  const entries = [uniform, records, state].map((b, binding) => ({
    binding,
    resource: { buffer: b },
  }));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
  pass.dispatchWorkgroups(groups);
  pass.end();
  encoder.copyBufferToBuffer(state, 0, read, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const particles = Array.from(new Float32Array(read.getMappedRange(), 0, 24));
  read.unmap();
  return { adaptateur: (await appareil.fermer()).court, particles, erreurs };
}

const far = 10_000,
  dt = 1 / 60,
  pool = new ParticlePool({ capacity: 100, emitPerFrame: 4, origin: [far, 0, far] });
pool.emit(far + 0.5, 2, far, 0.024, 1, 0, 4); // drifts 0.4 mm along x in one step
pool.emit(far, 3, far, 5, 5, 5, 0); // born dead: kept as staged, never moved
pool.advance(dt);
const words = step.createStepWords();
words.write(pool, pool.flush());
const resultat = await dansPageWebgpu(executer, {
  shader: step.PARTICLES_WGSL,
  words: Array.from(words.uints),
  staged: Array.from(pool.staging),
  bytes: pool.capacity * 32,
  groups: Math.ceil(pool.capacity / step.PARTICLE_WORKGROUP),
});
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual([resultat.compilation ?? [], resultat.erreurs], [[], []]);
const particles = resultat.particles!,
  [x, y, , age] = particles;
assert.ok(Math.abs(x - (0.5 + 0.024 * dt)) < 1e-6 && x > 0.5, `drifted 0.4 mm: x = ${x}`);
assert.ok(y > 2 && age === Math.fround(dt), 'rose, and aged by the step');
assert.deepEqual(particles.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged');
assert.deepEqual(particles.slice(16, 24), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched');
console.log('OK: the particle step actually run — see particles-step-gpu.ts');
