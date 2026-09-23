// Proof by real rendering: sampled lighting converges, and a still image is the exact one.
//
// One lit square under eight contract lights of two colours, rendered by the real WebGPU
// engine. At rest, the accumulated image equals the plain one inside the square: every light
// is shaded in full, and two runs give the same image to the bit. Under a sub-pixel camera
// shake every image moves and each pixel shades a drawn subset of its lights: the first
// moving image shows it — it leaves the still image by more than a hundredth of a pixel
// could move it —, and after a few more the history has averaged the draws back to the
// still image, within a declared tolerance.
//
//   node --experimental-strip-types tests/browser/renders/sampled-lighting.browser.ts
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import {
  preuveDansLaPage,
  preuveSaine,
  type ResultatPagePreuve,
} from '../support/enginePageProof.ts';

interface EtapeEclairage {
  tenue: number[];
  rendues: number;
}

interface ExecutionEclairage {
  arret: EtapeEclairage;
  tenues: number;
  premiere: number[];
  derniere: number[];
}

interface Resultat extends ResultatPagePreuve {
  viewport: [number, number];
  lampes: number;
  sans: ExecutionEclairage;
  avec: ExecutionEclairage;
  temoin: ExecutionEclairage;
}

const resultat = (await preuveDansLaPage(
  'sampledLightingPage.ts',
  'eclairageEchantillonne',
  'Sampled lighting: exact at rest, drawn in motion, converged by the history',
)) as Resultat;
preuveSaine(resultat);
const [largeur] = resultat.viewport;
const { sans, avec, temoin } = resultat;

/** The square's interior, three pixels inside its projected edge: the lit surface alone,
 *  away from what jitter and the current image's filter touch. */
const INTERIEUR = [16, 80];

/** Largest channel difference over the interior: its mean per pixel, and its maximum. */
function ecartInterieur(a: number[], b: number[]) {
  let somme = 0,
    max = 0,
    n = 0;
  for (let y = INTERIEUR[0]; y < INTERIEUR[1]; y++)
    for (let x = INTERIEUR[0]; x < INTERIEUR[1]; x++, n++) {
      const i = (y * largeur + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
      somme += d;
      max = Math.max(max, d);
    }
  return { moyenne: somme / n, max };
}

assert.ok(resultat.lampes > LIGHT_SETTINGS.samplesPerPixel, 'the scene must exceed the samples');
for (const [nom, execution] of [
  ['without', sans],
  ['with', avec],
  ['witness', temoin],
] as const) {
  assert.ok(execution.arret.tenue, `${nom}: the image was never held while still`);
  assert.equal(execution.tenues, 0, `${nom}: a shaken image was held`);
}
assert.ok(
  avec.arret.rendues >= 16,
  `with accumulation, held after ${avec.arret.rendues} frames; a full cycle is expected`,
);

// A/A witness: two runs, the same still image to the bit.
assert.deepEqual(temoin.arret.tenue, avec.arret.tenue, 'two identical runs differ while still');

// At rest, with versus without accumulation: the lit interior is the same image — every
// light of the tile is shaded, exactly as without the option.
const repos = ecartInterieur(avec.arret.tenue, sans.arret.tenue);
console.log(`still: mean interior difference ${repos.moyenne.toFixed(2)}, max ${repos.max}`);
assert.ok(repos.max <= 1, `still: an interior pixel differs by ${repos.max} from the plain image`);

// In motion, the first image draws a subset of the lights in every pixel: the accumulated
// image moves away from the still one by more than a hundredth of a pixel could move it.
const premiere = ecartInterieur(avec.premiere, avec.arret.tenue);
console.log(`first moving image: mean ${premiere.moyenne.toFixed(2)}, max ${premiere.max}`);
assert.ok(premiere.max >= 3, 'the moving image should shade a drawn subset of the lights');

// After the shake, the history has averaged the draws: the interior is back on the still
// image within four levels on average and thirty-two at worst — the declared grain of a
// moving image, on a surface built so that two draws differ as much as they can, in chroma.
const derniere = ecartInterieur(avec.derniere, avec.arret.tenue);
console.log(`after the shake: mean ${derniere.moyenne.toFixed(2)}, max ${derniere.max}`);
assert.ok(
  derniere.moyenne <= 4,
  `mean interior difference ${derniere.moyenne.toFixed(2)} exceeds 4`,
);
assert.ok(derniere.max <= 32, `an interior pixel differs by ${derniere.max}, more than 32`);
