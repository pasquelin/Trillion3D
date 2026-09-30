import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';

/** Clusters the `commands` first commands draw: the device's own count, never estimated. */
export function sumKeptClusters(words: Uint32Array, commands: number) {
  let kept = 0;
  for (let command = 0; command < commands; command++)
    kept += words[command * DRAW_INDIRECT_WORDS + 1];
  return kept;
}
