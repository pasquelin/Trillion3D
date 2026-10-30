import type { GRAPH_SHADING_MODELS } from './graph/outputs.ts'

/**
 * THE SHADING MODEL OF A MATERIAL (`MaterialParameters.shadingModel`), by the names of the models a graph's `shadingModel` output numbers
 * (`GRAPH_SHADING_MODELS`), `toon` — a model of the material's parameters alone, no graph picks it — and `fromMaterialExpression`: the graph's
 * output then decides each pixel's model. A material that names none is `defaultLit` — or, where its graph wires the `shadingModel` output,
 * the graph's, as `fromMaterialExpression`.
 */
export type MaterialShadingModel =
  keyof typeof GRAPH_SHADING_MODELS | 'toon' | 'fromMaterialExpression'
