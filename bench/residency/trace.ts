import { readFileSync, writeFileSync } from 'node:fs'

/**
 * A RESIDENCY TRACE (#1527, measurements M1 and M2 of the residency design): what the pixels asked,
 * frame by frame, read back offline through each eviction policy (`tileReplay.ts`, `vsmReplay.ts`).
 *
 * A texture trace holds, per frame, EVERY tile the sampled pixels asked — never cut at the
 * feedback's cap: the replay applies the cap to the policies that read the capped list —, as tile
 * ids (`packages/sdk-browser/src/webgpu/tile/ids.ts`, `tileId`), each with the pixels that named it,
 * in the order the reduction lists them (the screen's). Each texture's TAIL level is its own: from
 * it down every pixel reads the pinned tail, never a tile. A frame that follows a camera cut says so.
 *
 * A shadow trace holds, per frame, every virtual page the lights want, as `level << 24 | page`:
 * the map level is the page's tier.
 */
export type TileTraceFrame = {
  readonly tiles: Uint32Array
  readonly weights: Uint32Array
  readonly cut?: boolean
}

export type TileTrace = {
  readonly name: string
  /** Each texture's tail level, by texture slot. */
  readonly tails: readonly number[]
  readonly frames: readonly TileTraceFrame[]
}

export type VsmTrace = {
  readonly name: string
  readonly frames: readonly { readonly pages: Uint32Array; readonly cut?: boolean }[]
}

/** The map level of a shadow trace's page, its tier. */
export const vsmPageLevel = (page: number) => page >>> 24

type Stored = {
  name: string
  tails?: number[]
  frames: { tiles?: number[]; weights?: number[]; pages?: number[]; cut?: boolean }[]
}

/** Writes `trace` at `path`, as JSON: a trace is read by a person as much as by the replay. */
export function writeTrace(path: string, trace: TileTrace | VsmTrace) {
  const frames = trace.frames.map((frame) => ({
    ...('tiles' in frame
      ? { tiles: [...frame.tiles], weights: [...frame.weights] }
      : { pages: [...frame.pages] }),
    ...(frame.cut && { cut: true }),
  }))
  writeFileSync(path, JSON.stringify({ ...trace, frames }))
}

/** The texture trace at `path` (`writeTrace`). */
export function readTileTrace(path: string): TileTrace {
  const stored = JSON.parse(readFileSync(path, 'utf8')) as Stored
  return {
    name: stored.name,
    tails: stored.tails ?? [],
    frames: stored.frames.map((frame) => ({
      tiles: Uint32Array.from(frame.tiles ?? []),
      weights: Uint32Array.from(frame.weights ?? []),
      cut: frame.cut,
    })),
  }
}

/** The shadow trace at `path` (`writeTrace`). */
export function readVsmTrace(path: string): VsmTrace {
  const stored = JSON.parse(readFileSync(path, 'utf8')) as Stored
  return {
    name: stored.name,
    frames: stored.frames.map((frame) => ({
      pages: Uint32Array.from(frame.pages ?? []),
      cut: frame.cut,
    })),
  }
}
