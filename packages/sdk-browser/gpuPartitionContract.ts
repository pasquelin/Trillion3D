/**
 * La disposition mémoire que la partition GPU partage avec le test Hi-Z et avec l'hôte.
 *
 * Tout ce qu'une image décidait ligne par ligne sur le processeur — projection des boîtes en
 * rectangles d'écran, partage occulteurs/testés, empaquetage des bornes du test d'occultation — est
 * écrit par des noyaux de calcul dans ces trois tampons. Le processeur n'en relit que `state`, et
 * seulement sur le rythme du relevé périodique.
 */

/** Flottants d'une boîte monde : huit coins de trois coordonnées, comme `createBoxCorners`. */
export const CORNER_VALUES = 24;

/**
 * Mots par ligne de `rowData` : le rectangle d'écran non découpé (quatre entiers signés), la borne
 * de profondeur déjà redressée, les drapeaux, la clé ordonnable de profondeur, et un mot de garde.
 */
export const ROW_DATA_U32 = 8;
export const ROW_NEAREST = 4,
  ROW_FLAGS = 5,
  ROW_KEY = 6;
/** Bits de `rowData[ROW_FLAGS]`. */
export const FLAG_CLIP = 1,
  FLAG_PREV_REST = 2,
  FLAG_HISTORY = 4;

/**
 * Mots par boîte testée : le rectangle déjà découpé au viewport et exprimé en texels du mip qui le
 * couvre, la borne de profondeur, la ligne de verdict, l'adresse du mip, et les triangles dont le
 * compteur pèse un rejet.
 */
export const TESTED_U32 = 12;

/** Premier mot de l'histogramme dans `state`, dont les deux cent cinquante-six seaux sont l'octet
 *  de tête de la clé ordonnable de profondeur. */
export const STATE_HISTO = 16;
export const STATE_WORDS = STATE_HISTO + 256;

/** Compteurs de `state`, tous atomiques : les trois décisions que `chooseSplit` pose y sont
 *  simplement rangées par `atomicStore`, jamais accumulées. */
export const ST_TESTED = 0,
  ST_OCCLUDERS = 1,
  ST_HISTORY_OCCLUDERS = 2,
  ST_IN_FRONT = 3,
  ST_OVERSIZED = 4,
  ST_TESTED_TRIANGLES = 5,
  ST_OVERSIZED_TRIANGLES = 6,
  ST_REJECTED = 7,
  ST_REJECTED_TRIANGLES = 8,
  ST_THRESHOLD = 9,
  ST_MODE = 10,
  ST_TWO_PASS = 11;

/** Mode de partage : le seuil médian de l'image, ou l'historique d'occulteurs de la précédente. */
export const MODE_MEDIAN = 0,
  MODE_HISTORY = 1;

/** Fils d'un groupe de travail des noyaux par ligne. */
export const PARTITION_WORKGROUP = 64;

/**
 * Mots de l'uniforme : vue (16), vue-projection (16), puis les scalaires, puis la table des mips
 * — décalage et largeur de chacun — que l'empaquetage des bornes lit.
 */
export const UNI_VIEW = 0,
  UNI_VIEW_PROJ = 16,
  UNI_SCALARS = 32,
  UNI_LEVELS = 40;
export const MAX_HIZ_LEVELS = 16;
export const UNIFORM_U32 = UNI_LEVELS + MAX_HIZ_LEVELS * 2;
