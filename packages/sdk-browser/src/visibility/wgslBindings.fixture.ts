import { wgslSource, type WgslSource } from '../../../math/src/wgsl/source.fixture.ts'

/** The binding of each variable of a shader's group 0, read off the shipped text: what a fake
 *  device finds the dispatch's buffers at, never a copy of the table. */
export function wgslBindings(input: WgslSource) {
  const found: Record<string, number> = {}
  for (const [, binding, name] of wgslSource(input).matchAll(
    /@group\(0\) @binding\((\d+)\) var(?:<[^>]*>)? (\w+):/g,
  ))
    found[name] = Number(binding)
  return found
}
