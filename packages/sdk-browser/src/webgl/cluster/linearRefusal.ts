import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { HostMaterials } from '../../host/resources.ts';
import { isInstancedNode } from '../../host/graph/kinds.ts';
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

/**
 * The mode of a visible see-through mesh the scene draw's walk met (`sceneDraw.ts`) that keeps the
 * chain off a frame, or `undefined`: its surface visible and transparent in a mode `refusesLinear`
 * names, an instanced one placed at least once — one placed nowhere submits nothing
 * (`renderer.ts`). Transmissive or not: a view may zero the transmission before the draw
 * (`../../lighting/unlitAlbedo.ts`), which then binds it in this mode.
 */
export function linearRefusalOf(mesh: { readonly material?: HostMaterials }): Blending | undefined {
  if (!mesh.material || (isInstancedNode(mesh) && !mesh.count)) return;
  const surface = firstMaterial(mesh.material);
  if (!surface?.visible || !surface.transparent) return;
  const mode = blendingOf(surface.blending as number | undefined);
  return refusesLinear(mode) ? mode : undefined;
}
