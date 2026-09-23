// Proof by real rendering: temporal antialiasing softens edges and nothing else.
//
// A red tile rotated on a blue background, rendered by the real WebGPU engine. Without
// the option, the image is the one from before the batch. With it, the engine renders a
// full cycle of still frames before holding; the held image differs from the image
// without accumulation only at two pixels of an edge — the reach of jitter and the
// filter —, surface interiors stay identical, two runs give the same image to the bit,
// and a moved tile leaves no ghost where it was.
//
//   node --experimental-strip-types tests/browser/renders/antialiasing-temporel.browser.ts
import assert from 'node:assert/strict';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/preuvePageMoteur.ts';
import { estRouge } from '../support/preuveSceneImage.ts';
import { auBord, ecarts } from './antialiasingEcarts.ts';

interface Etape {
  rendue: number[];
  tenue: number[];
  rendues: number;
}

interface Capacites {
  temporalAntialiasing?: boolean;
  motionVectors?: string;
  unsupported?: string[];
}

interface Execution {
  arret: Etape;
  panoramique: number[];
  deplacement: Etape;
  capacites: Capacites | null;
}

interface Resultat extends ResultatPagePreuve {
  viewport: [number, number];
  sans: Execution;
  avec: Execution;
  temoin: Execution;
  adaptateur?: string;
}

const resultat = (await preuveDansLaPage(
  'antialiasingTemporelPage.ts',
  'antialiasingTemporel',
  'Temporal antialiasing: edges, hold, A/A witness, motion',
)) as Resultat;
preuveSaine(resultat);
const [largeur, hauteur] = resultat.viewport;

const { sans, avec, temoin } = resultat;
console.log(
  JSON.stringify(
    {
      adaptateur: resultat.adaptateur,
      rendues: {
        sans: [sans.arret.rendues, sans.deplacement.rendues],
        avec: [avec.arret.rendues, avec.deplacement.rendues],
      },
      capacites: { sans: sans.capacites, avec: avec.capacites },
    },
    null,
    2,
  ),
);

assert.equal(sans.capacites?.temporalAntialiasing, false, 'without the option, nothing is wired');
assert.equal(avec.capacites?.temporalAntialiasing, true, 'with the option, the pass is wired');
assert.equal(avec.capacites?.motionVectors, 'derived');
assert.ok(
  !avec.capacites?.unsupported?.includes('temporal antialiasing'),
  'the capability must leave the unsupported list',
);

for (const [nom, execution] of [
  ['without', sans],
  ['with', avec],
  ['witness', temoin],
] as const) {
  assert.ok(execution.arret.tenue, `${nom}: the image was never held while still`);
  assert.ok(execution.deplacement.tenue, `${nom}: the image was never held after motion`);
  // The held image is the one just rendered, redisplayed as-is.
  assert.deepEqual(execution.arret.tenue, execution.arret.rendue, `${nom}: held ≠ rendered`);
}
// A full cycle of still frames precedes the hold with accumulation; without, it comes at once.
assert.ok(sans.arret.rendues <= 4, `without accumulation, held after ${sans.arret.rendues} frames`);
assert.ok(
  avec.arret.rendues >= 16 && avec.arret.rendues <= 24,
  `with accumulation, held after ${avec.arret.rendues} frames; a full cycle is expected`,
);

// A/A witness: two runs, the same image to the bit.
assert.deepEqual(temoin.arret.tenue, avec.arret.tenue, 'two identical runs differ while still');
assert.deepEqual(
  temoin.deplacement.tenue,
  avec.deplacement.tenue,
  'two identical runs differ after motion',
);

// With versus without: edges change, the interior does not.
for (const [etape, avecEtape, sansEtape] of [
  ['still', avec.arret, sans.arret],
  ['motion', avec.deplacement, sans.deplacement],
] as const) {
  const e = ecarts(avecEtape.tenue, sansEtape.tenue, 2, largeur, hauteur);
  console.log(`${etape}: ${e.bords} edge pixels changed, ${e.interieur} interior, max ${e.max}`);
  assert.ok(e.bords > 0, `${etape}: accumulation should change edge pixels`);
  assert.equal(e.interieur, 0, `${etape}: ${e.interieur} interior pixels changed by more than 2`);
}

// Reprojection: under a pan, history must stay readable. If it were reprojected askew, clamping
// would reject it and the moving image would fall back to the current frame alone, with hard
// edges; so intermediate edge pixels — neither red nor background — are counted during motion
// and compared to those of the still converged image.
{
  const intermediaires = (pixels: number[]) => {
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i],
        b = pixels[i + 2];
      const rouge = r > 200 && b < 80,
        fond = r < 60 && b > 60;
      if (!rouge && !fond) n++;
    }
    return n;
  };
  const repos = intermediaires(avec.arret.tenue),
    mouvement = intermediaires(avec.panoramique),
    dur = intermediaires(sans.panoramique);
  console.log(`intermediate edges: still ${repos}, pan ${mouvement}, without accumulation ${dur}`);
  assert.ok(repos > 0, 'no intermediate edge while still: accumulation smoothed nothing');
  assert.ok(
    mouvement >= 0.7 * repos,
    `under pan, ${mouvement} intermediate edges against ${repos} while still: history is rejected`,
  );
}

// No ghost: where the tile was before the move and no longer is, both motion images —
// with and without accumulation — show the background, to 2 per channel.
{
  let fantomes = 0;
  const avant = sans.arret.tenue,
    apres = sans.deplacement.tenue,
    accumulee = avec.deplacement.tenue;
  for (let y = 1; y < hauteur - 1; y++)
    for (let x = 1; x < largeur - 1; x++) {
      const i = (y * largeur + x) * 4;
      // Red in the broad `redCount` sense: an edge pixel counts as tile here, so the whole
      // freed region is examined; the intermediate-edge count itself is strict.
      const etaitRouge = estRouge(avant, i),
        estFond = !estRouge(apres, i);
      if (!etaitRouge || !estFond || auBord(apres, x, y, largeur, hauteur)) continue;
      for (let c = 0; c < 3; c++)
        if (Math.abs(accumulee[i + c] - apres[i + c]) > 2) {
          fantomes++;
          break;
        }
    }
  assert.equal(fantomes, 0, `${fantomes} pixels freed by the move keep a trace`);
}
