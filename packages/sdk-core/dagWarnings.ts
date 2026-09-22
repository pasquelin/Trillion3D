import type { DagStallSummary, DagWarning } from './dagContracts.ts';
import type { Primitive } from './geometryContracts.ts';

/** Where a primitive sits in the cache. */
interface PrimitiveKey {
  index: number;
  mesh: number;
  primitive: number;
}
/** A compiler warning attached to the primitive carrying it. */
export type PrimitiveDagWarning = DagWarning & PrimitiveKey;
/** The stall summary of a primitive with at least one stalled group, warned about or not. */
export type PrimitiveDagStall = DagStallSummary & PrimitiveKey;

/**
 * The `dag-warnings` diagnostic of a cache: the primitives flagged by the compiler, and every
 * primitive with a stalled group — the set the compiler ranks on stderr at the end of a cook.
 */
export function dagWarningsDiagnostic(primitives: readonly Primitive[]) {
  const warnings: PrimitiveDagWarning[] = primitives.flatMap((p, index) =>
    (p.dag?.warnings ?? []).map((w) => ({ ...w, index, mesh: p.mesh, primitive: p.primitive })),
  );
  const stalled: PrimitiveDagStall[] = primitives.flatMap(({ dag, mesh, primitive }, index) =>
    dag?.stalls?.length
      ? [
          {
            index,
            mesh,
            primitive,
            rootTriangles: dag.rootTriangles ?? 0,
            cause: dag.cause ?? null,
            seamVertices: dag.seamVertices ?? 0,
            lockedVertices: dag.lockedVertices ?? 0,
            uvIslands: dag.uvIslands ?? 0,
          },
        ]
      : [],
  );
  if (!warnings.length && !stalled.length) return null;
  return {
    phase: 'dag-warnings',
    message:
      `${warnings.length} primitive(s) without unique root: flagged by compiler; ` +
      `${stalled.length} with a stalled group`,
    context: { count: warnings.length, primitives: warnings, stalled },
  };
}
