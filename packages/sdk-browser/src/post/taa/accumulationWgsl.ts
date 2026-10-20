import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The engine's one temporal accumulation law, which every history it keeps reads — the bounce
 * probes (`../../lighting/bounce/probes/probeWgsl.ts`) and the reflections' history
 * (`../../lighting/reflections/temporalWgsl.ts`): a history holding the weight `held` takes a new
 * sample of weight `weight` with the share `weight / min(held + weight, most)` — the exact weighted
 * mean of its samples while their weight is below `most`, then an exponential average of that
 * length — and holds `min(held + weight, most)` after it (`accumulationCount`); a sample of weight
 * one a frame is the plain count, `1 / min(n + 1, most)`. A change the history cannot follow
 * restarts it: its weight at zero, so the new sample is taken whole. `most` is the history's
 * length, where its noise and its lag are traded. A sample of no weight on an empty history is no
 * share at all.
 */
export const ACCUMULATION_WGSL = wgslBlock(
  'ACCUMULATION_WGSL',
  [],
  `fn accumulationCount(held:f32,weight:f32,most:f32)->f32{return min(held+weight,most);}
fn accumulationShare(held:f32,weight:f32,most:f32)->f32{return weight/max(accumulationCount(held,weight,most),1e-30);}`,
)
