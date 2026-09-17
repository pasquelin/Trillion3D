// Les cas sur lesquels `xformNormal` (NORMAL_TRANSFORM_WGSL, standardLighting.ts) est éprouvée :
// ordinaires d'un côté — une pose monde, une normale locale, la normale monde vraie en f64 —,
// singuliers de l'autre, aplatis puis effondrés. La même liste sert au test d'arithmétique sans GPU
// (`packages/sdk-browser/normalTransform.test.ts`) et à l'exécution du nuanceur livré dans Chromium
// (`test/browser/normalTransformArithmetique.browser.mjs`) : le modèle f32 et le shader réel répondent sur
// les MÊMES entrées, sans quoi l'accord entre eux ne voudrait rien dire.
import { construireCas } from './normaleEclairageCas.mjs';

/** s³ = 1e-20 : l'échelle uniforme sous laquelle l'ancien seuil absolu se déclenchait. */
export const SEUIL = Math.cbrt(1e-20);
/** Le décrochage : au-delà, la normale n'est plus celle de la surface tournée. */
export const DECROCHE_DEG = 1e-3;
export { DEG } from './inverseTransposeF32.mjs';

const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
];
const NORMALES = [
  [0, 0, 1],
  [0.6, -0.8, 0],
];
/** De 1e3 à 1e-16, et de part et d'autre du seuil : les cas l'encadrent au lieu de l'éviter. */
const ECHELLES = [1e3, 1, 1e-3, 1e-6, 2.16e-7, 2.154e-7, 1e-7, 1e-8, 1e-12, 1e-16];
const MATIERE = { lumiere: [0.3, 0.8, 0.5, 3], metal: 0.1, rugosite: 0.4 };

export const CAS = ECHELLES.flatMap((s) =>
  ['uniforme', 'anisotrope'].flatMap((kind) =>
    AXES.flatMap((axis) =>
      [37, 90, 180].flatMap((angleDeg) =>
        NORMALES.map((normale) => construireCas({ s, kind, axis, angleDeg, normale, ...MATIERE })),
      ),
    ),
  ),
);

/** Une 4×4 rangée par colonnes, bâtie sur trois colonnes 3D et une translation nulle. */
const pose = (colonnes) => [...colonnes[0], 0, ...colonnes[1], 0, ...colonnes[2], 0, 0, 0, 0, 1];
const ROTATION_MINUSCULE = [
  [1e-8, 0, 0],
  [0, -1e-8, 0],
  [0, 0, -1e-8],
];
const ZERO = [0, 0, 0];
const NORMALE_GARDE = [0.6, -0.8, 0];

/** Un cas singulier : sa pose, sa normale locale, et la normale monde que la convention exige. */
const garde = (nom, colonnes, normale, vraie) => ({
  nom,
  world: pose(colonnes),
  normale,
  vraie,
  degenere: true,
  effondree: vraie === ZERO,
  ...MATIERE,
});

/**
 * LES POSES SINGULIÈRES QUI GARDENT UNE FACE (rang 2). La primitive est écrasée sur un PLAN, ses
 * faces y gardent une aire non nulle, et la normale monde est celle de la face transformée — le
 * produit vectoriel de ses arêtes transformées. Les deux attentes sont calculées à la main ici,
 * sans passer par le noyau.
 *
 *  — `échelle (1,1,0) puis 90° autour de Y` est LE contre-exemple de l'audit. Ry(90°) envoie x sur
 *    −z et z sur x ; composée avec diag(1, 1, 0) elle a pour colonnes (0,0,−1), (0,1,0), (0,0,0).
 *    Le triangle local (0,0,0), (1,0,0), (0,1,0) devient (0,0,0), (0,0,−1), (0,1,0) : arêtes monde
 *    (0,0,−1) et (0,1,0), produit vectoriel (1, 0, 0), aire 0,5 — la face est parfaitement visible
 *    et parfaitement orientée. Sa normale LOCALE est (0,0,1) ; la normale monde attendue est donc
 *    +X. L'ancien repli rendait +Z, la normale locale non tournée, soit un éclairage d'environ 0,09
 *    par canal au lieu de 0,8 ; le chemin CPU, lui, rendait le vecteur nul.
 *  — `colonne nulle` écrase l'axe y : colonnes (1e-8,0,0), (0,0,0), (0,0,−1e-8). Le plan d'arrivée
 *    est XZ, de normale ±Y. La normale locale (0,6, −0,8, 0) est celle des arêtes (0,8; 0,6; 0) et
 *    (0,0,1) ; transformées, elles valent (8e-9, 0, 0) et (0, 0, −1e-8), et leur produit vectoriel
 *    vaut (0, 8e-17, 0) : +Y. La composante −y de la normale locale ne survit pas — sur une face
 *    aplatie toutes les normales de sommets tombent sur la normale de la face, le lissage disparaît
 *    avec le volume, et c'est l'orientation des ARÊTES qui décide du côté.
 */
