import { maxStretch } from '../../../../sdk-core/src/index.ts';
import type { MatrixElements } from '../../math/matrixElements.ts';

export function worldStretch(root: {
  world: MatrixElements;
  stretch?: number;
  stretchKey?: Float64Array;
}) {
  const m = root.world.elements,
    key = root.stretchKey;
  if (
    key &&
    key[0] === m[0] &&
    key[1] === m[1] &&
    key[2] === m[2] &&
    key[3] === m[4] &&
    key[4] === m[5] &&
    key[5] === m[6] &&
    key[6] === m[8] &&
    key[7] === m[9] &&
    key[8] === m[10]
  )
    return root.stretch as number;
  const next = key ?? (root.stretchKey = new Float64Array(9));
  next[0] = m[0];
  next[1] = m[1];
  next[2] = m[2];
  next[3] = m[4];
  next[4] = m[5];
  next[5] = m[6];
  next[6] = m[8];
  next[7] = m[9];
  next[8] = m[10];
  return (root.stretch = maxStretch(m));
}
