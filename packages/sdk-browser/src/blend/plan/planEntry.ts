/**
 * A plan entry: the item rank, the vertex-cull bit, a bit kept at zero, then the pipeline in the
 * low five — five blend modes of three culls, then the transmissive items' three (`TRANSMIT_BASE`)
 * and the refracting ones' three (`REFRACT_BASE`), the cull mode being the pipeline modulo three. Every
 * entry draws clusters through the one shared group: the plan splits a pass into its main class
 * and its own entries (`plan.ts`, `../runs.ts`) by pipeline alone.
 *
 * VERTEX CULL: the back and the face of a double-sided item keep their cull mode but set the
 * pipeline that culls nothing, and the vertex stage drops the triangles that mode culls
 * (`../shader.ts`): the back and the face share one run, in the same order, back first — two
 * pipelines would each break the other's run, one call per entry on a double-sided scene.
 * `../runs.ts` and `../expand/expandWgsl.ts` read the low seven bits from here: shifting the rank without
 * following them would let the other sites compile and decode wrong.
 */
export const PLAN_SHIFT = 7,
  PLAN_PIPELINE_MASK = 31,
  PLAN_VERTEX_CULL_BIT = 64
export const planEntry = (item: number, pipeline: number, vertexCull = false) =>
  (item << PLAN_SHIFT) | (vertexCull ? PLAN_VERTEX_CULL_BIT : 0) | pipeline
