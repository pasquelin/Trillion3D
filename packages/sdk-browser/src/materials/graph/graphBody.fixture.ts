// What the tests of the graph's text share: a graph built by `build` into the emission, compiled, and the
// lines of its function; the constant it returns; a channel of the first texture coordinate set.
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import type { Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import { compileGraph, type CompileOptions } from './compile.ts'
import { COLOR_SAMPLE_WGSL } from '../virtual/wgsl.ts'
export type Graph = ReturnType<typeof material.graph>
export const body = (build: (g: Graph) => Pin, options: Partial<CompileOptions> = {}) => {
  const g = material.graph('surface')
  g.output('emissive', build(g))
  return compileGraph(g, { sample: COLOR_SAMPLE_WGSL, derivatives: 'neighbours', ...options })
    .outputs[0].body
}
/** The components of the constant a graph returns, repeated into the emission's three. */
export const constant = (text: string) =>
  text
    .match(/return vec3f\(([^)]*)\);/)![1]
    .split(',')
    .map((x) => Math.fround(Number(x)))
export const uv = (g: Graph, channel: string) => g.componentMask(g.texCoord(0), channel)
