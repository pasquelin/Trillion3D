import { functionsOf } from '../../materials/texture/shaderRule.fixture.ts'

/** What a WGSL text declares of one binding: its group, number, name and the layout entry kind it needs. */
export interface DeclaredBinding {
  group: number
  binding: number
  name: string
  kind: 'buffer' | 'texture' | 'storageTexture' | 'sampler'
  bufferType?: GPUBufferBindingType
  sampleType?: 'f32' | 'u32' | 'i32' | 'depth'
  dimension?: GPUTextureViewDimension
  multisampled?: boolean
  format?: string
  access?: GPUStorageTextureAccess
  samplerType?: GPUSamplerBindingType
}

const DIMENSIONS: Record<string, GPUTextureViewDimension> = {
  '1d': '1d',
  '2d': '2d',
  '2d_array': '2d-array',
  '3d': '3d',
  cube: 'cube',
  cube_array: 'cube-array',
}

/** Every `@group @binding var` a WGSL text declares, the layout entry each needs. */
export function declaredBindings(text: string): DeclaredBinding[] {
  const found: DeclaredBinding[] = []
  const declared = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]*)>)?\s+(\w+)\s*:\s*([^;]+);/g
  for (const [, group, binding, space, name, type] of text.matchAll(declared)) {
    const base = { group: Number(group), binding: Number(binding), name }
    const t = type.trim()
    if (space) {
      const [kind, access = 'read'] = space.split(',').map((part) => part.trim())
      found.push({
        ...base,
        kind: 'buffer',
        bufferType:
          kind === 'uniform' ? 'uniform' : access === 'read' ? 'read-only-storage' : 'storage',
      })
    } else if (t === 'sampler' || t === 'sampler_comparison') {
      found.push({
        ...base,
        kind: 'sampler',
        samplerType: t === 'sampler' ? 'filtering' : 'comparison',
      })
    } else if (t.startsWith('texture_storage_')) {
      const m = /texture_storage_(\w+?)<\s*(\w+)\s*,\s*(\w+)\s*>/.exec(t)!
      const access = { write: 'write-only', read: 'read-only', read_write: 'read-write' }[
        m[3]
      ] as GPUStorageTextureAccess
      found.push({
        ...base,
        kind: 'storageTexture',
        dimension: DIMENSIONS[m[1]],
        format: m[2],
        access,
      })
    } else if (t.startsWith('texture_depth_')) {
      const m = /texture_depth_(multisampled_)?(\w+)/.exec(t)!
      found.push({
        ...base,
        kind: 'texture',
        sampleType: 'depth',
        dimension: DIMENSIONS[m[2]],
        multisampled: !!m[1],
      })
    } else {
      const m = /texture_(multisampled_)?(\w+?)<\s*(\w+)\s*>/.exec(t)
      if (!m) throw new Error(`unread binding type ${t} of ${name}`)
      found.push({
        ...base,
        kind: 'texture',
        sampleType: m[3] as 'f32' | 'u32' | 'i32',
        dimension: DIMENSIONS[m[2]],
        multisampled: !!m[1],
      })
    }
  }
  return found
}

const STAGE_BIT = { vertex: 1, fragment: 2, compute: 4 } as const

