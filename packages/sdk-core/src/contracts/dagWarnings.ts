import type { DagStallSummary, DagWarning } from './dag.ts';
import type { Primitive } from './geometry.ts';

/** A compiler warning attached to the primitive carrying it, and where it sits in the cache. */
export type PrimitiveDagWarning = DagWarning & { index: number; mesh: number; primitive: number };
/** The stall summary of a primitive with at least one stalled group, warned about or not. */
export type PrimitiveDagStall = DagStallSummary & Omit<PrimitiveDagWarning, keyof DagWarning>;

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
            rootTriangles: dag.rootTriangles,
            cause: dag.cause,
            seamVertices: dag.seamVertices,
            lockedVertices: dag.lockedVertices,
            uvIslands: dag.uvIslands,
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
