// The bench's hands on the engine's shaders: which shader modules each pass runs (so a pass can be
// told its cut points), and, in a dissect play, the one module that is made cut at a point — in
// memory, when the engine creates it, so the engine's sources are never written.
import { hookAfter, onMade, type Proto } from './hook.ts'
import { cutAt, cutsOf, hashOf } from './shaderCuts.ts'

/** What a dissect play is asked: the pass whose shaders are listed, and the module (by hash) and
 *  cut it runs stopped at; `cut` null runs the module whole. */
export type DissectSpec = { pass: string; hash: string; cut: string | null }

/** The modules a pass ran, by pass label: each by hash, with its cut points. */
export type DissectModules = Record<string, { hash: string; cuts: string[] }[]>

/** A module's text, its hash and its cut points, read once when it is made. */
const infos = new WeakMap<object, { hash: string; cuts: string[] }>()
const pipelines = new WeakMap<object, object[]>()
const seen = new Map<string, Map<string, string[]>>()
let active: DissectSpec | null = null

/** Changes the cut the next modules are made with: a proof runs every variant in one process. */
export function setDissect(spec: DissectSpec | null) {
  active = spec
  seen.clear()
}

/** The spec this process dissects by, or null. */
export const dissectSpec = () => active

/** The spec the parent gave this process, or null in a play that dissects nothing. */
export const readSpec = (text: string | undefined): DissectSpec | null =>
  text ? (JSON.parse(text) as DissectSpec) : null

/** Hooks module creation (applying the cut), pipeline creation and `setPipeline`, so each pass
 *  records the modules of the pipelines it sets. `labelOf` gives a pass encoder's label. */
export function installDissect(
  g: Record<string, { prototype: Proto }>,
  first: DissectSpec | null,
  labelOf: (pass: object) => string | undefined,
) {
  active = first
  const device = g.GPUDevice.prototype
  const make = device.createShaderModule
  device.createShaderModule = function (this: object, descriptor: GPUShaderModuleDescriptor) {
    const { code } = descriptor
    const cut = active?.cut && hashOf(code) === active.hash ? cutAt(code, active.cut) : code
    const module = make.call(
      this,
      (cut === code ? descriptor : { ...descriptor, code: cut }) as never,
    )
    if (active)
      infos.set(module as object, { hash: hashOf(code), cuts: cutsOf(code).map((c) => c.name) })
    return module
  } as never
  const modulesOf = (d: GPURenderPipelineDescriptor & GPUComputePipelineDescriptor) =>
    [d.compute?.module, d.vertex?.module, d.fragment?.module].filter(Boolean) as object[]
  for (const name of [
    'createComputePipeline',
    'createRenderPipeline',
    'createComputePipelineAsync',
    'createRenderPipelineAsync',
  ])
    hookAfter(device, name, (_self, [d], made) => {
      const modules = modulesOf(d as never)
      onMade(made, (pipeline) => pipelines.set(pipeline, modules))
    })
  for (const kind of ['GPUComputePassEncoder', 'GPURenderPassEncoder'])
    hookAfter(g[kind].prototype, 'setPipeline', (self, [pipeline]) => {
      const label = labelOf(self)
      if (!active || !label || !label.includes(active.pass)) return
      for (const module of pipelines.get(pipeline as object) ?? []) {
        const info = infos.get(module)
        if (!info) continue
        const modules = seen.get(label) ?? new Map<string, string[]>()
        modules.set(info.hash, info.cuts)
        seen.set(label, modules)
      }
    })
}

/** The modules each pass ran so far that holds a cut point or belongs to `pass`. */
export function dissectModules(pass: string): DissectModules {
  const out: DissectModules = {}
  for (const [label, modules] of seen)
    if (label.includes(pass)) out[label] = [...modules].map(([hash, cuts]) => ({ hash, cuts }))
  return out
}
