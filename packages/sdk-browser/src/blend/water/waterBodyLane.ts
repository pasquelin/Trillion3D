import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { vertexAsks, type CloudVertexText, type VertexReads } from '../cloudVertexText.ts'
import { INSTANCE_ITEM_MASK } from '../runs.ts'
import { allocateExtras, extraRead, extraWrite, type ExtraAsk } from '../vertexExtras.ts'

/**
 * THE WATER BODY'S LANE: in the variant of the programs compiled for a world that holds a water exclusion volume, the vertex stage
 * hands the fragment the rank of the item it draws (its place in the blend's items, `slot.x & INSTANCE_ITEM_MASK`) in one lane of
 * its extras (`vertexExtras.ts`), after those of the fog, the clouds and the object's own shadow; the fragment reads it
 * (`waterBodyRank`) to ask the exclusion table (`waterExcluded`). The value is the same at the three corners, so the interpolation
 * leaves it whole up to a rounding. The extras of every program hold at most two members (seven lanes at most), so the lane
 * always finds room in the sixteen locations a stage is granted with the front-face flag: no program is left without the cut.
 */
const WATER_BODY_ASK: ExtraAsk = { name: 'waterBody', lanes: 1 }
const SELF_SHADOW_ASK: ExtraAsk = { name: 'selfShadow', lanes: 1 }

/** The asks of a program that reads `reads` (with the lane of the object's own shadow where `selfShadow`), in the order the lanes are
 *  allocated: the fog's and the clouds', the object's shadow, the water body's last. The one list the lanes of the program come from. */
export const programAsks = (
  reads: VertexReads,
  selfShadow: boolean,
  waterBody: boolean,
): ExtraAsk[] => [
  ...vertexAsks(reads),
  ...(selfShadow ? [SELF_SHADOW_ASK] : []),
  ...(waterBody ? [WATER_BODY_ASK] : []),
]

/** `base`, the words of a program that reads `reads` (with the lane of the object's shadow where `selfShadow`), with the lane added:
 *  the statement that writes the rank and the function that reads it. */
export function withWaterBody(
  base: CloudVertexText,
  reads: VertexReads,
  selfShadow: boolean,
): CloudVertexText {
  const extras = allocateExtras(programAsks(reads, selfShadow, true))
  const place = extras.places.waterBody
  return {
    ...base,
    key: `${base.key}, waterBody`,
    declared: [
      ...base.declared,
      wgslBlock(
        `WATER_BODY_RANK_WGSL(${extraRead(place)})`,
        [],
        `fn waterBodyRank(in:VSOut)->u32{return u32(round(${extraRead(place)}));}`,
      ),
    ],
    extras: extras.members,
    vertexLanes: `${base.vertexLanes}${extraWrite(place, `f32(slot.x&${INSTANCE_ITEM_MASK}u)`)}
 `,
  }
}
