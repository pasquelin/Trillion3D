import { multiplyMatrix4 } from './mathMatrix4.ts';
import { crossVector3, dotVector3 } from './mathVector.ts';
import { LIGHT_SETTINGS } from './sceneLightContracts.ts';

/**
 * LES TAMPONS DE COMPOSITION D'UNE FACE, en double précision et arrondis À LA MAIN.
 *
 * Une carte d'ombre est lue par le GPU en simple précision : la projection et la vue étaient donc
 * écrites dans des `Float32Array`, et chaque terme s'y arrondissait au passage. Le produit du socle
 * n'accepte plus qu'un seul type de tampon (`mathMatrix4.ts`) — un seul appelant en `Float32Array`
 * rendait polymorphes les quarante-huit accès que toutes les boucles chaudes du moteur partagent.
 * Les trois tampons sont donc des `Float64Array`, et `arrondi` remet l'arrondi simple précision là
 * où le stockage le faisait : le produit lit exactement les mêmes nombres qu'avant, ses termes sont
 * calculés en double comme avant, et la recopie finale vers le tampon du GPU les arrondit une fois,
 * là où la recopie de `Float32Array` à `Float32Array` ne changeait rien. Les mêmes bits, donc.
 */
const arrondi = Math.fround;
const projScratch = new Float64Array(16);
/** Plans d'une face et demi-champ de sa projection. Un seul est vivant à la fois : l'appelant le lit
 *  avant de composer la face suivante, donc l'objet est réutilisé et rien n'est alloué par image. */
const planes = { near: 0, far: 0, halfFov: 0 };

/**
 * Projection perspective pour l'espace de découpe WebGPU, profondeur normalisée dans `[0, 1]`,
 * colonne-major, écrite dans le tampon rendu. `near` est dérivé de la seule portée : une seule
 * source pour la projection et pour le rejet, sinon les deux pourraient diverger d'un cheveu au
 * bord, et jamais un réglage caché.
 *
 * Le rayon d'enveloppe d'un émetteur ne touche pas ce plan : relever le plan proche d'une face
 * retire un cube, jusqu'à √3 fois sa valeur dans les diagonales, et non la sphère annoncée. Le
 * rayon est donc appliqué là où la profondeur d'ombre s'écrit, par distance au centre de la lampe
 * (`gpuShadowShader.ts`), et ce plan proche reste celui que la portée donne à toute lampe.
 */
export function shadowProjection(fov: number, range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction),
    far = Math.max(near * 1.001, range);
  const f = 1 / Math.tan(fov / 2),
    depth = far / (near - far);
  projScratch.fill(0);
  projScratch[0] = arrondi(f);
  projScratch[5] = arrondi(f);
  projScratch[10] = arrondi(depth);
  projScratch[11] = -1;
  projScratch[14] = arrondi(near * depth);
  planes.near = near;
  planes.far = far;
  planes.halfFov = fov / 2;
  return planes;
}

/**
 * Projection orthographique d'une cascade, profondeur normalisée dans `[0, 1]`, colonne-major. Le
 * plan proche est à l'œil : celui-ci est déjà reculé vers la lampe de toute la profondeur voulue.
 * Une orthographie n'a ni plan proche ni ouverture à publier : les deux sortent nuls.
 */
export function shadowOrthographic(halfExtent: number, far: number) {
  projScratch.fill(0);
  projScratch[0] = arrondi(1 / halfExtent);
  projScratch[5] = arrondi(1 / halfExtent);
  projScratch[10] = arrondi(-1 / far);
  projScratch[15] = 1;
  planes.near = 0;
  planes.far = far;
  planes.halfFov = 0;
  return planes;
}

/**
 * Le repère monde de la dernière face composée : droite, haut, avant. C'est ce qui permet de porter
 * un rectangle de la carte — une région de pages — dans le monde sans recalculer le repère ailleurs,
 * donc sans qu'une seconde copie puisse diverger de celle-ci.
 */
export const faceBasis = new Float64Array(9);

/** Axes de repère haut : `y` en général, `z` quand la direction lui est presque parallèle. */
const UP_Y = [0, 1, 0] as const,
  UP_Z = [0, 0, 1] as const;
const right = new Float64Array(3),
  upward = new Float64Array(3);

/** Matrice de vue colonne-major d'une caméra en `eye` regardant le long de `forward`. */
function shadowView(
  out: Float64Array,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  const fx = forward[0],
    fy = forward[1],
    fz = forward[2];
  // Un axe de repère parallèle à la direction ferait un produit vectoriel nul : on bascule l'axe haut.
  crossVector3(right, forward, Math.abs(fy) > 0.999 ? UP_Z : UP_Y);
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right[0] /= rl;
  right[1] /= rl;
  right[2] /= rl;
  crossVector3(upward, right, forward);
  for (let axis = 0; axis < 3; axis++) {
    faceBasis[axis] = right[axis];
    faceBasis[3 + axis] = upward[axis];
    faceBasis[6 + axis] = forward[axis];
  }
  out[0] = arrondi(right[0]);
  out[1] = arrondi(upward[0]);
  out[2] = arrondi(-fx);
  out[3] = 0;
  out[4] = arrondi(right[1]);
  out[5] = arrondi(upward[1]);
  out[6] = arrondi(-fy);
  out[7] = 0;
  out[8] = arrondi(right[2]);
  out[9] = arrondi(upward[2]);
  out[10] = arrondi(-fz);
  out[11] = 0;
  out[12] = arrondi(-dotVector3(right, eye));
  out[13] = arrondi(-dotVector3(upward, eye));
  out[14] = arrondi(dotVector3(forward, eye));
  out[15] = 1;
}

const viewScratch = new Float64Array(16),
  faceScratch = new Float64Array(16);

/**
 * Vue puis projection, composées dans `out` : le seul chemin par lequel une face obtient sa matrice.
 * La projection est celle que `shadowProjection` ou `shadowOrthographic` vient d'écrire.
 */
export function composeFace(
  out: Float32Array,
  base: number,
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
) {
  shadowView(viewScratch, eye, forward);
  // Composée à part puis recopiée : `multiplyMatrix4` n'écrit qu'aux seize indices constants, et la
  // recopie vers le tampon du GPU est la seule conversion en simple précision. Une face par lampe et
  // par image ; le décalage ne valait pas seize indices calculés dans le produit le plus chaud.
  multiplyMatrix4(faceScratch, projScratch, viewScratch);
  for (let i = 0; i < 16; i++) out[base + i] = faceScratch[i];
}
