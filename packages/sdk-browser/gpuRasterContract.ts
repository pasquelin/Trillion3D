/**
 * Le contrat du raster de calcul : une seule écriture des nombres que le WGSL et l'encodeur lisent
 * tous les deux. Le raster couvre TOUS les triangles opaques et masqués de la coupe ; le mélange
 * garde sa passe matérielle.
 *
 * Quatre classes de taille, deux listes. Une classe dit combien de pixels un groupe de soixante-
 * quatre fils couvre d'un coup, jamais ce qu'un triangle vaut : la classe se lit sur la boîte
 * ENTIÈRE du triangle, découpée au viewport, donc un triangle à moitié hors champ tombe dans la
 * classe de ce qu'il en reste. Aucune classe ne peut déborder pendant que l'autre a de la place :
 * les deux d'une même liste la remplissent par les deux bouts, et la borne est tenue sur la somme.
 */

/** Groupes qu'une dimension de lancement garantit : la liste se répartit sur x et z au besoin. */
export const DISPATCH_SPAN = 65535;

/** Côté du pavé de la classe fine, et triangles qu'un groupe de soixante-quatre fils y traite. */
export const FINE_SIDE = 4;
export const FINE_PER_GROUP = 64 / (FINE_SIDE * FINE_SIDE);
/** Côté du pavé d'un groupe complet : la classe moyenne tient dans un seul, la grande en boucle. */
export const TILE = 8;
/** Pavés qu'un groupe de la grande classe parcourt au plus, donc son étendue maximale en pixels. */
export const LARGE_TILES = 8;
export const LARGE_SPAN = TILE * LARGE_TILES - 1;

/** Les mots que la liste réserve avant ses entrées : quatre comptes, la hauteur en pavés la plus
 *  grande de l'image, puis les quatre lancements que le noyau `plan` en déduit. */
export const CNT_FINE = 0,
  CNT_COARSE = 1,
  CNT_LARGE = 2,
  CNT_HUGE = 3,
  TILE_ROWS = 4;
/** Premier mot des lancements indirects ; ils sont contigus pour ne faire qu'une seule copie. */
export const DISPATCH_BASE = 6;
export const DISPATCH_WORDS = 12;
export const LIST_HEADER = 20;

/** Les octets d'en-tête que l'image remet à zéro : les cinq compteurs, arrondis au mot de copie. */
export const HEADER_CLEAR_BYTES = 24;

/**
 * Les trois modes d'un noyau de raster, dans l'ordre où l'image les encode.
 * `DEPTH_OCCLUDER` pose la profondeur de la moitié occulteurs — c'est elle que la pyramide réduit ;
 * `DEPTH_REST` ajoute la moitié testée que le verdict Hi-Z a gardée ; `ID` départage enfin les
 * identifiants sur la profondeur devenue définitive.
 */
export const MODE_DEPTH_OCCLUDER = 0,
  MODE_DEPTH_REST = 1,
  MODE_ID = 2;

/** Les quatre classes, dans l'ordre de leurs lancements indirects. */
export const RASTER_CLASSES = ['fine', 'coarse', 'large', 'huge'] as const;
export type RasterClass = (typeof RASTER_CLASSES)[number];

/** Le nom du point d'entrée d'une classe dans un mode : une seule règle, les deux côtés la lisent. */
export const rasterEntry = (klass: RasterClass, mode: number) => `${klass}${mode}`;
