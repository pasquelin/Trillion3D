import { recolourBlendScene } from '../../../cluster/blendSceneRecord.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A new clear colour, `0xrrggbb`: every pass reads it at the next frame, the blend scene
 *  publishes it, and the held frame is broken — the resource revision alone, nothing walked. */
export function setWebgpuClearColor(rt: WebgpuPagesRuntime, clearColor: number) {
  rt.run.clearColor = clearColor;
  recolourBlendScene(rt.setup.scene, clearColor);
  rt.run.gate.resourcesChanged();
}
