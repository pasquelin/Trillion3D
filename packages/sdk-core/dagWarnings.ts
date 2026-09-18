import type { DagWarning } from './dagContracts.ts';
import type { Primitive } from './geometryContracts.ts';

/** Un avertissement du compilateur, rattaché à la primitive qui le porte. */
export type PrimitiveDagWarning = DagWarning & { index: number; mesh: number; primitive: number };

/**
 * Le diagnostic `dag-warnings` d'un cache : un seul, avec toutes les primitives que le compilateur
 * a nommées, ou aucun. Le moteur ne juge rien ici : il relit ce que le compilateur a écrit, pour
 * le dire à l'ouverture plutôt que de dessiner fin à toute distance sans un mot.
 */
export function dagWarningsDiagnostic(primitives: readonly Primitive[]) {
  const warnings: PrimitiveDagWarning[] = primitives.flatMap((p, index) =>
    (p.dag?.warnings ?? []).map((w) => ({ ...w, index, mesh: p.mesh, primitive: p.primitive })),
  );
  if (!warnings.length) return null;
  return {
    phase: 'dag-warnings',
    message: `${warnings.length} primitive(s) sans racine unique : le compilateur les a nommées`,
    context: { count: warnings.length, primitives: warnings },
  };
}
