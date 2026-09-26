// The engine's particle step (#420), actually run in Chromium WebGPU: the committed WGSL compiles,
// and one step of a pool ten kilometres from the world origin moves a newborn particle by its
// 0.4 mm drift, leaves one born dead and a slot nobody emitted into as they are; a 60 s life dies
// after 60 s of 144 Hz steps and ages no more (#759). The words are the engine's: the pool stages
// the records, `createStepWords` writes the uniform; only this proof reads the state back.
//
// node --experimental-strip-types tests/browser/probes/particles-step-gpu.ts
import assert from 'node:assert/strict';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { ParticlePool } from '../../../packages/sdk-core/src/fluids/particles.ts';
import * as step from '../../../packages/sdk-browser/src/particles/webgpuParticles.ts';

type Args = { shader: string; words: number[][]; staged: number[]; bytes: number; groups: number };

/** Run in the page: the step's three bindings, one dispatch of `words[0]`, then 62 s of `words[1]`,
 *  the state read back after each. */
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
  device.queue.writeBuffer(records, 0, new Float32Array(staged));
  const entries = [uniform, records, state].map((b, binding) => ({
    binding,
    resource: { buffer: b },
  }));
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const images: number[][] = [];
  for (const [n, steps] of [1, 62 * 144 - 1].entries()) {
    device.queue.writeBuffer(uniform, 0, new Uint32Array(words[n]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    for (let d = 0; d < steps; d++) pass.dispatchWorkgroups(groups);
    pass.end();
    encoder.copyBufferToBuffer(state, 0, read, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    images.push(Array.from(new Float32Array(read.getMappedRange(), 0, 32)));
    read.unmap();
  }
  return { adaptateur: (await appareil.fermer()).court, images, erreurs };
}

const far = 10_000,
  dt = 1 / 144,
  pool = new ParticlePool({ capacity: 100, emitPerFrame: 4, origin: [far, 0, far] });
pool.emit(far + 0.5, 2, far, 0.0576, 1, 0, 4); // drifts 0.4 mm along x in one step
pool.emit(far, 3, far, 5, 5, 5, 0); // born dead: kept as staged, never moved
pool.emit(far, 0, far, 0, 1, 0, 60); // a 60 s life
const words = step.createStepWords();
const stepped = [0, 1].map(
  () => (pool.advance(dt), words.write(pool, pool.flush()), [...words.uints]),
);
const resultat = await dansPageWebgpu(executer, {
  shader: step.PARTICLES_WGSL,
  words: stepped,
  staged: Array.from(pool.staging),
  bytes: pool.capacity * 32,
  groups: Math.ceil(pool.capacity / step.PARTICLE_WORKGROUP),
});
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual([resultat.compilation ?? [], resultat.erreurs], [[], []]);
const [particles, dead] = resultat.images!,
  [x, y, , age] = particles;
assert.ok(Math.abs(x - (0.5 + 0.0576 * dt)) < 1e-6 && x > 0.5, `drifted 0.4 mm: x = ${x}`);
assert.ok(y > 2 && age === Math.fround(dt), 'rose, and aged by the step');
assert.deepEqual(particles.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged');
assert.deepEqual(particles.slice(24, 32), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched');
const [, , , died, , , , lifetime] = dead.slice(16, 24);
assert.ok(died >= lifetime && died < lifetime + 0.02, `died at 60 s, aged no more: ${died}`);
console.log('OK: the particle step actually run — see particles-step-gpu.ts');
