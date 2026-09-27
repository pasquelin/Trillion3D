import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { CoverageReaders } from '../../texture/coverage.ts';
import type { TileLayout } from '../../texture/tiles.ts';
import type { PoolLane, TailBytes } from '../../texture/blockFormats.ts';

/**
 * Where a texture's texels come from. `bytes`: everything fits in the sidecar tail, nothing is
 * streamed. `baked`: the tail comes from the sidecar, streamed levels are read cooked from the
 * cache. `host`: neither, the host image goes through a working texture, mips weighted as its
 * `coverage` readers say (#42). A tail holds every encoding; the atlas pins its lane's.
 */
type TileSource =
  | { kind: 'bytes'; tail: TailBytes }
  | { kind: 'baked'; sha256: string; atlas: number; tail: TailBytes }
  | { kind: 'host'; map: Texture; coverage?: CoverageReaders };

/** A texture of the atlas: tile geometry, pool lane, texels, and its record — none for the fill. */
export type TileTexture = {
  layout: TileLayout;
  lane: PoolLane;
  source: TileSource;
  texture?: Texture;
};
