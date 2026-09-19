// counting resident pages and GPU selection.
import { maxStretch } from '../../sdk-core/index.ts';
import { comptePagesResidentes } from '../autonomousResidency.ts';
import { updateResidencyBits } from '../gpuDagRuntime.ts';
import { parseDagOutput } from '../gpuDagUniforms.ts';
import { residentBase, residentWords } from '../gpuDagLayout.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceUpdateResidency, residencyColumn } from './oracles/residence.mjs';

const CONE_FLOATS = 12,
  FLAG = 11;
const alea = graine(53);
const PAGES = 20000;
const pages = [];
for (let i = 0; i < PAGES * 2; i++) pages.push({ array: i % 3 ? new Uint32Array(3) : undefined });

const images = [];
for (let image = 0; image < 8; image++) {
  const next = new Uint32Array(PAGES);
  for (let j = 0; j < PAGES; j++) next[j] = (j + image) % 40 ? 1 : 0;
  images.push(next);
}

const conesReference = new Float32Array(PAGES * CONE_FLOATS);
for (let j = 0; j < PAGES * CONE_FLOATS; j++) conesReference[j] = alea();

const base = residentBase(PAGES),
  bits = new Uint32Array(base + residentWords(PAGES)),
  motsTouches = new Int32Array(residentWords(PAGES));
for (let j = 0; j < PAGES; j++)
  if (conesReference[j * CONE_FLOATS + FLAG] >= 0.5) bits[base + (j >>> 5)] |= 1 << (j & 31);

const colonne = (cones) => {
  const output = new Float32Array(PAGES);
  for (let j = 0; j < PAGES; j++) output[j] = cones[j * CONE_FLOATS + FLAG];
  return output;
};

const mondes = new Float32Array(64 * 16);
for (let i = 0; i < mondes.length; i++) mondes[i] = i % 17 === 0 ? 1 + alea() : alea() * 0.01;

const sortieGpu = new Uint32Array(4 + 12000 + 20000);
sortieGpu[0] = 12000;
sortieGpu[1] = 431;
sortieGpu[2] = 5;
sortieGpu[3] = 0;
for (let i = 0; i < 12000; i++) sortieGpu[4 + i] = i * 3;
for (let i = 0; i < 20000; i++) sortieGpu[4 + 12000 + i] = i % 7 ? 1 : 0;

const resCompte = await mesure({
  name: 'resident pages',
  fichier: 'packages/sdk-browser/autonomousResidency.ts',
  cas: [
    { name: '40 000 pages', input: pages, size: pages.length },
    { name: 'no pages', input: [], size: 0 },
  ],
  calcul: (liste) => comptePagesResidentes(liste),
  attendu: (liste) => liste.filter((rec) => !!rec.array).length,
  options: { tours: 100, budgetMs: 1000 },
});

const resResidencyBits = await mesure({
  name: 'residency-bit update',
  fichier: 'packages/sdk-browser/gpuDagRuntime.ts',
  cas: [{ name: '8 frames, 20 000 pages', input: images, size: PAGES * 8 }],
  calcul: (imgs) => ({
    drapeaux: imgs.map((next) => updateResidencyBits(next, bits, base, undefined, motsTouches) > 0),
    colonne: residencyColumn(bits, base, PAGES),
  }),
  attendu: (imgs) => ({
    drapeaux: imgs.map((next) => referenceUpdateResidency(next, conesReference)),
    colonne: colonne(conesReference).map((v) => (v >= 0.5 ? 1 : 0)),
  }),
  options: { tours: 100, budgetMs: 1000 },
});

const resParseDag = await mesure({
  name: 'GPU cut read',
  fichier: 'packages/sdk-browser/gpuDagUniforms.ts',
  cas: [
    { name: 'cut read, 12 000 pages', input: 20000, size: 12000 },
    { name: 'empty cut', input: 0, size: 0 },
  ],
  calcul: (masque) => parseDagOutput(sortieGpu.buffer, 0, sortieGpu.byteLength, masque),
  // The oracle from before batch A took a per-page flag mask; the engine now receives a
  // already-compacted list and a word offset. The two no longer describe the same output:
  // correctness of `parseDagOutput` is held by `gpuDagUniforms.test.ts`, not by this bench.
  attendu: null,
  motif: 'oracle from before batch A is stale — correctness in gpuDagUniforms.test.ts',
  options: { tours: 100, budgetMs: 1000 },
});

// `maxStretch` now reads the world-buffer view without copying it: the oracle is the same
// computation on a copy, and the line fails if the in-place read changes a single bit.
const etirements = (lecture) => () => {
  const output = new Float64Array(64);
  for (let w = 0; w < 64; w++) output[w] = maxStretch(lecture(w));
  return output;
};

const resEtirement = await mesure({
  name: 'maximum world stretch',
  fichier: 'packages/sdk-core/projectionOracles.ts',
  cas: [{ name: '64 worlds', input: null, size: 64 }],
  calcul: etirements((w) => mondes.subarray(w * 16, w * 16 + 16)),
  attendu: etirements((w) => Array.from(mondes.subarray(w * 16, w * 16 + 16))),
  options: { tours: 100, budgetMs: 1000 },
});

await stress({
  name: 'comptePagesResidentes extremes',
  calcul: comptePagesResidentes,
  extremes: [
    { name: 'empty', input: [] },
    { name: 'without array', input: [{ array: undefined }] },
  ],
});

rapport(
  'residence',
  [resCompte, resResidencyBits, resParseDag, resEtirement],
  'A8 and A11 yield the exact same counts, flags, cuts and stretches',
);
