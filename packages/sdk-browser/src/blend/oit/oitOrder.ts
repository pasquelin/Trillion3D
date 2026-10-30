import type { CloudVertexText } from '../cloudVertexText.ts'
import { ORDER_WORD } from '../vertexReadsWgsl.ts'

/**
 * THE ORDER OF A PRIMITIVE IN THE PASS, which the combination sorts a pixel's fragments by (`oitWgsl.ts`): the order the reference's
 * raster-ordered insertion sees them in, whatever order the fragments reach the buffer. The key is a pair of words. The vertex stage writes the
 * first flat in the fourth word of `words` (`ORDER_WORD`), in the programs that sort per pixel alone: the rank of the plan instance the vertex
 * belongs to (the index into the expanded list, `planInstances`, which the runs lay in paint order: slot after slot, entry after entry inside a
 * draw), whole, so that it wraps only past 2^32 instances. The second is the triangle's rank in its cluster, which the first word `tri` of
 * `words` already carries in its low bits (`WORDS`).
 */
export const withOitOrder = (base: CloudVertexText): CloudVertexText => ({
  ...base,
  key: `${base.key}, oitOrder`,
  ordered: true,
  vertexLanes: `${base.vertexLanes}out.${ORDER_WORD}=(vertexIndex>>uni.vertexShift)+instance;
 `,
})
