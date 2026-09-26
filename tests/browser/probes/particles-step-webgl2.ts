// The engine's WebGL2 particle step (#759) run in Chromium by `particlesStepWebglPage.ts`, the
// only reader of the state: the GLSL compiles, two images 10 km out move a newborn 1 mm each, one
// born dead and a slot never emitted into stay put, a 60 s life at 144 Hz dies at 60 s.
//
//   node tests/browser/probes/particles-step-webgl2.ts
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import type { executer } from './particlesStepWebglPage.ts';

declare global {
  var particulesWebgl: { executer: typeof executer };
}

const ici = dirname(fileURLToPath(import.meta.url));
const script = await empaquetePage(resolve(ici, 'particlesStepWebglPage.ts'), 'particulesWebgl');
const erreursPage: string[] = [];
const resultat = await dansPageWebgpu(() => globalThis.particulesWebgl.executer(), null, {
  titre: 'Trillion3D WebGL2 particles',
  script,
  erreursPage,
});
console.log(JSON.stringify(resultat, null, 2));
assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
assert.deepEqual([resultat.erreurs, erreursPage], [[], []]);
const [first, second] = resultat.images!;
const within = (x: number, expected: number) => Math.abs(x - expected) <= 1e-6;
assert.ok(within(first[0], 0.251) && within(second[0], 0.252), `x: ${first[0]}, ${second[0]}`);
assert.ok(second[1] > first[1] && first[1] > 0, 'rose, from the emitter');
assert.deepEqual([first[3], second[3]], [1 / 64, 2 / 64], 'aged by each step');
assert.deepEqual(second.slice(8, 16), [0, 3, 0, 0, 5, 5, 5, 0], 'born dead: as staged');
assert.deepEqual(second.slice(16, 24), [0, 0, 0, 0, 0, 0, 0, 0], 'never emitted: untouched');
const { steps, particle } = resultat.dead!,
  [, y, , age, , , , lifetime] = particle;
assert.ok(age >= lifetime && age < lifetime + 0.02, `died at 60 s: age ${age}`);
assert.ok(steps / 144 > age + 3 / 144, `stepped on past its death: ${steps} steps`);
assert.ok(Math.abs(y - age) < 1e-3, `stayed where it died: y ${y}, age ${age}`);
console.log('OK: the WebGL2 particle step actually run — see particles-step-webgl2.ts');
