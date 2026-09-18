/**
 * Le contrat du raster de calcul : une seule écriture des nombres que le WGSL et l'encodeur lisent
 * tous les deux. Le raster prend la part de la coupe opaque et masquée que le partage lui donne,
 * jusqu'à toute la coupe ; le mélange garde sa passe matérielle.
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
const LARGE_TILES = 8;
export const LARGE_SPAN = TILE * LARGE_TILES - 1;
/** Étendue maximale d'une boîte de la classe fine : un pavé de `FINE_SIDE` pixels de côté. */
export const FINE_SPAN = FINE_SIDE - 1;

/**
 * Le partage petits/grands de la référence : un triangle dont la boîte d'écran, serrée à l'image,
 * ne dépasse pas `computeSpan` pixels part au raster de calcul, les autres au matériel. Zéro :
 * le matériel dessine tout. `COMPUTE_ALL` est un mode, pas une étendue infinie : le calcul prend
 * alors aussi les triangles qu'un sommet met derrière le plan proche, qu'un seuil laisse toujours
 * au matériel, qui les coupe lui-même.
 */
export const COMPUTE_ALL = 1e9;

/**
 * Le prédicat du partage, le même texte dans les deux rasters : ils lisent les mêmes sommets, le
 * même produit hissé `viewProj*world`, la même boîte — et se partagent la coupe sans trou ni
 * doublon. Exige `uni.viewport` et `uni.computeSpan`.
 */
export const COMPUTE_TAKES_WGSL = `
fn screen(p:vec4f)->vec2f{return vec2f((p.x/p.w*0.5+0.5)*uni.viewport.x,(1.0-(p.y/p.w*0.5+0.5))*uni.viewport.y);}
struct ScreenBox{lo:vec2f,hi:vec2f,q0:vec2f,q1:vec2f,span:f32,}
/** La boîte serrée à l'image d'une étendue d'écran, et son étendue en pixels entiers. */
fn boxOf(lo:vec2f,hi:vec2f)->ScreenBox{
 let last=uni.viewport-vec2f(1.0);
 let q0=clamp(floor(lo),vec2f(0.0),last);let q1=clamp(floor(hi),vec2f(0.0),last);
 return ScreenBox(lo,hi,q0,q1,max(q1.x-q0.x,q1.y-q0.y));
}
fn screenBox(a:vec2f,b:vec2f,c:vec2f)->ScreenBox{return boxOf(min(a,min(b,c)),max(a,max(b,c)));}
fn computeTakes(ca:vec4f,cb:vec4f,cc:vec4f)->bool{
 if(uni.computeSpan>=${COMPUTE_ALL}){return true;}
 if(uni.computeSpan<=0.0||ca.w-ca.z<0.0||cb.w-cb.z<0.0||cc.w-cc.z<0.0){return false;}
 return screenBox(screen(ca),screen(cb),screen(cc)).span<=uni.computeSpan;
}`;

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
