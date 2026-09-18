import {
  placeOf,
  POOL_LAYER_BYTES,
  POOL_LAYER_SIDE,
  TILE_BYTES,
  TILES_PER_LAYER,
  type TilePlace,
} from './textureTiles.ts';

/**
 * Le pool physique d'un atlas : une texture-tableau de couches de 30×30 tuiles, allouée UNE fois à
 * la taille que le budget de l'hôte donne, et jamais agrandie. Ce qu'une scène demande de plus
 * attend qu'une tuile moins regardée se libère ; c'est le seul endroit où la mémoire de textures
 * est décidée, et elle ne dépend pas de la scène.
 *
 * Le pool ne sait pas ce qu'une tuile porte : il tient, par place, une CLÉ que l'appelant lui
 * confie, la dernière image qui l'a regardée, et si elle est épinglée. La queue d'une texture est
 * épinglée à la préparation ; une tuile diffusée ne l'est jamais.
 */
export type WebgpuTilePool = {
  texture: GPUTexture;
  view: GPUTextureView;
  layers: number;
  /** Tuiles que le pool peut porter, et octets alloués — fixes pour toute la session. */
  tiles: number;
  bytes: number;
  /** Tuiles occupées, et leurs octets. */
  readonly resident: number;
  readonly residentBytes: number;
  /** Prend une tuile libre pour `key`, ou rend `undefined` quand le pool est plein. */
  acquire(key: number, frame: number, pinned?: boolean): number | undefined;
  release(index: number): void;
  touch(index: number, frame: number): void;
  keyOf(index: number): number;
  lastUseOf(index: number): number;
  /** Les tuiles non épinglées vues avant `frame`, la moins récemment regardée d'abord. */
  candidates(frame: number): number[];
  placeOf(index: number): TilePlace;
  destroy(): void;
};

export type TilePoolDevice = Pick<GPUDevice, 'createTexture'>;

export function createWebgpuTilePool(
  device: TilePoolDevice,
  options: { kind: 'color' | 'data'; format: GPUTextureFormat; layers: number },
): WebgpuTilePool {
  const { layers } = options;
  if (!Number.isSafeInteger(layers) || layers < 1) throw new Error('TEXTURE_POOL_LAYERS');
  const tiles = layers * TILES_PER_LAYER;
  const texture = device.createTexture({
    label: `WG texture pool ${options.kind}`,
    size: { width: POOL_LAYER_SIDE, height: POOL_LAYER_SIDE, depthOrArrayLayers: layers },
    format: options.format,
    // `copyExternalImageToTexture` exige aussi `RENDER_ATTACHMENT` de sa destination.
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const owner = new Int32Array(tiles).fill(-1),
    lastUse = new Uint32Array(tiles),
    pinned = new Uint8Array(tiles);
  // Les places libres, la plus basse en haut de pile : un pool à moitié vide reste compact.
  const free: number[] = [];
  for (let index = tiles - 1; index >= 0; index--) free.push(index);
  const check = (index: number) => {
    if (owner[index] === -1) throw new Error('TEXTURE_TILE_FREE');
  };
  return {
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers,
    tiles,
    bytes: layers * POOL_LAYER_BYTES,
    get resident() {
      return tiles - free.length;
    },
    get residentBytes() {
      return (tiles - free.length) * TILE_BYTES;
    },
    acquire(key, frame, pin = false) {
      const index = free.pop();
      if (index === undefined) return undefined;
      owner[index] = key;
      lastUse[index] = frame;
      pinned[index] = pin ? 1 : 0;
      return index;
    },
    release(index) {
      check(index);
      owner[index] = -1;
      pinned[index] = 0;
      free.push(index);
    },
    touch(index, frame) {
      check(index);
      lastUse[index] = frame;
    },
    keyOf(index) {
      check(index);
      return owner[index];
    },
    lastUseOf(index) {
      check(index);
      return lastUse[index];
    },
    candidates(frame) {
      const out: number[] = [];
      for (let index = 0; index < tiles; index++)
        if (owner[index] !== -1 && !pinned[index] && lastUse[index] < frame) out.push(index);
      return out.sort((a, b) => lastUse[a] - lastUse[b] || a - b);
    },
    placeOf,
    destroy() {
      texture.destroy();
    },
  };
}
