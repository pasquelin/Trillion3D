import { codeForBounds, codeForScene } from './codeScene.js';
import { codeForTransform, codeForVector } from './codeSpatial.js';

export function codeFor(id, state) {
  if (['compose-transform', 'matrix-chain', 'perspective', 'frustum'].includes(id))
    return codeForTransform(id, state);
  if (['dot-product', 'cross-product', 'normalize'].includes(id)) return codeForVector(id, state);
  if (['box-grow', 'sphere-from-box'].includes(id)) return codeForBounds(id, state);
  return codeForScene(id, state);
}
