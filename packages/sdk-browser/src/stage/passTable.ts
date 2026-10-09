import {
  WEBGPU_STAGES,
  type GpuPassBlock,
  type PassDeclaration,
  type PassFiling,
  type WebgpuStage,
} from './passDeclaration.ts'
import { ENGINE_PASSES, VSM_PASSES } from './passLabels.ts'
import { WATER_PASSES } from '../webgpu/water/passLabels.ts'
import { MIPS_PASSES } from '../texture/mipsPass.ts'
import { REFLECTION_SOURCE_PASSES } from '../reflections/sourcePass.ts'
import { DEFORMATION_PASSES } from '../deformation/pass.ts'

/** A pass's row: its stage, that stage's index in `WEBGPU_STAGES`, and its block. */
export type PassRow = {
  readonly stage: WebgpuStage
  readonly at: number
  readonly block: GpuPassBlock
}

/**
 * Every pass the engine begins, as its label module declares it (`passDeclaration.ts`). The labels
 * come from the label modules the passes read their own from: an import of the passes would put
 * them and their shaders in the CDN core, ahead of the renderer's own chunk, which the page
 * downloads beside the scene (#1353).
 */
export const DECLARED_PASSES: readonly PassDeclaration[] = [
  ...ENGINE_PASSES,
  ...WATER_PASSES,
  ...MIPS_PASSES,
  ...REFLECTION_SOURCE_PASSES,
  ...DEFORMATION_PASSES,
]

const rowOf = ({ stage, block }: PassFiling): PassRow =>
  Object.freeze({ stage, at: WEBGPU_STAGES.indexOf(stage), block })

const ROWS = new Map(DECLARED_PASSES.map((pass) => [pass.label, rowOf(pass)]))
const FAMILIES = [VSM_PASSES].map((family) => ({ prefix: family.prefix, row: rowOf(family) }))

/**
 * Profile stage and comparison block of a GPU pass, read from the label it carries: its declared
 * row, or its family's by the prefix its label opens with. This is the only read of deposit
 * labels: direct-light durations, the per-stage profile and the blocks share it. A label no
 * declaration names has no row: it joins no stage and no block, so it never swells either.
 */
export function passRowOf(label: string): PassRow | undefined {
  const row = ROWS.get(label)
  if (row) return row
  for (const family of FAMILIES) if (label.startsWith(family.prefix)) return family.row
  return undefined
}
