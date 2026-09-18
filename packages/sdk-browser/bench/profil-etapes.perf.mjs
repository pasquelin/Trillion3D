// la ventilation du profil par étape, faite à chaque image : les bornes processeur déposées sur
// leurs étapes, et les passes de la carte graphique lues par leur étiquette.
import { addCpuSteps, addGpuPasses, directLightTimings } from '../stageMapping.ts';
import { CPU_STEP_NAMES, CPU_STEP_STAGES } from '../webgpuPagesCpuSteps.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import {
  referenceAddCpuSteps,
  referenceDirectLightTimings,
  referenceGpuStages,
} from './oracles/profil-etapes.mjs';

const alea = graine(113);

const NB_BORNES = CPU_STEP_NAMES.length;

const lignes = (images) =>
  Array.from({ length: images }, () => Float64Array.from({ length: NB_BORNES }, () => alea() * 10));

const depose = (ventile) => (rows) => {
  const total = new Map();
  const add = (stage, ms) => total.set(stage, (total.get(stage) ?? 0) + ms);
  for (const row of rows) ventile(row, add);
  return total;
};

const mesureCpu = await mesure({
  nom: 'bornes processeur par étape',
  fichier: 'packages/sdk-browser/stageMapping.ts',
  cas: [
    { nom: `${NB_BORNES} bornes × 200 images`, entree: lignes(200), taille: 200 * NB_BORNES },
    { nom: 'aucune image', entree: [], taille: 0 },
  ],
  calcul: depose((row, add) => addCpuSteps(CPU_STEP_STAGES, row, add)),
  attendu: depose((row, add) => referenceAddCpuSteps(CPU_STEP_STAGES, row, add)),
});

// Un relevé porte des passes connues, une passe inconnue — qui rejoint « geometry » — et, une fois
// sur dix, une durée `null` qui rend son étape non mesurée.
const ETIQUETTES = [
  'WG DAG selection',
  'WG partition',
  'WG HiZ pyramid',
  'WG material surfaces v1',
  'WG shadow atlas v1',
  'WG shadow cull',
  'WG light tiles v1',
  'WG bounce probes v1',
  'WG deferred lighting',
  'WG HDR composition + present',
  'WG passe inconnue',
];
const releve = (passes) => ({
  truncated: false,
  passes: Array.from({ length: passes }, (_, i) => ({
    name: ETIQUETTES[i % ETIQUETTES.length],
    gpuMs: alea() < 0.1 ? null : alea() * 2,
  })),
});
const releves = (n, passes) => Array.from({ length: n }, () => releve(passes));

const mesureGpu = await mesure({
  nom: 'passes carte graphique par étape',
  fichier: 'packages/sdk-browser/stageMapping.ts',
  cas: [
    { nom: '200 relevés de 22 passes', entree: releves(200, 22), taille: 200 * 22 },
    { nom: 'relevé tronqué', entree: [{ truncated: true, passes: [] }], taille: 1 },
    { nom: 'sans relevé', entree: [null], taille: 1 },
  ],
  calcul: depose(addGpuPasses),
  attendu: depose(referenceGpuStages),
});

const mesureEclairage = await mesure({
  nom: "durées de l'éclairage direct",
  fichier: 'packages/sdk-browser/stageMapping.ts',
  cas: [{ nom: '1 000 relevés', entree: releves(1000, 11), taille: 1000 }],
  calcul: (entree) => entree.map(directLightTimings),
  attendu: (entree) => entree.map(referenceDirectLightTimings),
});

await stress({
  nom: 'profil par étape extrême',
  calcul: (sample) => {
    addGpuPasses(sample, () => {});
    directLightTimings(sample);
  },
  extremes: [
    {
      nom: 'gpuMs NaN',
      entree: { truncated: false, passes: [{ name: 'WG partition', gpuMs: NaN }] },
    },
  ],
});

rapport(
  'profil-etapes',
  [mesureCpu, mesureGpu, mesureEclairage],
  'le profil par étape dépose les mêmes durées que sa référence',
);
