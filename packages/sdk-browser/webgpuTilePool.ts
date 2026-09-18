import {
  placeOf,
  POOL_LAYER_BYTES,
  POOL_LAYER_SIDE,
  TILE_BYTES,
  TILES_PER_LAYER,
  type TilePlace,
} from './textureTiles.ts';

/**
 * Le pool physique d'un atlas : une texture-tableau de couches de 30×30 tuiles, à la taille que le
 * budget de l'hôte donne — jamais à celle de la scène. Ce qu'une scène demande de plus attend
 * qu'une tuile moins regardée se libère. Un réglage de budget remplace le pool par un autre
 * (`webgpuTileAtlasResize.ts`), qui reprend ses places par `adopt`.
 *
 * Le pool ne sait pas ce qu'une tuile porte : il tient, par place, une CLÉ que l'appelant lui
 * confie, la dernière image qui l'a regardée, et si elle est épinglée. La queue d'une texture est
 * épinglée à la préparation ; une tuile diffusée ne l'est jamais.
 */
export type WebgpuTilePool = {
  texture: GPUTexture;
  view: GPUTextureView;
  layers: number;
  /** Tuiles que le pool peut porter, et octets alloués — fixes tant que ce pool vit. */
  tiles: number;
  bytes: number;
  /** Tuiles occupées, et leurs octets. */
  readonly resident: number;
  readonly residentBytes: number;
  /** Prend une tuile libre pour `key`, ou rend `undefined` quand le pool est plein. */
  acquire(key: number, frame: number, pinned?: boolean): number | undefined;
  /** Pose `key` à une place précise et libre — ce qu'un pool redimensionné reprend de l'ancien. */
  adopt(index: number, key: number, frame: number, pinned?: boolean): void;
  release(index: number): void;
  touch(index: number, frame: number): void;
  keyOf(index: number): number;
  lastUseOf(index: number): number;
  pinnedOf(index: number): boolean;
  /** Les tuiles non épinglées que ni `frame` ni l'image d'avant n'ont regardées, la moins récemment
   *  regardée d'abord. Une tuile regardée à l'image d'avant est très probablement regardée à
   *  celle-ci : la céder pour une autre, c'est la redemander à la suivante — le pool plein
   *  tournerait sur lui-même à chaque image. Il refuse plutôt, et le niveau grossier tient ; c'est
   *  la règle d'âge du pool de textures virtuelles de la référence. */
  candidates(frame: number): number[];
  /** Toutes les places occupées, épinglées comprises, dans l'ordre du pool. */
  occupied(): number[];
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
  // Les places libres, la plus basse en haut de pile : un pool à moitié vide reste compact. La
  // pile est refaite en une passe quand une adoption l'a périmée, à la prochaine prise.
  const free: number[] = [];
  let freeStale = true,
    resident = 0;
  const settle = () => {
    if (!freeStale) return;
    free.length = 0;
    for (let index = tiles - 1; index >= 0; index--) if (owner[index] === -1) free.push(index);
    freeStale = false;
  };
  const check = (index: number) => {
    if (owner[index] === -1) throw new Error('TEXTURE_TILE_FREE');
  };
  const occupy = (index: number, key: number, frame: number, pin: boolean) => {
    owner[index] = key;
    lastUse[index] = frame;
    pinned[index] = pin ? 1 : 0;
    resident++;
  };
  return {
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    layers,
    tiles,
    bytes: layers * POOL_LAYER_BYTES,
    get resident() {
      return resident;
    },
    get residentBytes() {
      return resident * TILE_BYTES;
    },
    acquire(key, frame, pin = false) {
      settle();
      const index = free.pop();
      if (index === undefined) return undefined;
      occupy(index, key, frame, pin);
      return index;
    },
    adopt(index, key, frame, pin = false) {
      if (owner[index] !== -1) throw new Error('TEXTURE_TILE_OCCUPIED');
      occupy(index, key, frame, pin);
      freeStale = true;
    },
    release(index) {
      check(index);
      owner[index] = -1;
      pinned[index] = 0;
      resident--;
      if (!freeStale) free.push(index);
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
    pinnedOf(index) {
      check(index);
      return pinned[index] === 1;
    },
    candidates(frame) {
      const out: number[] = [];
      for (let index = 0; index < tiles; index++)
        if (owner[index] !== -1 && !pinned[index] && lastUse[index] < frame - 1) out.push(index);
      return out.sort((a, b) => lastUse[a] - lastUse[b] || a - b);
    },
    occupied() {
      const out: number[] = [];
      for (let index = 0; index < tiles; index++) if (owner[index] !== -1) out.push(index);
      return out;
    },
    placeOf,
    destroy() {
      texture.destroy();
    },
  };
}
