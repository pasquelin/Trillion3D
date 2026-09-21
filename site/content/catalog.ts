import { rendererLessons } from '../lessons/rendererLessons.ts';
import type { Localized } from './locale.ts';

interface ExampleBase {
  id: string;
  title: Localized;
  category: string;
  functions?: string[];
  engine?: boolean;
  renderer?: boolean;
  preview?: string;
  readyLessonId?: string;
}

/** A catalog lesson describes itself and is ready. */
export interface CatalogExample extends ExampleBase {
  status?: 'ready';
  description: Localized;
  concept?: undefined;
  reason?: undefined;
  subject?: undefined;
  supplementaryTopic?: undefined;
}

export const examples: CatalogExample[] = [
  {
    id: 'compose-transform',
    category: 'transforms',
    functions: ['composeMatrix4', 'transformAffinePoint'],
    title: { en: 'Build a transform', fr: 'Construire une transformation' },
    description: {
      en: 'Move, rotate and scale a local shape into world space.',
      fr: 'Déplacez, tournez et redimensionnez une forme locale dans le monde.',
    },
  },
  {
    id: 'matrix-chain',
    category: 'transforms',
    functions: ['multiplyMatrix4', 'transformAffinePoint'],
    title: { en: 'Chain two transforms', fr: 'Enchaîner deux transformations' },
    description: {
      en: 'See why transform order changes the final position.',
      fr: 'Voyez pourquoi l’ordre change la position finale.',
    },
  },
  {
    id: 'matrix-inverse',
    category: 'transforms',
    functions: ['composeMatrix4', 'invertMatrix4', 'multiplyMatrix4', 'transformAffinePoint'],
    title: { en: 'Travel out and back', fr: 'Faire l’aller-retour' },
    description: {
      en: 'Invert a transform and recover a local point from world space.',
      fr: 'Inversez une transformation et retrouvez un point local depuis le monde.',
    },
  },
  {
    id: 'reflection-orientation',
    category: 'transforms',
    functions: ['composeMatrix4', 'determinantMatrix4', 'linearPartDeterminant'],
    title: { en: 'When a mirror flips faces', fr: 'Quand un miroir retourne les faces' },
    description: {
      en: 'Watch determinant sign track orientation through negative scale.',
      fr: 'Suivez le signe du déterminant lors d’une échelle négative.',
    },
  },
  {
    id: 'quaternion-turn',
    category: 'transforms',
    functions: ['composeMatrix4', 'transformDirectionVector3'],
    title: { en: 'Quaternion axis rotation', fr: 'Rotation par quaternion' },
    description: {
      en: 'Build a unit quaternion and rotate a direction without translation.',
      fr: 'Construisez un quaternion unité et tournez une direction sans translation.',
    },
  },
  {
    id: 'normal-transform',
    category: 'vectors',
    functions: ['composeMatrix4', 'normalMatrix3', 'applyMatrix3Vector3', 'normalizeVector3'],
    title: { en: 'Normals under uneven scale', fr: 'Normales sous échelle inégale' },
    description: {
      en: 'Compare a corrected surface normal with a naively scaled direction.',
      fr: 'Comparez la normale corrigée à une direction naïvement redimensionnée.',
    },
  },
  {
    id: 'perspective',
    category: 'camera',
    functions: ['perspectiveProjection', 'transformHomogeneousPoint'],
    title: { en: 'Perspective projection', fr: 'Projection perspective' },
    description: {
      en: 'Connect field of view and depth to the projected image.',
      fr: 'Reliez champ de vision, profondeur et image projetée.',
    },
  },
  {
    id: 'frustum',
    category: 'camera',
    functions: ['perspectiveProjection', 'frustumPlanesFromMatrix', 'frustumClipBox'],
    title: { en: 'Frustum decisions', fr: 'Décisions du frustum' },
    description: {
      en: 'Move a box through six camera planes: outside, crossing or inside.',
      fr: 'Déplacez une boîte parmi les six plans : dehors, à cheval ou dedans.',
    },
  },
  {
    id: 'dot-product',
    category: 'vectors',
    functions: ['dotVector3'],
    title: { en: 'Dot product as alignment', fr: 'Produit scalaire et alignement' },
    description: {
      en: 'Turn two arrows and read agreement from −1 to +1.',
      fr: 'Tournez deux flèches et lisez leur accord de −1 à +1.',
    },
  },
  {
    id: 'cross-product',
    category: 'vectors',
    functions: ['crossVector3'],
    title: { en: 'Cross product and orientation', fr: 'Produit vectoriel et orientation' },
    description: {
      en: 'The signed area reveals clockwise and counter-clockwise turns.',
      fr: 'L’aire signée révèle les rotations horaires et antihoraires.',
    },
  },
  {
    id: 'normalize',
    category: 'vectors',
    functions: ['normalizeVector3', 'lengthSqVector3'],
    title: { en: 'Separate length from direction', fr: 'Séparer longueur et direction' },
    description: {
      en: 'Normalization keeps direction and makes length one.',
      fr: 'La normalisation garde la direction et ramène la longueur à un.',
    },
  },
  {
    id: 'box-grow',
    category: 'bounds',
    functions: ['boxEmpty', 'boxExpandByPoint'],
    title: { en: 'Grow a bounding box', fr: 'Faire grandir une boîte englobante' },
    description: {
      en: 'Add points one by one and watch the smallest enclosing box.',
      fr: 'Ajoutez les points et observez la plus petite boîte qui les contient.',
    },
  },
  {
    id: 'sphere-from-box',
    category: 'bounds',
    functions: ['sphereFromBounds'],
    title: { en: 'Box to bounding sphere', fr: 'De la boîte à la sphère' },
    description: {
      en: 'Compare a tight box with its fast conservative sphere.',
      fr: 'Comparez une boîte serrée à sa sphère conservatrice rapide.',
    },
  },
  {
    id: 'hierarchy',
    category: 'scene',
    functions: [
      'createTransformTree',
      'addTransformNode',
      'setNodePosition',
      'updateNodeWorldMatrix',
      'nodeWorldPosition',
    ],
    title: { en: 'Parent and child motion', fr: 'Mouvement parent-enfant' },
    description: {
      en: 'A child keeps its local offset while its parent moves.',
      fr: 'Un enfant garde son décalage local quand son parent bouge.',
    },
  },
  {
    id: 'color-space',
    category: 'color',
    functions: ['srgbToLinear', 'linearToSrgb'],
    title: { en: 'Colour is not arithmetic', fr: 'La couleur n’est pas arithmétique' },
    description: {
      en: 'Compare a screen-space midpoint with a light-space midpoint.',
      fr: 'Comparez une moyenne écran à une moyenne de lumière.',
    },
  },
  {
    id: 'lod-budget',
    category: 'streaming',
    functions: ['lodQuality', 'adaptivePixelError', 'createPathGovernor'],
    title: { en: 'LOD budget governor', fr: 'Gouverneur du budget LOD' },
    description: {
      en: 'Trade projected error for a bounded frame workload.',
      fr: 'Échangez erreur projetée et charge bornée de la trame.',
    },
  },
  ...rendererLessons,
];

export const byId = (id: string) => examples.find((example) => example.id === id) ?? examples[0];
