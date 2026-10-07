/**
 * A plan entry: the item rank, the vertex-cull bit, the SHARE bit, then the pipeline in the low
 * four — five blend modes of three culls, the cull mode being the pipeline modulo three.
 *
 * The share bit is in the entry, so the plan splits a pass into its main class and its own entries
 * (`plan.ts`, `runs.ts`) from the entries alone.
 *
 * VERTEX CULL: the back and the face of a double-sided paged item keep their cull mode but set the
 * pipeline that culls nothing, and the vertex stage drops the triangles that mode culls
 * (`shader.ts`): the back and the face share one run, in the same order, back first — two
 * pipelines would each break the other's run, one call per entry on a double-sided scene. An unpaged item keeps the hardware cull: its own buffers
 * give it its own draw anyway. `runs.ts` and `expandWgsl.ts` read the low six bits from here:
 * shifting the rank without following them would let the other sites compile and decode wrong.
 */
export const PLAN_SHIFT = 6,
  PLAN_PIPELINE_MASK = 15,
  PLAN_SHARED_BIT = 16,
  PLAN_VERTEX_CULL_BIT = 32
export const planEntry = (item: number, pipeline: number, shared: boolean, vertexCull = false) =>
  (item << PLAN_SHIFT) |
  (vertexCull ? PLAN_VERTEX_CULL_BIT : 0) |
  (shared ? PLAN_SHARED_BIT : 0) |
  pipeline
