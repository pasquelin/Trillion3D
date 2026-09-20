import { EngineError } from './cacheContracts.ts';

export function sceneNodeFail(
  code: string,
  message: string,
  context: Record<string, unknown>,
): never {
  throw new EngineError(code, message, context);
}

export function sceneNodeVisibility(value: boolean | undefined) {
  if (value !== undefined && typeof value !== 'boolean')
    sceneNodeFail('INVALID_SCENE_NODE_VISIBILITY', 'Scene node visibility must be boolean', {
      visible: value,
    });
  return value ?? true;
}
