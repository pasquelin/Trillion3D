/**
 * La disposition mémoire que la partition GPU partage avec le test Hi-Z et avec l'hôte.
 *
 * Tout ce qu'une image décidait ligne par ligne sur le processeur — projection des boîtes en
 * rectangles d'écran, partage occulteurs/testés, empaquetage des bornes du test d'occultation — est
 * écrit par des noyaux de calcul dans ces trois tampons. Le processeur n'en relit que `state`, et
 * seulement sur le rythme du relevé périodique.
 */

/**
 * Flottants d'une boîte monde : huit coins, chacun en trois coordonnées portées par DEUX simples
 * précisions — la valeur arrondie et son résidu.
 *
 * Un coin seul en simple précision porte une erreur de `u|x|`, et sur un modèle dont les
 * coordonnées valent des dizaines de milliers cette erreur-là domine toutes les autres : la borne
 * conservatrice rendait alors des rectangles de plusieurs centaines de texels. Deux flottants
 * représentent le double d'origine à `u²` près, et l'écart à l'ancre se calcule sans jamais faire
 * apparaître la magnitude monde : la borne redevient proportionnelle à la taille du cluster.
 */
export const CORNER_VALUES = 48;

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

/** Fils d'un groupe de travail des noyaux par ligne. */
export const PARTITION_WORKGROUP = 64;

/**
 * L'histogramme de profondeur de `state` : son premier mot, et le nombre de bits de tête de la clé
 * ordonnable qui nomment un seau.
 *
 * La clé est celle de la profondeur de VUE, jamais celle de la profondeur normalisée. Les bits de
 * tête d'un flottant sont son exposant, et une profondeur normalisée par une projection perspective
 * vit presque entière dans un seul exposant : tous les seaux sauf un restaient vides, le seuil
 * médian tombait au-delà de toutes les boîtes, et l'image entière partait du côté des occulteurs —
 * la moitié testée ne contenait plus que des boîtes coupées, que rien ne rejette. La profondeur de
 * vue, elle, s'étale sur une vingtaine d'exposants, et douze bits la découpent assez finement pour
 * que le seuil tombe près de la médiane.
 */
export const STATE_HISTO = 16;
export const HISTO_BITS = 12;
export const HISTO_BUCKETS = 1 << HISTO_BITS;
/** Seaux qu'un fil du groupe de travail totalise dans le balayage à deux niveaux de `chooseSplit`. */
export const HISTO_BLOCK = HISTO_BUCKETS / PARTITION_WORKGROUP;
export const STATE_WORDS = STATE_HISTO + HISTO_BUCKETS;

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


/**
 * Mots de l'uniforme : vue (16) et vue-projection (16), toutes deux DÉJÀ composées avec la
 * translation de l'ancre ; l'ancre en deux simples précisions, avec le plan proche ; puis les
 * scalaires, puis la table des mips — décalage et largeur — que l'empaquetage des bornes lit.
 */
export const UNI_VIEW = 0,
  UNI_VIEW_PROJ = 16,
  UNI_ANCHOR = 32,
  UNI_ANCHOR_LOW = 36,
  UNI_SCALARS = 40,
  UNI_LEVELS = 48;
export const MAX_HIZ_LEVELS = 16;
export const UNIFORM_U32 = UNI_LEVELS + MAX_HIZ_LEVELS * 2;
