import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import { MAP_BINDINGS, MAP_SAMPLER_BINDING } from './mapBindings.ts'
import { lightFunctionTextures } from './graphSlot.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { appendWebgpuTexture } from '../../frame/io/appendTexture.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The layout entries of the colour atlas a mapped program reads, and its sampler. */
export const mapLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  ...atlasLayoutEntries(MAP_BINDINGS),
  {
    binding: MAP_SAMPLER_BINDING,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: { type: 'filtering' },
  },
]

/** What the atlas draws a mapped slot with: the texture's place in the colour atlas, once it has
 *  one, and the bind group entries of the atlas's pools. */
export interface LightFunctionMaps {
  /** The texture's slot in the colour atlas; none while it has not joined it. */
  slotOf(texture: Texture): number | undefined
  /** Whether the map of `material` is read at the detail a slot of `slot` texels shows (`mapWarm`). */
  warm(material: Material, slot: number): boolean
  /** The colour atlas's pools, page table and sampler as entries of a bind group, or none. */
  entries(): GPUBindGroupEntry[] | undefined
}

/** The textures being taken into the atlas, per runtime, and those it refused. */
const joining = new WeakMap<object, { pending: Set<Texture>; refused: WeakSet<Texture> }>()

/** The map of `material`, taken into the colour atlas of the materials like a created material's
 *  (`appendWebgpuTexture`), within its texture budget: the append runs once, the slot is there
 *  from a later image. A refusal is named by the runtime's diagnostics and not tried again. */
function join(rt: WebgpuPagesRuntime, material: Material, texture: Texture) {
  let state = joining.get(rt)
  if (!state) joining.set(rt, (state = { pending: new Set(), refused: new WeakSet() }))
  if (state.pending.has(texture) || state.refused.has(texture)) return
  state.pending.add(texture)
  rt.setup.texturePools?.coverage.read(surfaceOf(material as never))
  appendWebgpuTexture(rt, texture, 'color')
    .catch((error: unknown) => {
      state.refused.add(texture)
      rt.diag.engineDiagnostic(
        'light-function-texture-refused',
        'A light function map was refused',
        {
          reason: error instanceof Error ? error.message : String(error),
        },
      )
    })
    .finally(() => state.pending.delete(texture))
}

/** The pixels of `texture` a slot of `slot` texels shows: the slot across the texture's repeat. */
const pixelsShown = (texture: Texture, slot: number) => {
  const m = texture.transform
  return slot * Math.max(1, length2(m[0], m[1]), length2(m[3], m[4]))
}

/**
 * Whether the textures of `material` — its graph's, else its emissive map — are read at the detail
 * its slot shows: each joined the colour atlas and its tiles of that level are resident (`warm`,
 * which asks the missing ones beside the feedback). True for a material with none.
 */
export function mapWarm(rt: WebgpuPagesRuntime, material: Material, slot: number) {
  let warm = true
  for (const texture of lightFunctionTextures(material)) {
    const place = rt.vis.mapLayer.get(texture)
    if (place === undefined) {
      join(rt, material, texture)
      warm = false
    } else {
      const ready = rt.vis.textures?.warm('color', place, pixelsShown(texture, slot), rt.run.frame)
      warm = (ready ?? false) && warm
    }
  }
  return warm
}

/** The maps the atlas draws with, read live from the runtime. */
export const mapsOf = (rt: WebgpuPagesRuntime): LightFunctionMaps => ({
  slotOf: (texture) => rt.vis.mapLayer.get(texture),
  warm: (material, slot) => mapWarm(rt, material, slot),
  entries() {
    const atlas = rt.vis.textures?.color,
      sampler = rt.vis.mapsSampler
    if (!atlas || !sampler) return undefined
    return [
      ...MAP_BINDINGS.lanes.map((binding, lane) => ({ binding, resource: atlas.views[lane] })),
      { binding: MAP_BINDINGS.pages, resource: { buffer: atlas.pages.buffer } },
      { binding: MAP_SAMPLER_BINDING, resource: sampler },
    ]
  },
})
