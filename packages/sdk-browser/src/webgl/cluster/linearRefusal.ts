import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { HostScene } from '../../host/resources.ts';
import { isDrawnNode, isInstancedNode } from '../../host/graph/kinds.ts';
import { blendingOf } from '../../scene/materialBlending.ts';
import { firstMaterial } from '../../scene/materialSide.ts';

/**
 * Whether a transparent surface in `mode` cannot be drawn into the effect chain's linear target,
 * whose alpha is coverage over transparent black (`../../effects/webglOutput.ts`): multiply and
 * subtractive filter what the display target holds, the background included, which that target
 * does not hold. WebGPU composes them with the chain; WebGL2 draws such a frame without it.
 */
export const refusesLinear = (mode: Blending | undefined) =>
  mode === 'multiply' || mode === 'subtractive';

/** A node as the walk reads it: a published graph's nodes are objects of any shape. */
type Walked = { readonly visible?: boolean; readonly children?: readonly object[] };
const LEAF: readonly object[] = [];

function refusalUnder(nodes: readonly object[]): Blending | undefined {
  for (const node of nodes as readonly Walked[]) {
    if (!node.visible) continue;
    // An instanced mesh placed nowhere submits nothing (`renderer.ts`): it keeps no chain off.
    if (isDrawnNode(node) && !(isInstancedNode(node) && !node.count)) {
      const surface = firstMaterial(node.material);
      if (surface?.visible && surface.transparent) {
        // Transmissive or not: a view may zero the transmission before the draw
        // (`../../lighting/unlitAlbedo.ts`), which then binds the surface in this mode.
        const mode = blendingOf(surface.blending as number | undefined);
        if (refusesLinear(mode)) return mode;
      }
    }
    const below = refusalUnder(node.children ?? LEAF);
    if (below) return below;
  }
}

/**
 * The mode of the first surface the scene draw would draw (`sceneDraw.ts`: a visible mesh under
 * visible parents, its surface visible and transparent, an instanced one placed at least once)
 * that the linear target cannot hold (`refusesLinear`), or `undefined`. Read before the chain
 * binds its target, the frame is then drawn whole without the chain, never stopped mid-draw. It
 * reads the scene, not what the camera culls: the chain does not blink as such a surface enters
 * and leaves the view.
 */
export const linearRefusal = (scene: HostScene) => refusalUnder(scene.children);
