import { codeForBounds, codeForScene } from './codeScene.ts';
import { codeForTransform, codeForVector } from './codeSpatial.ts';
import { codeForAdvanced } from './codeAdvanced.ts';
import type { ScenarioState } from './scenarios.ts';

export function codeFor(id: string, state: ScenarioState) {
  if (
    ['matrix-inverse', 'reflection-orientation', 'quaternion-turn', 'normal-transform'].includes(id)
  )
    return codeForAdvanced(id, state);
  if (['compose-transform', 'matrix-chain', 'perspective', 'frustum'].includes(id))
    return codeForTransform(id, state);
  if (['dot-product', 'cross-product', 'normalize'].includes(id)) return codeForVector(id, state);
  if (['box-grow', 'sphere-from-box'].includes(id)) return codeForBounds(id, state);
  return codeForScene(id, state);
}