export const APLATIES = [
  garde(
    'face aplatie : échelle (1,1,0) puis 90° autour de Y',
    [[0, 0, -1], [0, 1, 0], ZERO],
    [0, 0, 1],
    [1, 0, 0],
  ),
  garde(
    'colonne nulle (rang 2, la face garde son aire)',
    [ROTATION_MINUSCULE[0], ZERO, ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    [0, 1, 0],
  ),
];

/**
 * LES POSES QUI EFFONDRENT LA FACE : plus d'aire monde, donc plus de normale, donc pas d'éclairage.
 * L'attente est le vecteur NUL — fini, jamais un NaN qui gagnerait les pixels voisins par les
 * dérivées d'écran, et jamais la normale locale d'une surface qui n'existe plus.
 *
 *  — `3×3 nulle` et `rang 1` effondrent la primitive sur un point ou une droite : l'adjointe y est
 *    nulle d'elle-même, les trois colonnes étant parallèles, tous ses produits vectoriels le sont.
 *  — `coefficient infini` et `coefficient NaN` ne sont pas des poses : la somme des valeurs
 *    absolues n'est pas finie, la 3×3 normalisée ne vaut plus rien, et le noyau met son adjointe à
 *    zéro. Ces deux-là ne devraient jamais atteindre le nuanceur — `assertFiniteTransform` les
 *    refuse au chargement et à `setTransform` — mais le noyau ne le suppose pas.
 */
export const EFFONDREES = [
  garde('3×3 nulle (somme nulle)', [ZERO, ZERO, ZERO], NORMALE_GARDE, ZERO),
  garde(
    'rang 1 (les trois colonnes sur un axe)',
    [
      [1, 0, 0],
      [2, 0, 0],
      [-1, 0, 0],
    ],
    NORMALE_GARDE,
    ZERO,
  ),
  garde(
    'coefficient infini',
    [[Infinity, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    ZERO,
  ),
  garde(
    'coefficient NaN',
    [[NaN, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
    ZERO,
  ),
];

/** Tous les cas singuliers, aplatis puis effondrés : la liste que les preuves exécutent sur GPU. */
export const GARDES = [...APLATIES, ...EFFONDREES];

/**
 * Le témoin de non-gourmandise du garde : minuscule mais régulière, elle doit tourner.
 *
 * `ROTATION_MINUSCULE` est diag(1e-8, −1e-8, −1e-8) : une rotation d'un demi-tour autour de x,
 * d'échelle 1e-8, de déterminant +1e-24. Son inverse-transposée est diag(1e8, −1e8, −1e8), et la
 * normale locale [0,6, −0,8, 0] donne [6e7, 8e7, 0], soit [0,6, 0,8, 0] une fois unitaire. Le
 * demi-tour retourne y et z ; il ne retourne pas x. L'attente portée ici était [−0,6, −0,8, 0],
 * l'OPPOSÉ : le critère d'alors prenait la valeur absolue du produit scalaire, confondait N et −N,
 * et validait cette erreur à zéro degré. Le critère orienté de `verdictNormale` la refuse.
 */
export const REGULIERE_MINUSCULE = {
  nom: 'rotation d’échelle 1e-8 (régulière)',
  world: pose(ROTATION_MINUSCULE),
  normale: NORMALE_GARDE,
  vraie: [0.6, 0.8, 0],
  degenere: false,
  effondree: false,
  ...MATIERE,
};
