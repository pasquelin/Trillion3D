import type { Primitive } from '../../../sdk-core/src/index.ts'
import type { MatrixElements } from '../math/matrixElements.ts'
import type { Deformed, DeformedMesh } from './frame.ts'

/** Largest source record needed by placements sharing one resource. */
export type DeformationCapacity = { joints: number; waves: number }

/**
 * The deformation a placement of `mesh` draws with, or `null`: its skeleton when its primitive's
 * pages carry joints, its morph weights when they carry targets — both measured by the compiler
 * (`primitive.deformation`) — and the waves of the water surface that carries it (`mesh.waves`),
 * which need nothing of the pages. The counts are fixed with the session: a mesh that gains a
 * source, or a surface that gains a wave, is drawn with the new one once the session opens again.
 */
export function deformedOf(
  mesh: DeformedMesh,
  primitive: Pick<Primitive, 'deformation'> | undefined,
  world: MatrixElements,
  capacity?: DeformationCapacity,
): Deformed | null {
  const measured = primitive?.deformation ?? null
  const joints = measured?.joints.length
      ? Math.max(measured.joints.length / 4, capacity?.joints ?? mesh.skeleton?.bones.length ?? 0)
      : 0,
    targets = measured?.targets.length ?? 0,
    waves = capacity?.waves ?? mesh.waves?.waveModel.count ?? 0,
    soft = measured?.softVertices ?? 0
  if (!joints && !targets && !waves && !soft) return null
  const reach = { joints: measured?.joints ?? [], targets: measured?.targets ?? [] }
  return { world, mesh, shape: { joints, targets, waves, soft }, reach }
}
