import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The engine's one temporal accumulation law, which every history it keeps reads — the bounce
 * probes (`../bounce/probeWgsl.ts`), the temporal antialiasing's colour (`historyWgsl.ts`) and,
 * once they adopt it, the reflections' history: a history of `count` samples takes a new one with
 * the share `1 / min(count + 1, most)` — the exact mean of its samples while they are fewer than
 * `most`, then an exponential average of that length — and holds `min(count + 1, most)` after it
 * (`accumulationCount`). A change the history cannot follow restarts it: its count at zero, so the
 * new sample is taken whole. `most` is the history's length, where its noise and its lag are traded.
 */
export const ACCUMULATION_WGSL = wgslBlock(
  'ACCUMULATION_WGSL',
  [],
  `fn accumulationShare(count:f32,most:f32)->f32{return 1.0/min(count+1.0,most);}
fn accumulationCount(count:f32,most:f32)->f32{return min(count+1.0,most);}`,
)
