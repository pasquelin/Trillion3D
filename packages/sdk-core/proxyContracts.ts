/**
 * Le proxy résident : format du produit de cache que les rayons de lumière touchent (LC1).
 *
 * Rien ici ne nomme une scène. Le proxy est une représentation grossière de toute la géométrie,
 * construite à la compilation, indépendante de la caméra, à triangles de taille bornée : le
 * compilateur ramène les sommets sur une grille, écarte ce qui n'a plus de surface et redécoupe ce
 * qui reste trop grand, jusqu'à tenir le budget de triangles. Cette taille bornée est aussi celle
 * d'une maille du cache de surfaces, qui porte une valeur par triangle et par face.
 *
 * Le BVH est large : quatre enfants par nœud, boîtes écrites sur huit bits dans les bornes exactes
 * du parent et arrondies vers l'extérieur, si bien qu'une boîte quantifiée contient toujours ce
 * qu'elle contenait. Le moteur teste les quatre d'un coup, descend sur la plus proche et empile les
 * autres : la même borne de traversée couvre quatre fois plus d'arbre qu'un arbre binaire.
 */

/** Version du produit de cache « proxy ». Un proxy d'une autre version est refusé, jamais deviné. */
export const SCENE_PROXY_VERSION = 2;
/** 'W','G','P','X' lus comme un entier non signé de 32 bits en petit-boutiste. */
export const SCENE_PROXY_MAGIC = 0x58504757;
/** Entiers d'en-tête : signature, version, triangles, nœuds. */
export const SCENE_PROXY_HEADER_WORDS = 4;
/** Nombres par triangle du proxy : trois sommets monde, sans normale — elle se déduit du triangle. */
export const PROXY_TRIANGLE_FLOATS = 9;
/** Nombres par nœud du BVH : ses bornes exactes, repère des boîtes quantifiées de ses enfants. */
export const PROXY_NODE_FLOATS = 6;
/** Enfants d'un nœud : quatre boîtes testées d'un coup, la plus proche gardée pour la suite. */
export const PROXY_CHILDREN = 4;
/** Entiers par enfant : deux mots de boîte quantifiée et de compte, puis le lien. */
export const PROXY_CHILD_WORDS = 3;
/** Entiers par nœud : ses quatre enfants bout à bout. */
export const PROXY_NODE_WORDS = PROXY_CHILDREN * PROXY_CHILD_WORDS;

/** Les colonnes du proxy, telles que son objet de cache les porte et que le GPU les recopie. */
export interface SceneProxyColumns {
  /** Trois sommets monde par triangle, `PROXY_TRIANGLE_FLOATS` nombres chacun. */
  triangles: Float32Array;
  /** Albédo diffus linéaire du triangle, empaqueté RGBA8. */
  albedo: Uint32Array;
  /** Bornes exactes de chaque nœud du BVH. */
  nodeBounds: Float32Array;
  /** Les quatre enfants de chaque nœud : boîte quantifiée, compte de triangles, présence, lien. */
  nodeChildren: Uint32Array;
}

/**
 * Ce que le manifeste dit du proxy résident : où le lire, ce qu'il pèse et ce qu'il vaut. C'est un
 * produit de cache à part, et non une colonne du sidecar : un manifeste sans lui reste lisible mot
 * pour mot par un moteur qui l'ignore, et ses dizaines de mégaoctets ne retardent pas la première
 * image d'une scène qui ne déclare aucune lampe.
 */
export interface SceneProxyDescriptor {
  version: number;
  url: string;
  sha256: string;
  bytes: number;
  /** Erreur géométrique du proxy en mètres : celle de la coupe, plus celle de la simplification. */
  errorMetres: number;
  /** Plancher du seuil : ce que la spécification demande avant que le budget ne l'élargisse. */
  errorFloorMetres: number;
  /** Pas de grille que la simplification a pris : la taille d'un triangle, donc d'une maille. */
  cellMetres: number;
  /** Budget de triangles publié, celui qui a décidé du seuil réellement obtenu. */
  triangleBudget: number;
  /** Emprise monde du proxy : trois bornes basses puis trois hautes. */
  bounds: [number, number, number, number, number, number];
  triangles: number;
  nodes: number;
}

/** Le proxy lu : son descriptif et ses colonnes, vues sur les octets de son objet de cache. */
export interface SceneProxy extends SceneProxyDescriptor {
  data: SceneProxyColumns;
}
