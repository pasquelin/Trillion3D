import type * as THREE from 'three';
import type { TextureRgba } from './visibilityTypes.ts';
import { entryLevel, type TileLayout, type TilePlace } from './textureTiles.ts';
import { createWebgpuTilePool, type WebgpuTilePool } from './webgpuTilePool.ts';
import {
  createWebgpuTilePageTable,
  type TileKey,
  type WebgpuTilePageTable,
} from './webgpuTilePageTable.ts';
import { writeTailFromBytes } from './webgpuTileWrite.ts';

/**
 * D'où viennent les texels d'une texture. `bytes` : tout tient dans la queue du sidecar, rien n'est
 * diffusé. `baked` : la queue vient du sidecar, les niveaux diffusés se lisent cuits dans le cache.
 * `host` : ni l'un ni l'autre, l'image de l'hôte passe par une texture de travail.
 */
type TileSource =
  | { kind: 'bytes'; tail: readonly Uint8Array[] }
  | { kind: 'baked'; sha256: string; atlas: number; tail: readonly Uint8Array[] }
  | { kind: 'host'; map: THREE.Texture; rgba: TextureRgba | null };

export type TileTexture = { layout: TileLayout; source: TileSource };

/** L'identifiant entier d'une tuile diffusée, celui que le pool retient par place. */
const tileId = ({ slot, level, tx, ty }: TileKey) =>
  ((slot << 20) | (level << 16) | (ty << 8) | tx) >>> 0;
const tileKeyOf = (id: number): TileKey => ({
  slot: id >>> 20,
  level: (id >>> 16) & 15,
  ty: (id >>> 8) & 255,
  tx: id & 255,
});
/** L'identifiant de la queue d'une texture : hors de la plage des tuiles diffusées. */
const tailId = (slot: number) => (0x80000000 | slot) >>> 0;

/**
 * Un atlas de textures virtuelles : son pool, sa table de pages et son catalogue. Il sait quelle
 * tuile réside où, laquelle céder sa place, et il tient la table à jour ; ce qu'une tuile contient
 * et d'où cela vient est l'affaire du diffuseur.
 */
export type WebgpuTileAtlas = {
  readonly kind: 'color' | 'data';
  readonly pool: WebgpuTilePool;
  readonly pages: WebgpuTilePageTable;
  readonly textures: readonly TileTexture[];
  readonly evictions: number;
  readonly refused: number;
  /** Épingle la queue de chaque texture ; `fromHost` pose celle d'une texture sans queue en octets. */
  pinTails(queue: GPUQueue, fromHost: (slot: number, place: TilePlace) => void): void;
  /** Marque vue la tuile si elle réside ; dit si c'est le cas. */
  touch(key: TileKey, frame: number): boolean;
  /** Une place pour une tuile qui arrive : libre, ou reprise à la moins regardée ; `undefined`
   *  quand tout ce que le pool porte a été regardé dans cette image — refus compté. */
  place(key: TileKey, frame: number): TilePlace | undefined;
  /** Le niveau qui sert une tuile aujourd'hui : le sien, un ancêtre, ou la queue. */
  servedLevel(key: TileKey): number;
  flush(device: Pick<GPUDevice, 'queue'>): void;
  destroy(): void;
};

export function createWebgpuTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createBuffer' | 'queue'>,
  options: {
    kind: 'color' | 'data';
    format: GPUTextureFormat;
    layers: number;
    feedbackOffset: number;
    textures: TileTexture[];
  },
): WebgpuTileAtlas {
  const { kind, textures } = options;
  const pool = createWebgpuTilePool(device, {
    kind,
    format: options.format,
    layers: options.layers,
  });
  const pages = createWebgpuTilePageTable(
    device,
    textures.map((texture) => texture.layout),
    { kind, feedbackOffset: options.feedbackOffset },
  );
  if (textures.length > pool.tiles)
    throw new Error(`TEXTURE_POOL_TAILS: ${textures.length} textures, ${pool.tiles} tiles`);
  const resident = new Map<number, number>();
  let evictions = 0,
    refused = 0;
  // Les candidates à l'éviction, calculées une fois par image et consommées dans l'ordre.
  let candidates: number[] = [],
    candidatesFrame = -1;
  const evict = (frame: number) => {
    if (candidatesFrame !== frame) {
      candidates = pool.candidates(frame);
      candidatesFrame = frame;
    }
    const index = candidates.shift();
    if (index === undefined) return undefined;
    const id = pool.keyOf(index);
    pages.clearTile(tileKeyOf(id));
    resident.delete(id);
    pool.release(index);
    evictions++;
    return index;
  };
  return {
    kind,
    pool,
    pages,
    textures,
    get evictions() {
      return evictions;
    },
    get refused() {
      return refused;
    },
    pinTails(queue, fromHost) {
      textures.forEach((texture, slot) => {
        const index = pool.acquire(tailId(slot), 0, true)!;
        const place = pool.placeOf(index);
        const { layout, source } = texture;
        if (source.kind === 'host') fromHost(slot, place);
        else
          writeTailFromBytes(
            queue,
            pool.texture,
            place,
            [layout.width, layout.height],
            layout.tail,
            source.tail,
          );
        pages.setTail(slot, place);
      });
    },
    touch(key, frame) {
      const index = resident.get(tileId(key));
      if (index === undefined) return false;
      pool.touch(index, frame);
      return true;
    },
    place(key, frame) {
      const id = tileId(key);
      // Une place libre, sinon celle que la moins regardée vient de rendre — elle est en haut de
      // la pile des libres, donc la prise qui suit est la sienne.
      let index = pool.acquire(id, frame);
      if (index === undefined && evict(frame) !== undefined) index = pool.acquire(id, frame);
      if (index === undefined) {
        refused++;
        return undefined;
      }
      resident.set(id, index);
      const place = pool.placeOf(index);
      pages.setTile(key, place);
      return place;
    },
    servedLevel(key) {
      const word = pages.entryOf(key);
      return word === 0 ? textures[key.slot].layout.tail : entryLevel(word);
    },
    flush: (target) => pages.flush(target),
    destroy() {
      pages.destroy();
      pool.destroy();
    },
  };
}
