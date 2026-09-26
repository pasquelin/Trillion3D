import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { HostScene } from '../../host/resources.ts';
import { isDrawnNode, isInstancedNode } from '../../host/graph/kinds.ts';
import { blendingOf, blendingRefusal } from '../../scene/materialBlending.ts';
import { isTransmissive } from '../../visibility/shader/material.ts';
import { firstMaterial } from '../../scene/materialSide.ts';

/** The modes the effect chain's linear target cannot hold (`refusesLinear`). */
export type LinearRefusedBlending = Extract<Blending, 'multiply' | 'subtractive'>;

/**
 * Whether a transparent surface in `mode` cannot be drawn into the effect chain's linear target,
 * whose alpha is coverage over transparent black (`../../effects/webglOutput.ts`): multiply and
 * subtractive filter what the display target holds, the background included, which that target
 * does not hold. WebGPU composes them with the chain; WebGL2 draws such a frame without it.
 */
export const refusesLinear = (mode: Blending | undefined): mode is LinearRefusedBlending =>
  mode === 'multiply' || mode === 'subtractive';

type Walked = { readonly visible?: boolean; readonly children?: readonly Walked[] };

function refusalUnder(nodes: readonly Walked[]): LinearRefusedBlending | undefined {
  for (const node of nodes) {
    if (!node.visible) continue;
    // An instanced mesh placed nowhere submits nothing (`renderer.ts`): it keeps no chain off.
    const drawn = isDrawnNode(node) && !(isInstancedNode(node) && !node.count);
    const surface = drawn ? firstMaterial(node.material) : undefined;
    const mode =
      surface?.visible && surface.transparent
        ? blendingOf(surface.blending as number | undefined)
        : undefined;
    // A mode no path draws for this surface is the draw's own refusal (`blendingRefusal`), named
    // there: only the modes every path draws but the linear target cannot hold are read here.
    if (refusesLinear(mode) && !blendingRefusal(mode, isTransmissive(surface!))) return mode;
    const below = refusalUnder(node.children ?? []);
    if (below) return below;
  }
}

/**
 * The mode of the first surface the scene draw would draw (`sceneDraw.ts`: a visible mesh under
 * visible parents, its surface visible, an instanced one placed at least once) that the linear target cannot hold, or `undefined`. Read
 * before the chain binds its target, on a frame the composer draws: the frame is then drawn
 * without the chain, never stopped in the middle of its draw. It reads the scene, not what the
 * camera culls: the chain does not blink on and off as such a surface enters and leaves the view.
 */
export const linearRefusal = (scene: HostScene) =>
  refusalUnder(scene.children as readonly Walked[]);
