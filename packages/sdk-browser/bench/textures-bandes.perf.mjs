// Transfert d'une bande de lignes vers une couche d'atlas.
import { textureJobFor, previewLevelJobs } from '../webgpuAtlasJobs.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import {
  bandes,
  pixels,
  recordingDevice,
  referenceWriteRows,
} from './oracles/h3AtlasJobsOracle.ts';

const alea = graine(3113);

function cas(nom, width, height, bande, mesure = true) {
  const octets = pixels(width, height, alea);
  return {
    nom,
    taille: octets.length,
    mesure,
    entree: { width, height, bande, octets, decoupe: bandes(height, bande) },
  };
}

function avant(e) {
  const { device, calls } = recordingDevice();
  const upload = referenceWriteRows(device, {}, 0, 1, e.octets, e.width);
  for (const [row, count] of e.decoupe) upload(row, count);
  return calls;
}

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

const casAtlas = [
  cas('1024×1024 en bandes de 16', 1024, 1024, 16),
  cas('512×512 en bandes de 4', 512, 512, 4),
  cas('128×128 en bandes de 64', 128, 128, 64),
];

const resUpload = await mesure({
  nom: 'transfert atlas par bandes',
  fichier: 'packages/sdk-browser/webgpuAtlasJobs.ts',
  cas: casAtlas,
  calcul: apres,
  attendu: avant,
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  nom: 'previewLevelJobs extremes',
  calcul: () =>
    previewLevelJobs({
      device: {},
      texture: {},
      place: { slot: 1, classIndex: 0, layer: 1 },
      preview: { width: 64, height: 64, firstLevel: 0, levels: [new Uint8Array(64 * 64 * 4)] },
    }),
  extremes: [{ nom: '64x64', entree: null }],
});

rapport(
  'textures-bandes',
  [resUpload],
  'H3-1 : les bandes d’atlas émettent les mêmes commandes de copie',
);
