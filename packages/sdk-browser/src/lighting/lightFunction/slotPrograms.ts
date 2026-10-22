import {
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { lightFunctionRenderWgsl, type AtlasFormat } from './renderWgsl.ts'
import { ATLAS_TEXTURE_FORMAT } from './layout.ts'
import { mapLayoutEntries } from './maps.ts'
import { graphSlotWgsl, usableGraphSlot } from './graphSlot.ts'
import type { AtlasShape } from './plan.ts'

/** The bytes of a slot's parameters when it has no graph: its colour and the slot of its map. */
export const GIVEN_BYTES = 16

/** The programs that draw a slot and the layouts of their groups, made on first use. */
export interface SlotPrograms {
  readonly device: GPUDevice
  readonly programs: Map<string, PreparedPipeline<GPURenderPipeline>>
  readonly layouts: Map<string, GPUBindGroupLayout>
}

export const createSlotPrograms = (device: GPUDevice): SlotPrograms => ({
  device,
  programs: new Map(),
  layouts: new Map(),
})

/** The layout of a program whose parameters take `bytes`, with the colour atlas when `mapped`. */
export function layoutOf({ device, layouts }: SlotPrograms, bytes: number, mapped: boolean) {
  const key = `${bytes}|${mapped}`
  let layout = layouts.get(key)
  if (!layout) {
    const entry = computeUniformEntry(
      0,
      { hasDynamicOffset: true, minBindingSize: bytes },
      GPUShaderStage.FRAGMENT,
    )
    const entries = [entry, ...(mapped ? mapLayoutEntries() : [])]
    layouts.set(key, (layout = device.createBindGroupLayout({ entries })))
  }
  return layout
}

/** The program that draws `material` at `at` and `format`, its compile started on first use: the
 *  material's graph when it has one that compiles, else its colour and map. */
export function programOf(
  set: SlotPrograms,
  material: Material,
  at: AtlasShape,
  format: AtlasFormat,
) {
  const { device, programs } = set
  const graph = usableGraphSlot(material)
  const mapped = graph ? graph.textured : !!material.emissiveMap
  const key = `${format}|${at.slot}|${graph ? graph.compiled.wgsl.name : mapped}`
  let program = programs.get(key)
  if (!program) {
    const label = `Trillion3D light function ${key}`
    const module = device.createShaderModule({
      label,
      code: graph
        ? graphSlotWgsl(at.slot, format, graph)
        : lightFunctionRenderWgsl(at.slot, format, mapped),
    })
    const layout = layoutOf(set, graph?.bytes ?? GIVEN_BYTES, mapped)
    const targets = [{ format: ATLAS_TEXTURE_FORMAT }]
    program = preparedPipeline(
      device,
      fullscreenDescriptor(device, module, layout, 'slotTexel', targets, label),
    )
    programs.set(key, program)
  }
  return program
}
