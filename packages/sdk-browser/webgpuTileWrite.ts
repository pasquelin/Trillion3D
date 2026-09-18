import {
  levelSize,
  tailOffset,
  TILE_BORDER,
  TILE_PITCH,
  TILE_SIZE,
  type TilePlace,
} from './textureTiles.ts';

/**
 * Les gestes qui posent des texels dans une tuile du pool. Trois sources, un seul dessin : la
 * tuile reçoit ses 128×128 texels et, autour, la gouttière prise aux texels voisins du même
 * niveau — coupée au bord de l'image, où le nuanceur borne de toute façon sa lecture au demi-texel.
 *
 * Un niveau cuit arrive décodé par le navigateur et se copie par `copyExternalImageToTexture`, le
 * chemin même que la pleine résolution prenait — mêmes octets, même conversion. La queue du
 * sidecar arrive en octets RGBA et s'écrit par `writeTexture`. Une texture de l'hôte, sans chaîne
 * cuite, passe par une texture de travail dont la carte a fabriqué les mips, copiée niveau par
 * niveau dans le pool.
 */
export type TileRegion = {
  /** Origine et dimensions du rectangle lu dans le niveau source. */
  sx: number;
  sy: number;
  width: number;
  height: number;
  /** Où ce rectangle se pose dans la cellule de la tuile, gouttière comprise. */
  dx: number;
  dy: number;
};

/** Le rectangle d'une tuile dans son niveau, gouttière comprise, coupé au bord de l'image. */
export function tileRegion(levelWidth: number, levelHeight: number, tx: number, ty: number) {
  const x0 = Math.max(0, tx * TILE_SIZE - TILE_BORDER),
    y0 = Math.max(0, ty * TILE_SIZE - TILE_BORDER);
  const x1 = Math.min(levelWidth, (tx + 1) * TILE_SIZE + TILE_BORDER),
    y1 = Math.min(levelHeight, (ty + 1) * TILE_SIZE + TILE_BORDER);
  return {
    sx: x0,
    sy: y0,
    width: x1 - x0,
    height: y1 - y0,
    dx: x0 - tx * TILE_SIZE + TILE_BORDER,
    dy: y0 - ty * TILE_SIZE + TILE_BORDER,
  };
}

/** L'origine d'une cellule du pool, en texels. */
export const cellOrigin = (place: TilePlace) =>
  [place.x * TILE_PITCH, place.y * TILE_PITCH] as const;
/** L'origine du `rank`-ième niveau de la queue dans sa cellule, bordure comprise. */
const tailOrigin = (place: TilePlace, rank: number): GPUOrigin3D => [
  place.x * TILE_PITCH + TILE_BORDER + tailOffset(rank),
  place.y * TILE_PITCH + TILE_BORDER,
  place.layer,
];

/** Écrit des texels RGBA8 serrés à une origine d'une texture. */
export function writeRgba(
  queue: GPUQueue,
  texture: GPUTexture,
  origin: GPUOrigin3D,
  pixels: Uint8Array,
  width: number,
  height: number,
) {
  queue.writeTexture(
    { texture, origin },
    pixels as Uint8Array<ArrayBuffer>,
    { bytesPerRow: width * 4, rowsPerImage: height },
    { width, height },
  );
}

export function writeTileFromBitmap(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  bitmap: ImageBitmap,
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place);
  queue.copyExternalImageToTexture(
    { source: bitmap, origin: [region.sx, region.sy] },
    { texture: pool, origin: [ox + region.dx, oy + region.dy, place.layer] },
    [region.width, region.height],
  );
}

export function copyTileFromTexture(
  encoder: GPUCommandEncoder,
  pool: GPUTexture,
  place: TilePlace,
  source: GPUTexture,
  level: number,
  region: TileRegion,
) {
  const [ox, oy] = cellOrigin(place);
  encoder.copyTextureToTexture(
    { texture: source, mipLevel: level, origin: [region.sx, region.sy, 0] },
    { texture: pool, origin: [ox + region.dx, oy + region.dy, place.layer] },
    [region.width, region.height, 1],
  );
}

/** Les niveaux de la queue, du premier au 1×1, chacun à sa place dans la tuile. */
export function writeTailFromBytes(
  queue: GPUQueue,
  pool: GPUTexture,
  place: TilePlace,
  size: [number, number],
  tail: number,
  levels: readonly Uint8Array[],
) {
  levels.forEach((pixels, rank) => {
    const [width, height] = levelSize(size[0], size[1], tail + rank);
    if (pixels.byteLength !== width * height * 4) throw new Error('TEXTURE_TAIL_BYTES');
    writeRgba(queue, pool, tailOrigin(place, rank), pixels, width, height);
  });
}

export function copyTailFromTexture(
  encoder: GPUCommandEncoder,
  pool: GPUTexture,
  place: TilePlace,
  source: GPUTexture,
  size: [number, number],
  tail: number,
  last: number,
) {
  for (let level = tail; level <= last; level++) {
    const [width, height] = levelSize(size[0], size[1], level);
    encoder.copyTextureToTexture(
      { texture: source, mipLevel: level, origin: [0, 0, 0] },
      { texture: pool, origin: tailOrigin(place, level - tail) },
      [width, height, 1],
    );
  }
}
