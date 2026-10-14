import { COMPUTE } from './computeBindings.ts'
import { functionsOf } from '../../texture/shaderRule.fixture.ts'

/**
 * Group-0 buffer bindings a WGSL text declares, as the layout type each one requires: what a
 * test holds a published `*BindEntries()` against, so the entries cannot drift from the shader.
 */
export function wgslBufferBindings(shader: string) {
  const declared = /@group\(0\)\s*@binding\((\d+)\)\s*var<([^>]*)>/g
  return Array.from(shader.matchAll(declared), ([, binding, space]) => {
    const [kind, access = 'read'] = space.split(',').map((part) => part.trim())
    const type: GPUBufferBindingType =
      kind === 'uniform' ? 'uniform' : access === 'read' ? 'read-only-storage' : 'storage'
    return { binding: Number(binding), type }
  }).sort((a, b) => a.binding - b.binding)
}

/** The same pairs, read from the layout entries. Every entry must be a compute-stage buffer. */
export const entryBufferBindings = (entries: GPUBindGroupLayoutEntry[]) =>
  entries.map(({ binding, visibility, buffer }) => ({
    binding,
    type: visibility === COMPUTE ? buffer?.type : undefined,
  }))

/** Group-0 texture bindings a WGSL text declares: what the layout's texture entries must be. */
export const wgslTextureBindings = (shader: string) =>
  Array.from(shader.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var\s+\w+\s*:\s*texture_/g), (m) =>
    Number(m[1]),
  ).sort((a, b) => a - b)

/**
 * Per entry point of a WGSL text, its stage and the group-0 bindings its code names, its calls
 * followed (a member access, `x.name`, names none): what the layout must show to that stage.
 */
export function wgslStageBindings(shader: string) {
  const functions = new Set(Array.from(shader.matchAll(/\bfn (\w+)\(/g), (m) => m[1]))
  const globals = new Map(
    Array.from(
      shader.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var(?:<[^>]*>)?\s*(\w+)/g),
      (m) => [m[2], Number(m[1])] as const,
    ),
  )
  return Array.from(shader.matchAll(/@(vertex|fragment|compute)\b[^{]*?\bfn (\w+)\(/g), (m) => {
    const reached = new Set([m[2]]),
      bindings = new Set<number>()
    for (const name of reached)
      for (const word of functionsOf(shader, [name]).match(/(?<![.\w])[A-Za-z_]\w*/g) ?? []) {
        if (functions.has(word)) reached.add(word)
        const binding = globals.get(word)
        if (binding !== undefined) bindings.add(binding)
      }
    return { stage: m[1] as 'vertex' | 'fragment' | 'compute', entry: m[2], bindings }
  })
}

/**
 * The bind group layouts a compute text declares, every group's every binding seen by the compute
 * stage — what a pipeline made with `layout: 'auto'` binds at most —: a uniform or storage buffer,
 * a storage texture, or a sampled one. What a test counts a program's stage limits from.
 */
export function wgslComputeLayout(shader: string): GPUPipelineLayoutDescriptor {
  const groups: GPUBindGroupLayoutEntry[][] = []
  const declared = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(<[^>]*>)?\s*\w+\s*:\s*(\w+)/g
  for (const [, group, binding, space, type] of shader.matchAll(declared)) {
    const entry: GPUBindGroupLayoutEntry = { binding: Number(binding), visibility: COMPUTE }
    if (space?.includes('uniform')) entry.buffer = { type: 'uniform' }
    else if (space) entry.buffer = { type: 'storage' }
    else if (type.startsWith('texture_storage')) entry.storageTexture = { format: 'r32uint' }
    else if (type.startsWith('texture_')) entry.texture = {}
    else entry.sampler = {}
    ;(groups[Number(group)] ??= []).push(entry)
  }
  return {
    bindGroupLayouts: Array.from(groups, (entries) => ({ entries: entries ?? [] })) as never,
  }
}
