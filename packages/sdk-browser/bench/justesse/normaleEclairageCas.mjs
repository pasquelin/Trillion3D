// Cas et vérité terrain de la reproduction du défaut 9 (`xformNormal`, standardLighting.ts) :
// une transformation monde, une normale locale, une lampe, et la normale monde vraie calculée en
// f64 par Three (`Matrix3.getNormalMatrix`, inverse-transposée sans seuil). Séparé de
// l'orchestration pour tenir `check:lines`.
import * as THREE from 'three';

/** Luminance Rec. 709 : une couleur éclairée se compare par un seul nombre. */
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const unitaire = (v) => {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
};

/**
 * Transformation monde `échelle ∘ rotation`, normale locale `normale`, et normale monde vraie.
 * `kind` vaut `uniforme` (échelle s sur les trois axes, déterminant s³) ou `anisotrope` (s, 1,7 s,
 * 0,6 s) : le premier isole le défaut, le second vérifie qu'une inverse-transposée non triviale
 * reste juste. La translation ne change pas une normale : elle est laissée nulle.
 */
export function construireCas({ s, kind, axis, angleDeg, normale, lumiere, metal, rugosite }) {
  const echelle = kind === 'uniforme' ? [s, s, s] : [s, s * 1.7, s * 0.6];
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis).normalize(),
    (angleDeg * Math.PI) / 180,
  );
  const world = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    quaternion,
    new THREE.Vector3(...echelle),
  );
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const vraie = new THREE.Vector3(...normale).applyMatrix3(normalMatrix).normalize();
  return {
    nom: `s=${s} ${kind} axe=${axis.join(',')} angle=${angleDeg}° n=${normale.join(',')}`,
    s,
    kind,
    world: Array.from(world.elements),
    normale,
    vraie: [vraie.x, vraie.y, vraie.z],
    lumiere,
    metal,
    rugosite,
  };
}

/**
 * Écart entre la normale que le GPU a rendue et la normale vraie : angle en degrés, et écart
 * relatif de luminance entre les deux couleurs éclairées par la même BRDF sur le même GPU.
 */
export function ecart(cas, ligne) {
  const rendue = unitaire(ligne.rendue);
  const produit = rendue.reduce((acc, x, i) => acc + x * cas.vraie[i], 0);
  const angleDeg = (Math.acos(Math.min(1, Math.max(-1, produit))) * 180) / Math.PI;
  const vue = luminance(ligne.litVrai);
  const rendu = luminance(ligne.litRendu);
  return {
    nom: cas.nom,
    s: cas.s,
    kind: cas.kind,
    angleDeg,
    luminanceVraie: vue,
    luminanceRendue: rendu,
    ecartLuminance: Math.abs(rendu - vue) / Math.max(vue, 1e-6),
  };
}

export const ECHELLES = [1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6, 2e-7, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16];
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
];
const ANGLES = [0, 37, 90, 137, 180];
const NORMALES = [
  [0, 0, 1],
  [0, 1, 0],
  [0.6, -0.8, 0],
];
const LUMIERES = [
  [0.3, 0.8, 0.5, 3],
  [-0.7, 0.2, 0.6, 2],
];

/** La campagne complète : toutes les échelles croisées avec orientations, normales et lampes. */
export function campagne() {
  const cas = [];
  for (const s of ECHELLES)
    for (const kind of ['uniforme', 'anisotrope'])
      for (const axis of AXES)
        for (const angleDeg of ANGLES)
          for (const normale of NORMALES)
            for (const lumiere of LUMIERES)
              cas.push(
                construireCas({
                  s,
                  kind,
                  axis,
                  angleDeg,
                  normale,
                  lumiere,
                  metal: 0.1,
                  rugosite: 0.4,
                }),
              );
  return cas;
}
