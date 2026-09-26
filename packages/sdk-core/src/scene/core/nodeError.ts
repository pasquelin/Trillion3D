import { EngineError } from '../../contracts/cache.ts';
import type { SceneState } from './nodeContracts.ts';

export function sceneNodeFail(
  code: string,
  message: string,
  context: Record<string, unknown>,
): never {
  throw new EngineError(code, message, context);
}

export function sceneNodeVisibility(value: boolean | undefined, allowDefault = true) {
  if ((!allowDefault || value !== undefined) && typeof value !== 'boolean')
    sceneNodeFail('INVALID_SCENE_NODE_VISIBILITY', 'Scene node visibility must be boolean', {
      visible: value,
    });
  return value ?? true;
}

/** Refuses to reparent (`SCENE_ROOT_PARENT`) or destroy (`SCENE_ROOT_DESTROY`) a scene's root. */
export function refuseSceneRoot(
  state: SceneState,
  index: number,
  refused: 'reparented' | 'destroyed' = 'reparented',
) {
  if (index === state.root?.index)
    sceneNodeFail(
      refused === 'destroyed' ? 'SCENE_ROOT_DESTROY' : 'SCENE_ROOT_PARENT',
      `A scene root cannot be ${refused}`,
      {},
    );
}
