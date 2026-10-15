/**
 * THE ONE PROBE OF AN OPEN-ADDRESSED TABLE ON THE GPU: linear probing from a key's home slot, the
 * next slot masked by the slot count less one, a bounded number of steps — the slot count unless
 * given. Every GPU hash table of the engine walks it, lookups and inserts alike: the open counts
 * placements hold (`../heldOpen.ts`), the kept ranks (`differenceWgsl.ts`), the page→row map
 * (`../../../webgpu/row/rowMapWgsl.ts`) and the deform index
 * (`../../../webgpu/rays/deformIndexWgsl.ts`). Each gives its home, its mask, the word slot `s`
 * starts at, and what a step does at word `at`: return on a hit or an empty slot, take the slot,
 * or go on to the next. The text is a function body's: it declares `s`, `k` and `at`; past its
 * steps the function goes on after it.
 */
export const openProbeWgsl = (p: {
  home: string
  mask: string
  steps?: string
  slotWord: (s: string) => string
  step: string
}) => ` var s=${p.home};
 for(var k=0u;k<${p.steps ?? `(${p.mask})+1u`};k++){
  let at=${p.slotWord('s')};
  ${p.step}
  s=(s+1u)&(${p.mask});
 }`
