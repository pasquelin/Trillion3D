/**
 * The root of a display graph the engine draws itself: the nodes it holds, the colour behind
 * them, and the two hooks a view wraps a draw in — the unlit view zeroes a few surface factors
 * before and gives them back after (`../../lighting/unlitAlbedo.ts`).
 */
import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { GraphNode } from './node.ts';

export class GraphScene extends GraphNode {
  /** Always `true`: tells the root of a display graph apart. */
  readonly isScene = true as const;
  override type = 'Scene';
  /** What the frame is cleared with; `null` clears to black. */
  background: Color | null = null;
  /** Called by the draw before it reads the graph. */
  onBeforeRender = () => {};
  /** Called by the draw once it is done. */
  onAfterRender = () => {};
}
