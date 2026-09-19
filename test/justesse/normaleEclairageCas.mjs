// Cases and ground truth of defect 9's reproduction (`xformNormal`, standardLighting.ts): a
// world transform, a local normal, a light, and the true world normal computed in f64 by Three
// (`Matrix3.getNormalMatrix`, inverse-transpose with no threshold). Split from the orchestration
// to hold `check:lines`.
import * as THREE from 'three';

/** Rec. 709 luminance: a lit colour is compared by a single number. */
export const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const unitaire = (v) => {
  const n = Math.hypot(...v);
  return n > 0 ? v.map((x) => x / n) : v;
};

/**
 * The world transform `scale ∘ rotation` of the matrix family that defects 6 and 9's reproductions
 * both exercise. `kind` is `uniforme` (scale s on all three axes, determinant s³) or any other
 * value for the anisotropic scale (s, 1.7 s, 0.6 s): the first isolates the threshold defect, the
 * second checks that a non-trivial inverse-transpose stays correct. Translation is left null: it
 * changes neither a normal nor a recentre.
 */
export function poseMonde({ s, kind, axis, angleDeg }) {
  const echelle = kind === 'uniforme' ? [s, s, s] : [s, s * 1.7, s * 0.6];
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis).normalize(),
    (angleDeg * Math.PI) / 180,
  );
  return new THREE.Matrix4().compose(
    new THREE.Vector3(),
    quaternion,
    new THREE.Vector3(...echelle),
  );
}

/** World transform, local normal `normale`, and true world normal in f64 (Three). */
export function construireCas({ s, kind, axis, angleDeg, normale, lumiere, metal, rugosite }) {
  const world = poseMonde({ s, kind, axis, angleDeg });
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
 * Discrepancy between the normal the GPU rendered and the true normal: angle in degrees, and
 * relative luminance discrepancy between the two colours lit by the same BRDF on the same GPU.
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

/** The full campaign: every scale crossed with orientations, normals and lights. */
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
