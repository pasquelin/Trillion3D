// H3-1 : le transfert d'une bande de lignes vers une couche d'atlas. Avant le lot, chaque bande
// était recopiée hors des pixels entiers par `slice()` : un niveau transféré en N bandes recopiait
// donc une fois de plus tous ses octets avant de les remettre à l'appareil. Après, les pixels
// entiers partent tels quels et `dataLayout.offset` désigne le premier octet de la bande.
//
// L'égalité prouvée ici est celle du transfert vu du GPU : destination, niveau de mip, gabarit de
// lignes, taille de la région et, octet par octet, les texels réellement couverts. L'appareil de
// banc refait au passage la validation de la spécification — assez d'octets à partir de `offset`.
import { join } from 'node:path';
import { textureJobFor, previewLevelJobs } from '../webgpuAtlasJobs.ts';
import { RACINE, compare, graine, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import {
  bandes,
  pixels,
  recordingDevice,
  referenceWriteRows,
} from './oracles/h3AtlasJobsOracle.ts';

const alea = graine(3113);

/** Un cas : un niveau de `width × height` transféré en bandes de `bande` lignes. */
function cas(nom, width, height, bande, mesure = true) {
  const octets = pixels(width, height, alea);
  return {
    nom,
    taille: octets.length,
    mesure,
    entree: { width, height, bande, octets, decoupe: bandes(height, bande) },
  };
}

/** Le chemin d'avant : `writeRows` recopié tel quel, piloté bande par bande. */
function avant(e) {
  const { device, calls } = recordingDevice();
  const upload = referenceWriteRows(device, {}, 0, 1, e.octets, e.width);
  for (const [row, count] of e.decoupe) upload(row, count);
  return calls;
}

/** Le chemin livré : le même découpage, à travers l'entrée publique qui construit le transfert. */
function apres(e) {
  const { device, calls } = recordingDevice();
  const { job } = textureJobFor({
    device,
    texture: {},
    rgba: { data: e.octets, width: e.width, height: e.height },
    map: {},
    place: { slot: 1, classIndex: 0, layer: 1 },
    kind: 'color',
    atlas: [e.width, e.height],
    errorCode: 'H3_SANS_OBJET',
  });
  for (const [row, count] of e.decoupe) job.uploadRows(row, count);
  return calls;
}

/** Les niveaux progressifs d'un aperçu passent par le même `writeRows` : ils entrent au banc aussi. */
function apercu(width, height, firstLevel) {
  const levels = [];
  for (let level = firstLevel; ; level++) {
    const [w, h] = [Math.max(1, width >> level), Math.max(1, height >> level)];
    levels.push(pixels(w, h, alea));
    if (w === 1 && h === 1) break;
  }
  return { width, height, firstLevel, levels };
}

const PREVIEW = apercu(256, 128, 2);

function avantApercu(preview) {
  const { device, calls } = recordingDevice();
  for (let index = preview.levels.length - 1; index >= 0; index--) {
    const level = preview.firstLevel + index;
    const width = Math.max(1, preview.width >> level);
    const height = Math.max(1, preview.height >> level);
    const upload = referenceWriteRows(device, {}, level, 3, preview.levels[index], width);
    for (const [row, count] of bandes(height, 3)) upload(row, count);
  }
  return calls;
}

function apresApercu(preview) {
  const { device, calls } = recordingDevice();
  const jobs = previewLevelJobs({
    device,
    texture: {},
    place: { slot: 3, classIndex: 0, layer: 3 },
    preview: { ...preview, texture: 0, image: 0, sourceKind: 0, sourceBufferView: -1, sha256: '' },
  });
  for (const job of jobs)
    for (const [row, count] of bandes(job.rows, 3)) job.uploadRows(row, count);
  return calls;
}

const lignes = [
  await compare({
    calcul: 'H3-1 bandes d’un niveau vers sa couche d’atlas',
    fichier: 'packages/sdk-browser/webgpuAtlasJobs.ts',
    cas: [
      cas('2048×2048, bandes de 64 lignes', 2048, 2048, 64),
      cas('1024×1024, bandes de 17 lignes', 1024, 1024, 17),
      cas('512×333, ligne par ligne', 512, 333, 1),
      cas('7×5, une seule bande', 7, 5, 5, false),
      cas('1×1', 1, 1, 1, false),
      cas('3×2, bande plus large que le reste', 3, 2, 8, false),
    ],
    reference: avant,
    optimisee: apres,
    options: { tours: 30, budgetMs: 3000, alterne: true },
  }),
  await compare({
    calcul: 'H3-1 niveaux progressifs d’un aperçu',
    fichier: 'packages/sdk-browser/webgpuAtlasJobs.ts',
    cas: [{ nom: '256×128 à partir du niveau 2', entree: PREVIEW, taille: 256 * 128 * 4 }],
    reference: avantApercu,
    optimisee: apresApercu,
    options: { tours: 60, budgetMs: 2000, alterne: true },
  }),
];

verifieEtDepose(
  'textures-h3',
  'H3-1 remet au GPU exactement les mêmes octets, au même endroit',
  lignes,
  join(RACINE, '.mesure', 'calculs-h3'),
);
