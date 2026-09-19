import type { DagWarning } from './dagContracts.ts';
import type { Primitive } from './geometryContracts.ts';

/** A compiler warning attached to the primitive carrying it. */
export type PrimitiveDagWarning = DagWarning & { index: number; mesh: number; primitive: number };

/**
 * The `dag-warnings` diagnostic of a cache: reports primitives flagged by the compiler.
 */
export function dagWarningsDiagnostic(primitives: readonly Primitive[]) {
  const warnings: PrimitiveDagWarning[] = primitives.flatMap((p, index) =>
    (p.dag?.warnings ?? []).map((w) => ({ ...w, index, mesh: p.mesh, primitive: p.primitive })),
  );
  if (!warnings.length) return null;
  return {
    phase: 'dag-warnings',
    message: `${warnings.length} primitive(s) without unique root: flagged by compiler`,
    context: { count: warnings.length, primitives: warnings },
  };
}
