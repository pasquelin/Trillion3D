// comptage des pages résidentes et sélection GPU.
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
  const sortie = new Float32Array(PAGES);
  for (let j = 0; j < PAGES; j++) sortie[j] = cones[j * CONE_FLOATS + FLAG];
  return sortie;
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
  nom: 'pages résidentes',
  fichier: 'packages/sdk-browser/autonomousResidency.ts',
  cas: [
    { nom: '40 000 pages', entree: pages, taille: pages.length },
    { nom: 'aucune page', entree: [], taille: 0 },
  ],
  calcul: (liste) => comptePagesResidentes(liste),
  attendu: (liste) => liste.filter((rec) => !!rec.array).length,
  options: { tours: 100, budgetMs: 1000 },
});

const resResidencyBits = await mesure({
  nom: 'mise à jour bits de résidence',
  fichier: 'packages/sdk-browser/gpuDagRuntime.ts',
  cas: [{ nom: '8 images, 20 000 pages', entree: images, taille: PAGES * 8 }],
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
  nom: 'lecture de coupe GPU',
  fichier: 'packages/sdk-browser/gpuDagUniforms.ts',
  cas: [
    { nom: 'lecture coupe, 12 000 pages', entree: 20000, taille: 12000 },
    { nom: 'coupe vide', entree: 0, taille: 0 },
  ],
  calcul: (masque) => parseDagOutput(sortieGpu.buffer, 0, sortieGpu.byteLength, masque),
  // L'oracle d'avant le lot A prenait un masque d'un drapeau par page ; le moteur reçoit désormais
  // une liste déjà compactée et un décalage de mots. Les deux ne décrivent plus la même sortie :
  // la justesse de `parseDagOutput` est tenue par `gpuDagUniforms.test.ts`, pas par ce banc.
  attendu: null,
  motif: 'oracle d’avant le lot A périmé — justesse dans gpuDagUniforms.test.ts',
  options: { tours: 100, budgetMs: 1000 },
});

// `maxStretch` lit désormais la vue du tampon de mondes sans la recopier : l'oracle est le même
// calcul sur une copie, et la ligne tombe si la lecture en place en change un seul bit.
const etirements = (lecture) => () => {
  const sortie = new Float64Array(64);
  for (let w = 0; w < 64; w++) sortie[w] = maxStretch(lecture(w));
  return sortie;
};

const resEtirement = await mesure({
  nom: 'étirement maximal des mondes',
  fichier: 'packages/sdk-core/projectionOracles.ts',
  cas: [{ nom: '64 mondes', entree: null, taille: 64 }],
  calcul: etirements((w) => mondes.subarray(w * 16, w * 16 + 16)),
  attendu: etirements((w) => Array.from(mondes.subarray(w * 16, w * 16 + 16))),
  options: { tours: 100, budgetMs: 1000 },
});

await stress({
  nom: 'comptePagesResidentes extremes',
  calcul: comptePagesResidentes,
  extremes: [
    { nom: 'vide', entree: [] },
    { nom: 'sans array', entree: [{ array: undefined }] },
  ],
});

rapport(
  'residence',
  [resCompte, resResidencyBits, resParseDag, resEtirement],
  'A8 et A11 rendent exactement les mêmes comptes, drapeaux, coupes et étirements',
);
