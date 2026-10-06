import type { PrimitiveDagWarning } from './dag.ts'
import type { ClusterManifest } from './geometry.ts'

/**
 * The `dag-warnings` diagnostic of a cache: the primitives flagged by the compiler, and the
 * compiler's stall table (`worstStalls`), the rows it tells on stderr at the end of a cook, in its
 * order.
 */
export function dagWarningsDiagnostic(
  manifest: Pick<ClusterManifest, 'primitives' | 'worstStalls'>,
) {
  const { primitives, worstStalls: stalled = [] } = manifest
  const warnings: PrimitiveDagWarning[] = primitives.flatMap((p, index) =>
    (p.dag?.warnings ?? []).map((w) => ({ ...w, index, mesh: p.mesh, primitive: p.primitive })),
  )
  if (!warnings.length && !stalled.length) return null
  return {
    phase: 'dag-warnings',
    message:
      `${warnings.length} primitive(s) without unique root: flagged by compiler; ` +
      `${stalled.length} in the compiler's stall table`,
    context: { count: warnings.length, primitives: warnings, stalled },
  }
}
