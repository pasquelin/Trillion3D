import { recolourBlendScene } from '../../../cluster/blendSceneRecord.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** A new clear colour, `0xrrggbb`: every pass reads it from the setup at the next frame, the blend
 *  scene publishes it, and the frame is not held on the old one. */
export function setWebgpuClearColor(rt: WebgpuPagesRuntime, clearColor: number) {
  rt.setup.clearColor = clearColor;
  recolourBlendScene(rt.setup.scene, clearColor);
  rt.run.gate.sceneMoved();
}
