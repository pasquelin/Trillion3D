import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts';
import type { HostMaterials } from '../../host/resources.ts';
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

/** A drawn mesh as the scene draw's walk meets it (`sceneDraw.ts`, `collect`). */
type Met = { readonly kind?: string; readonly count?: number; readonly material?: HostMaterials };

/**
 * The mode of a visible drawn mesh that keeps the chain off a frame, or `undefined`: its surface
 * visible and transparent in a mode `refusesLinear` names, an instanced one placed at least once
 * — one placed nowhere submits nothing (`renderer.ts`). Transmissive or not: a view may zero the
 * transmission before the draw (`../../lighting/unlitAlbedo.ts`), which then binds it in this mode.
 */
export function linearRefusalOf(mesh: Met): Blending | undefined {
  if (mesh.kind === 'instancedMesh' && !mesh.count) return;
  const surface = mesh.material && firstMaterial(mesh.material);
  if (!surface?.visible || !surface.transparent) return;
  const mode = blendingOf(surface.blending as number | undefined);
  return refusesLinear(mode) ? mode : undefined;
}
