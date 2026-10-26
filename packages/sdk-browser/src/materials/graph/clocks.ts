/**
 * THE CLOCKS A MATERIAL GRAPH READS, in seconds. `time` is the world's: what the world's clock reads
 * at the image (`EngineContext.worldClock`), the one clock the exposure's adaptation and the graphs
 * share — it stands where the host's clock stands, and is the wall clock where the engine has no world.
 * `realTime` is always the wall clock, which runs on whatever the world's clock does. A `time` node
 * reads the first, or, with `ignorePause` set, the second; the panner and the rotator read the first.
 * Taken once at the start of an image (`takeGraphClocks`) and read by every pass of it — the opaque
 * resolve, the transparent pass, the fog's voxelisation, the light functions' atlas, the rasters —
 * so that all of them read one value.
 */
export interface GraphClocks {
  time: number
  realTime: number
}

/** The clocks before any image took them. */
export const newGraphClocks = (): GraphClocks => ({ time: 0, realTime: 0 })

/**
 * Takes the clocks of an image into `clocks`: the wall clock now, and the world's time from
 * `worldClock`, the wall clock again where the engine has no world (a bench, a test).
 */
export function takeGraphClocks(
  clocks: GraphClocks,
  worldClock: (() => number) | undefined,
  now = performance.now(),
) {
  clocks.realTime = now / 1000
  clocks.time = worldClock?.() ?? clocks.realTime
}
