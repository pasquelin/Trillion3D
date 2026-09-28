// A facade-shaped file for `public-types-audit.test.ts`: an array-like union, whose synthesized
// members (`map`, `filter`…) the audit must not walk, and a union holding an SDK contract this
// file does not export, which it must still find.
import type { Box3 } from '../../packages/sdk-core/src/world/math/box3.ts';

export const samples: number[] | Float32Array = [];
export const bounds: Box3 | number[] = [];
