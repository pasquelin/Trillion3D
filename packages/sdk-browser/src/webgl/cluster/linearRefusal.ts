import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { HostScene } from '../../host/resources.ts';
import { isDrawnNode } from '../../host/graph/kinds.ts';
import { blendingOf } from '../../scene/materialBlending.ts';
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

type Walked = { readonly visible?: boolean; readonly children?: readonly object[] };

function refusalUnder(nodes: readonly object[]): LinearRefusedBlending | undefined {
  for (const node of nodes) {
    if (!(node as Walked).visible) continue;
    const surface = isDrawnNode(node) ? firstMaterial(node.material) : undefined;
    const mode = surface?.visible && surface.transparent ? blendingOf(surface.blending) : undefined;
    if (refusesLinear(mode)) return mode;
    const below = refusalUnder((node as Walked).children ?? []);
    if (below) return below;
  }
}

/**
 * The mode of the first surface the scene draw would draw (`sceneDraw.ts`: a visible mesh under
 * visible parents, its surface visible) that the linear target cannot hold, or `undefined`. Read
 * before the chain binds its target, on a frame the composer draws: the frame is then drawn
 * without the chain, never stopped in the middle of its draw.
 */
export const linearRefusal = (scene: HostScene) => refusalUnder(scene.children);
