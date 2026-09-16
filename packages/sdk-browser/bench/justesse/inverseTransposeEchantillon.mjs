// Les cas du défaut 6 : quatre cas déterministes nommés, puis un échantillon statistique d'au moins
// 3072 cas sur les axes qui font varier le déterminant — échelle uniforme de 1e-3 à 1e-16, échelle
// non uniforme (témoin exclu par la conformité), grandes coordonnées locales, objet de taille monde
// réaliste, et une réflexion (déterminant négatif) sur la moitié des cas.
import assert from 'node:assert/strict';
import { construireCas } from './inverseTransposeCas.mjs';

// --- Le contre-exemple déterministe -----------------------------------------------------------
// Rotation de 180° autour de X : l'axe local (0,0,1) devient (0,0,-1), exactement la direction de
// la caméra (0,0,-9) depuis l'origine. Les deux triangles sont donc réellement de face après
// rotation. En dessous de s ≈ 2,15e-7 (det = s³ < 1e-20), le seuil absolu gardait l'axe *local*
// (0,0,1) — qui pointe, lui, à l'opposé de la caméra — et rejetait le cluster.
export const CONTRE_EXEMPLE = construireCas({
  s: 1e-8,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});
// Témoin à grande échelle : même géométrie, même rotation, s hors de la zone du garde (det ≫ 1e-20).
export const TEMOIN_GRANDE_ECHELLE = construireCas({
  s: 1e-3,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});
// Témoin sans rotation : même échelle minuscule, mais l'axe local coïncide déjà avec l'axe monde.
// Les deux triangles sont alors réellement dos à la caméra : le rejet est correct, avant comme
// après, et il doit le rester — la correction ne relâche pas le rejet légitime.
export const TEMOIN_SANS_ROTATION = construireCas({
  s: 1e-8,
  kind: 'uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 0,
});
// Témoin non conforme : même rotation et même échelle minuscule, mais échelle non uniforme — la
// conformité (défaut 1) l'exclut avant `inverseTranspose3` ; jamais rejeté par le cône.
export const TEMOIN_NON_CONFORME = construireCas({
  s: 1e-8,
  kind: 'non-uniforme',
  worldSize: 2,
  axis: [1, 0, 0],
  angleDeg: 180,
});

export const DETERMINISTES = [
  ['contreExemple', CONTRE_EXEMPLE],
  ['temoinGrandeEchelle', TEMOIN_GRANDE_ECHELLE],
  ['temoinSansRotation', TEMOIN_SANS_ROTATION],
  ['temoinNonConforme', TEMOIN_NON_CONFORME],
];

// --- L'échantillon statistique -----------------------------------------------------------------
// 1e-3 à 1e-6 sont hors de la bande du seuil absolu (det = s³ ≥ 1e-18) : ils servent de témoin de
// non-régression. 1e-7 à 1e-16 sont dedans ; 1e-12 et 1e-16 vont au-delà du point où s³ lui-même
// devient dénormal en f32, que seule la normalisation de la 3×3 franchit.
export const SCALES = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16];
/** Les échelles où `det = ±s³` reste au-dessus du seuil absolu 1e-20 : le lot n'y change rien. */
export const HORS_BANDE = SCALES.filter((s) => s * s * s >= 1e-20);
const KINDS = ['uniforme', 'non-uniforme'];
const WORLD_SIZES = [1, 4];
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
  [1, -1, 0.5],
];
const ANGLES = Array.from({ length: 12 }, (_, i) => 10 + (i * 160) / 11);

export const echantillon = [];
for (const s of SCALES)
  for (const kind of KINDS)
    for (const worldSize of WORLD_SIZES)
      for (const axis of AXES)
        for (const angleDeg of ANGLES)
          for (const miroir of [false, true])
            echantillon.push(construireCas({ s, kind, worldSize, axis, angleDeg, miroir }));
assert.ok(echantillon.length >= 3072, `échantillon trop petit : ${echantillon.length}`);

export const tousLesCas = [...DETERMINISTES.map(([, c]) => c), ...echantillon];
