// Preuve par le rendu réel : l'antialiasing temporel adoucit les bords et rien d'autre.
//
// Un carreau rouge tourné sur un fond bleu, rendu par le vrai moteur WebGPU. Sans l'option, l'image
// est celle d'avant le lot. Avec, le moteur rend un plein cycle d'images immobiles avant de tenir
// l'image ; l'image tenue ne diffère de l'image sans accumulation qu'à deux pixels d'un bord — la
// portée de la gigue et du filtre —, l'intérieur des surfaces reste identique, deux exécutions
// donnent la même image au bit près, et un carreau déplacé ne laisse aucun fantôme là où il était.
//
//   node --experimental-strip-types test/browser/antialiasing-temporel.browser.mjs
import assert from 'node:assert/strict';
import { preuveDansLaPage, preuveSaine } from '../appui/preuvePageMoteur.mjs';
import { estRouge } from '../appui/preuveSceneCommune.mjs';

const resultat = await preuveDansLaPage(
  'antialiasingTemporelPage.mjs',
  'antialiasingTemporel',
  'Antialiasing temporel : bords, tenue, témoin A/A, déplacement',
);
preuveSaine(resultat);
const [largeur, hauteur] = resultat.viewport;

/** Portée de l'accumulation autour d'un bord, en pixels : une demi-gigue et le filtre 3×3 de
 *  l'image courante atteignent un pixel et demi, donc deux pixels entiers. */
const PORTEE = 2;

/** Vrai quand, dans `pixels`, un pixel à moins de `PORTEE` de `(x, y)` a une autre couleur : un bord. */
function auBord(pixels, x, y) {
  const i = (y * largeur + x) * 4;
  for (let dy = -PORTEE; dy <= PORTEE; dy++)
    for (let dx = -PORTEE; dx <= PORTEE; dx++) {
      const px = x + dx,
        py = y + dy;
      if (px < 0 || py < 0 || px >= largeur || py >= hauteur) continue;
      const j = (py * largeur + px) * 4;
      if (
        pixels[i] !== pixels[j] ||
        pixels[i + 1] !== pixels[j + 1] ||
        pixels[i + 2] !== pixels[j + 2]
      )
        return true;
    }
  return false;
}

/** Les pixels où `a` et `b` diffèrent de plus de `tolerance` par canal, classés bord / intérieur
 *  d'après `b`, l'image sans accumulation. */
function ecarts(a, b, tolerance) {
  let bords = 0,
    interieur = 0,
    max = 0;
  for (let y = 0; y < hauteur; y++)
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
      max = Math.max(max, d);
      if (d <= tolerance) continue;
      if (auBord(b, x, y)) bords++;
      else interieur++;
    }
  return { bords, interieur, max };
}

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

assert.equal(sans.capacites?.temporalAntialiasing, false, "sans l'option, rien n'est gréé");
assert.equal(avec.capacites?.temporalAntialiasing, true, "avec l'option, la passe est gréée");
assert.equal(avec.capacites?.motionVectors, 'derived');
assert.ok(
  !avec.capacites?.unsupported?.includes('temporal antialiasing'),
  'la capacité doit quitter la liste des non supportées',
);

for (const [nom, execution] of [
  ['sans', sans],
  ['avec', avec],
  ['témoin', temoin],
]) {
  assert.ok(execution.arret.tenue, `${nom} : l'image n'a jamais été tenue à l'arrêt`);
  assert.ok(execution.deplacement.tenue, `${nom} : l'image n'a jamais été tenue après déplacement`);
  // L'image tenue est celle qui vient d'être rendue, réaffichée telle quelle.
  assert.deepEqual(execution.arret.tenue, execution.arret.rendue, `${nom} : tenue ≠ rendue`);
}
// Un plein cycle d'images immobiles précède la tenue avec accumulation ; sans, elle vient aussitôt.
assert.ok(sans.arret.rendues <= 4, `sans accumulation, tenue après ${sans.arret.rendues} images`);
assert.ok(
  avec.arret.rendues >= 16 && avec.arret.rendues <= 24,
  `avec accumulation, tenue après ${avec.arret.rendues} images ; un plein cycle est attendu`,
);

// Témoin A/A : deux exécutions, la même image au bit près.
assert.deepEqual(
  temoin.arret.tenue,
  avec.arret.tenue,
  "deux exécutions identiques diffèrent à l'arrêt",
);
assert.deepEqual(
  temoin.deplacement.tenue,
  avec.deplacement.tenue,
  'deux exécutions identiques diffèrent après déplacement',
);

// Avec contre sans : les bords changent, l'intérieur non.
for (const [etape, cle] of [
  ['arrêt', 'arret'],
  ['déplacement', 'deplacement'],
]) {
  const e = ecarts(avec[cle].tenue, sans[cle].tenue, 2);
  console.log(
    `${etape} : ${e.bords} pixels de bord changés, ${e.interieur} intérieurs, max ${e.max}`,
  );
  assert.ok(e.bords > 0, `${etape} : l'accumulation devrait changer des pixels de bord`);
  assert.equal(e.interieur, 0, `${etape} : ${e.interieur} pixels intérieurs changés de plus de 2`);
}

// Reprojection : sous un panoramique, l'historique doit rester lisible. S'il était reprojeté de
// travers, le bornage le rejetterait et l'image en mouvement retomberait sur la seule image
// courante, aux bords durs ; on compte donc les pixels de bord intermédiaires — ni rouge ni fond —
// pendant le mouvement, et on les compare à ceux de l'image convergée à l'arrêt.
{
  const intermediaires = (pixels) => {
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
  console.log(
    `bords intermédiaires : repos ${repos}, panoramique ${mouvement}, sans accumulation ${dur}`,
  );
  assert.ok(repos > 0, "aucun bord intermédiaire à l'arrêt : l'accumulation n'a rien lissé");
  assert.ok(
    mouvement >= 0.7 * repos,
    `sous panoramique, ${mouvement} bords intermédiaires contre ${repos} à l'arrêt : l'historique est rejeté`,
  );
}

// Aucun fantôme : là où le carreau était avant le déplacement et n'est plus, les deux images du
// déplacement — avec et sans accumulation — montrent le fond, à 2 par canal près.
{
  let fantomes = 0;
  const avant = sans.arret.tenue,
    apres = sans.deplacement.tenue,
    accumulee = avec.deplacement.tenue;
  for (let y = 1; y < hauteur - 1; y++)
    for (let x = 1; x < largeur - 1; x++) {
      const i = (y * largeur + x) * 4;
      // Le rouge au sens large de `redCount` : un pixel de bord compte comme carreau ici, pour que
      // toute la zone libérée soit examinée ; le compte des bords intermédiaires, lui, est strict.
      const etaitRouge = estRouge(avant, i),
        estFond = !estRouge(apres, i);
      if (!etaitRouge || !estFond || auBord(apres, x, y)) continue;
      for (let c = 0; c < 3; c++)
        if (Math.abs(accumulee[i + c] - apres[i + c]) > 2) {
          fantomes++;
          break;
        }
    }
  assert.equal(fantomes, 0, `${fantomes} pixels libérés par le déplacement gardent une trace`);
}
