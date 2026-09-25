// The cut rule run by the WGSL kernel itself, on the synthetic DAG of the rule's tests with pages
// missing (#486): on every frame the pages `dagMask` flags drawn are those the kernel's CPU model
// draws, and they cover each leaf exactly once. Full residency is the witness case; the random
// frames are where a page is missing and the nearest resident ancestor must stand in for it.
//
// node --experimental-strip-types tests/browser/probes/cut-rule-gpu.ts
import assert from 'node:assert/strict';
import { coverFault, ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts';
import {
  oracleBackend,
  stripUniforms,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts';
import { selectionGpu } from './selectionKernelGpu.ts';

const THRESHOLD = 0.1,
  FRAMES = 12;
const dag = ruleDag(256);
const model = oracleBackend(dag, THRESHOLD);
const isRoot = (page: number) => dag.pages[page].group === null;

/** Full residency, then frames with pages removed at random — the roots always stay. */
let seed = 486;
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const frames = Array.from({ length: FRAMES }, (_, frame) => {
  const keep = frame ? 0.3 + 0.6 * next() : 1;
  return Uint8Array.from(dag.pages, (_, page) => (isRoot(page) || next() < keep ? 1 : 0));
});

const gpu = await selectionGpu(
  frames.map((resident, frame) => {
    // One packing per case: residency writes each node's open count into its nodes.
    const { packed, uniforms } = stripUniforms(dag, THRESHOLD);
    return { name: `frame ${frame}`, packed, uniforms, resident };
  }),
);
assert.equal(gpu.indisponible ?? null, null);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);
const resultats = gpu.resultats ?? [];
assert.equal(resultats.length, FRAMES);

const lignes = frames.map((resident, frame) => {
  const lu = resultats[frame];
  const attendu = [...model(resident).drawn].sort((a, b) => a - b);
  return {
    frame,
    absentes: resident.length - resident.reduce((n, v) => n + v, 0),
    dessineesGpu: lu.dessinees.length,
    dessineesModele: attendu.length,
    memes: JSON.stringify(lu.dessinees) === JSON.stringify(attendu),
    trou: coverFault(dag, lu.dessinees),
  };
});
console.log(JSON.stringify({ adaptateur: gpu.adaptateur, lignes }, null, 2));
assert.ok(
  lignes.some((ligne) => ligne.absentes > 0),
  'no frame misses a page: the proof covers nothing',
);
for (const ligne of lignes) {
  assert.ok(ligne.dessineesGpu > 0, `frame ${ligne.frame}: the kernel draws nothing`);
  assert.equal(ligne.trou, -1, `frame ${ligne.frame}: leaf ${ligne.trou} not covered exactly once`);
  assert.ok(ligne.memes, `frame ${ligne.frame}: the kernel and its model draw different pages`);
}
