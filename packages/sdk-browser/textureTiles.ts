import { previewFirstLevel, previewLastLevel, previewLevelSize } from '../sdk-core/index.ts';

/**
 * La géométrie des tuiles de textures virtuelles : ce que le pool physique, la table de pages et le
 * nuanceur partagent, écrit une fois. Tout est fixe — c'est ce qui rend la mémoire indépendante de
 * la scène : une tuile a toujours la même taille, un pool toujours le même nombre de tuiles par
 * couche, et seul le nombre de couches suit le budget de l'hôte.
 *
 * Une tuile porte 128×128 texels utiles et une gouttière de 4 texels de chaque côté, recopiés des
 * voisins du même niveau : le filtrage linéaire au bord d'une tuile lit ainsi les texels voisins,
 * pas ceux de la tuile d'à côté dans le pool. Une couche du pool range 30×30 tuiles ; ce qui reste
 * de 4096 n'est pas employé.
 *
 * Les niveaux d'une texture se partagent en deux : les niveaux DIFFUSÉS, du 0 jusqu'au dernier qui
 * dépasse 64 texels, découpés en tuiles résidentes à la demande ; et la QUEUE, du premier niveau
 * dont les deux côtés tiennent sous 64 texels jusqu'au 1×1, rangée entière dans une seule tuile,
 * épinglée dès la préparation. Une tuile diffusée absente montre donc toujours au moins la queue —
 * la même pyramide que le sidecar porte déjà dans le manifeste.
 */
export const TILE_SIZE = 128;
export const TILE_BORDER = 4;
export const TILE_PITCH = TILE_SIZE + 2 * TILE_BORDER;
const TILES_PER_ROW = 30;
export const POOL_LAYER_SIDE = TILES_PER_ROW * TILE_PITCH;
export const TILES_PER_LAYER = TILES_PER_ROW * TILES_PER_ROW;
export const TILE_BYTES = TILE_PITCH * TILE_PITCH * 4;
export const POOL_LAYER_BYTES = POOL_LAYER_SIDE * POOL_LAYER_SIDE * 4;
/** Niveaux qu'une texture peut avoir au plus : 2^15 texels de côté, la limite des appareils. */
export const MAX_LEVELS = 16;

/** Dimensions du niveau `level` d'une texture, jamais moins d'un texel par côté. */
export const levelSize = previewLevelSize;

/** Le premier niveau de la queue : celui dont les deux côtés tiennent sous 64 texels. */
const tailLevel = previewFirstLevel;

/** Le dernier niveau, celui où les deux côtés valent un texel. */
const lastLevel = previewLastLevel;

/** Tuiles d'un niveau diffusé, en colonnes puis en lignes. */
export function tilesAt(width: number, height: number, level: number): [number, number] {
  const [w, h] = levelSize(width, height, level);
  return [Math.ceil(w / TILE_SIZE), Math.ceil(h / TILE_SIZE)];
}

/**
 * Où un niveau de la queue commence dans sa tuile, par rang depuis le premier : 0, puis 64, 96,
 * 112, 120, 124, 126. Chaque niveau tient à droite du précédent, et le tout tient sous 128.
 */
export const tailOffset = (rank: number) => (rank === 0 ? 0 : TILE_SIZE - (TILE_SIZE >> rank));

/** Le découpage d'une texture : ses niveaux diffusés, leurs entrées de table, et sa queue. */
export type TileLayout = {
  width: number;
  height: number;
  /** Premier niveau de la queue ; les niveaux diffusés sont `0 … tail - 1`. */
  tail: number;
  last: number;
  /** Première entrée de chaque niveau diffusé dans la table de la texture. */
  offsets: number[];
  /** Entrées de table de la texture : une par tuile de chaque niveau diffusé. */
  entries: number;
};

export function tileLayout(width: number, height: number): TileLayout {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('INVALID_TEXTURE_SIZE');
  const tail = tailLevel(width, height),
    last = lastLevel(width, height);
  if (last >= MAX_LEVELS) throw new Error('TEXTURE_TOO_LARGE');
  const offsets: number[] = [];
  let entries = 0;
  for (let level = 0; level < tail; level++) {
    offsets.push(entries);
    const [tw, th] = tilesAt(width, height, level);
    entries += tw * th;
  }
  return { width, height, tail, last, offsets, entries };
}

/** Une place du pool : colonne, ligne et couche de la tuile. */
export type TilePlace = { x: number; y: number; layer: number };

/** Le rang d'une place dans le pool, et l'inverse. */
export const placeIndex = (p: TilePlace) => p.layer * TILES_PER_LAYER + p.y * TILES_PER_ROW + p.x;
export function placeOf(index: number): TilePlace {
  const layer = Math.floor(index / TILES_PER_LAYER),
    rest = index - layer * TILES_PER_LAYER;
  return { x: rest % TILES_PER_ROW, y: Math.floor(rest / TILES_PER_ROW), layer };
}

/**
 * Le mot d'une entrée de table : la place de la tuile résidente et le niveau qu'elle porte, qui
 * peut être plus grossier que celui de l'entrée quand la tuile demandée manque encore. Le bit haut
 * dit que l'entrée est servie ; zéro dit « rien de diffusé ici, lis la queue ».
 */
const ENTRY_SERVED = 0x80000000;
export const packEntry = (place: TilePlace, level: number) =>
  (ENTRY_SERVED | place.x | (place.y << 8) | (place.layer << 16) | (level << 24)) >>> 0;
export const entryLevel = (word: number) => (word >>> 24) & 0x7f;
export const entryPlace = (word: number): TilePlace => ({
  x: word & 0xff,
  y: (word >>> 8) & 0xff,
  layer: (word >>> 16) & 0xff,
});