/** Per entry point, its stage and the (group, binding) pairs its code names, its calls followed. */
export function reachedBindings(text: string) {
  const functions = new Set(Array.from(text.matchAll(/\bfn (\w+)\(/g), (m) => m[1]))
  const globals = new Map(declaredBindings(text).map((d) => [d.name, d] as const))
  return Array.from(text.matchAll(/@(vertex|fragment|compute)\b[^{]*?\bfn (\w+)\(/g), (m) => {
    const reached = new Set([m[2]])
    const used = new Set<DeclaredBinding>()
    for (const name of reached) {
      // The code alone: a word in a comment names nothing.
      const body = functionsOf(text, [name])
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      // A name the function declares itself (a local or a parameter) is not the global of the same name.
      const own = new Set([
        ...Array.from(body.matchAll(/\b(?:let|var(?:<[^>]*>)?|const)\s+(\w+)/g), (n) => n[1]),
        ...Array.from(
          body.slice(0, body.indexOf('{')).matchAll(/[(,]\s*(?:@\w+(?:\([^)]*\))?\s*)*(\w+)\s*:/g),
          (n) => n[1],
        ),
      ])
      for (const word of body.match(/(?<![.\w])[A-Za-z_]\w*/g) ?? []) {
        // A name the function declares itself is no call and no global.
        if (own.has(word)) continue
        if (functions.has(word)) reached.add(word)
        const declared = globals.get(word)
        if (declared) used.add(declared)
      }
    }
    return { stage: m[1] as keyof typeof STAGE_BIT, entry: m[2], used }
  })
}

/**
 * What a layout (the entries of each group) fails to give the bindings the entries of a WGSL text use: a binding missing, of another
 * kind, type, format or dimension, or not visible to the stage that uses it. One line each; none where the layout fits the text.
 */
export function layoutProblems(
  text: string,
  groups: readonly (readonly GPUBindGroupLayoutEntry[] | undefined)[],
  only?: string,
) {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const { stage, entry, used } of reachedBindings(text)) {
    if (only !== undefined && entry !== only) continue
    for (const d of used) {
      const where = `${entry}: group ${d.group} binding ${d.binding} (${d.name})`
      // A group the test made by hand, with no entries to read, is not checked.
      if (groups[d.group] === undefined && d.group < groups.length) continue
      const e = groups[d.group]?.find((candidate) => candidate.binding === d.binding)
      const say = (why: string) => {
        const line = `${where} ${why}`
        if (!seen.has(line)) (seen.add(line), problems.push(line))
      }
      if (!e) {
        say('is not in the layout')
        continue
      }
      if (!(e.visibility & STAGE_BIT[stage])) say(`is not visible to the ${stage} stage`)
      if (d.kind === 'buffer') {
        if (!e.buffer) say('is not a buffer')
        else if ((e.buffer.type ?? 'uniform') !== d.bufferType)
          say(`is a ${e.buffer.type ?? 'uniform'} buffer, the text reads a ${d.bufferType}`)
      } else if (d.kind === 'sampler') {
        const type = e.sampler?.type ?? 'filtering'
        if (!e.sampler) say('is not a sampler')
        else if ((type === 'comparison') !== (d.samplerType === 'comparison'))
          say(`is a ${type} sampler, the text reads a ${d.samplerType} one`)
      } else if (d.kind === 'storageTexture') {
        const s = e.storageTexture
        if (!s) say('is not a storage texture')
        else {
          if (s.format !== d.format) say(`has the format ${s.format}, the text reads ${d.format}`)
          if ((s.access ?? 'write-only') !== d.access)
            say(`has the access ${s.access ?? 'write-only'}, the text reads ${d.access}`)
          if ((s.viewDimension ?? '2d') !== d.dimension)
            say(`is a ${s.viewDimension ?? '2d'} view, the text reads ${d.dimension}`)
        }
      } else {
        const t = e.texture
        if (!t) say('is not a sampled texture')
        else {
          const type = t.sampleType ?? 'float'
          const ok =
            d.sampleType === 'depth'
              ? type === 'depth'
              : d.sampleType === 'u32'
                ? type === 'uint'
                : d.sampleType === 'i32'
                  ? type === 'sint'
                  : type === 'float' || type === 'unfilterable-float'
          if (!ok) say(`has the sample type ${type}, the text reads ${d.sampleType}`)
          if ((t.viewDimension ?? '2d') !== d.dimension)
            say(`is a ${t.viewDimension ?? '2d'} view, the text reads ${d.dimension}`)
          if (!!t.multisampled !== !!d.multisampled)
            say(`multisampled is ${!!t.multisampled}, the text reads ${!!d.multisampled}`)
        }
      }
    }
  }
  return problems
}
