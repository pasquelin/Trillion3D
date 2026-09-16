// Les cas sur lesquels `xformNormal` (NORMAL_TRANSFORM_WGSL, standardLighting.ts) est éprouvée :
// ordinaires d'un côté — une pose monde, une normale locale, la normale monde vraie en f64 —,
// dégénérés de l'autre, un par garde du noyau. La même liste sert au test d'arithmétique sans GPU
// (`packages/sdk-browser/normalTransform.test.ts`) et à l'exécution du nuanceur livré dans Chromium
// (`test/normalTransformArithmetique.browser.mjs`) : le modèle f32 et le shader réel répondent sur
// les MÊMES entrées, sans quoi l'accord entre eux ne voudrait rien dire.
import { construireCas } from './normaleEclairageCas.mjs';

/** s³ = 1e-20 : l'échelle uniforme sous laquelle l'ancien seuil absolu se déclenchait. */
export const SEUIL = Math.cbrt(1e-20);
/** Le décrochage : au-delà, la normale n'est plus celle de la surface tournée. */
export const DECROCHE_DEG = 1e-3;
export const DEG = 180 / Math.PI;

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

/**
 * Les cas dégénérés, un par garde : somme des valeurs absolues nulle, déterminant normalisé nul,
 * somme infinie, somme NaN. Le noyau doit rendre le vecteur TEL QUEL — donc, après `normalize`, la
 * normale locale unitaire : `vraie` porte cette attente. Le dernier cas n'est pas dégénéré du tout :
 * une rotation d'échelle 1e-8 est régulière et le garde ne doit pas la prendre.
 */
export const GARDES = [
  ['3×3 nulle (somme nulle)', [ZERO, ZERO, ZERO], NORMALE_GARDE],
  [
    'colonne nulle (déterminant nul)',
    [ROTATION_MINUSCULE[0], ZERO, ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
  ],
  [
    'coefficient infini',
    [[Infinity, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]],
    NORMALE_GARDE,
  ],
  ['coefficient NaN', [[NaN, 0, 0], ROTATION_MINUSCULE[1], ROTATION_MINUSCULE[2]], NORMALE_GARDE],
].map(([nom, colonnes, normale]) => ({
  nom,
  world: pose(colonnes),
  normale,
  vraie: normale,
  degenere: true,
  ...MATIERE,
}));

/** Le témoin de non-gourmandise du garde : minuscule mais régulière, elle doit tourner. */
export const REGULIERE_MINUSCULE = {
  nom: 'rotation d’échelle 1e-8 (régulière)',
  world: pose(ROTATION_MINUSCULE),
  normale: NORMALE_GARDE,
  vraie: [-0.6, -0.8, 0],
  degenere: false,
  ...MATIERE,
};
