import {
  lightShapeValues,
  readLightShapeSetting,
} from '../../../../sdk-core/src/contracts/lightShapeOptions.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { copyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { LIGHT_SHAPE_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { chainReady, preparedPipeline } from '../deferred/fullscreen.ts'
import { vsmMapSettings } from '../shadows/vsm/frame/vsmFarShadow.ts'
import { lightDrawViewOf, lightDrawn } from '../lightDrawRange.ts'
import { edgeIndices, pointMesh, rectMesh, spotMesh, type LightShapeMesh } from './meshes.ts'
import {
  DEFAULT_BARN_DOOR_DEGREES,
  DEFAULT_BARN_DOOR_LENGTH,
  LIGHT_SHAPE_BINDINGS,
  LIGHT_SHAPE_ENTRIES,
  LIGHT_SHAPE_FADE_FLOATS,
  LIGHT_SHAPE_FRAGMENT,
  LIGHT_SHAPE_INSTANCE_FLOATS,
  lightShapeShader,
} from './lightShapeWgsl.ts'

/**
 * THE LIGHT SHAPES' VISUALIZATION (`visualizeLightShape`): once the scene is in the lit image, every point, spot and rectangle light the view
 * draws is laid over it as a wireframe of its reach — the sphere of its range, the cone of a spot, the box of a rectangle between its barn
 * doors and the sphere —, in a hue of its own, faint (`visualizeLightShapeMaxOpacity`) and the fainter the nearer a surface is behind it. The
 * lights are drawn from the farthest to the nearest, each kind's run in one instanced draw of its mesh's edges (`meshes.ts`); the switch fades them in
 * (the farther ones first, by a delay growing as they near the eye) and out (all together).
 */

/** What the frame keeps of the visualization: when the switch last toggled (positive while shown, negative while fading out, 0 never), and whether the shapes still move. */
export interface LightShapeFrame {
  /** The wall clock's time of the last toggle: positive when it turned the shapes on, its negative when it turned them off, 0 for none. */
  toggle: number
  /** Whether the shapes are fading in or out: a quiet view is drawn again meanwhile. */
  animating: boolean
  instances?: GPUBuffer
  /** The fade figures' uniform buffer, written each image, and the group binding it with the view and depth it was made for. */
  fade?: UniformBlock
  group?: { readonly bound: GPUBindGroup; readonly view: GPUBuffer; readonly depth: GPUTextureView }
  readonly scratch: { data: Float32Array<ArrayBuffer> }
}

/**
 * The switch's state at the time `now`, with the fade's length `fade`: the toggle time updated (a switch on stores the time, off stores it
 * negated; a clock gone back resets it), and whether the shapes are drawn: while shown, and while a fade out has run less than `fade` seconds.
 */
export function toggledShapes(
  held: { toggle: number },
  enabled: boolean,
  now: number,
  fade: number,
) {
  if (now < held.toggle) held.toggle = 0
  const was = held.toggle > 0
  if (enabled !== was) held.toggle = was ? -now : now
  return held.toggle !== 0 && (held.toggle > 0 || now + held.toggle < fade)
}

/** The mesh of each kind of light, its vertices and the edges of its triangles on the device, once. */
const meshes = oncePerDevice((device: GPUDevice) => {
  const upload = (mesh: LightShapeMesh) => {
    const lines = edgeIndices(mesh)
    const vertices = device.createBuffer({
      label: 'Trillion3D light shape vertices',
      size: mesh.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(vertices, 0, mesh.vertices)
    // A buffer write is a multiple of four bytes: the 16-bit indices are padded to an even count.
    const padded = new Uint16Array(ceilDiv(lines.length, 2) * 2)
    padded.set(lines)
    const indices = device.createBuffer({
      label: 'Trillion3D light shape edges',
      size: padded.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(indices, 0, padded)
    return { vertices, indices, count: lines.length }
  }
  return { point: upload(pointMesh()), spot: upload(spotMesh()), rect: upload(rectMesh()) }
})

/** The pipelines, one for each kind of light, on one layout (the view, the scene's depth and the switch's figures), once a device. */
const pipelines = oncePerDevice((device: GPUDevice) => {
  const vertexFragment = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: LIGHT_SHAPE_PASS,
    entries: [
      computeBufferEntry(LIGHT_SHAPE_BINDINGS.view, 'uniform', vertexFragment),
      computeTextureEntry(LIGHT_SHAPE_BINDINGS.depth, 'depth', '2d', GPUShaderStage.FRAGMENT),
      computeBufferEntry(LIGHT_SHAPE_BINDINGS.fade, 'uniform', vertexFragment),
    ],
  })
  const module = device.createShaderModule({ label: LIGHT_SHAPE_PASS, code: lightShapeShader() })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const instanceBytes = LIGHT_SHAPE_INSTANCE_FLOATS * 4
  const buffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    {
      arrayStride: instanceBytes,
      stepMode: 'instance',
      attributes: [1, 2, 3, 4].map((shaderLocation) => ({
        shaderLocation,
        offset: (shaderLocation - 1) * 16,
        format: 'float32x4' as const,
      })),
    },
  ]
  const of = (entryPoint: string) =>
    preparedPipeline(device, {
      label: `${LIGHT_SHAPE_PASS} ${entryPoint}`,
      layout: pipelineLayout,
      vertex: { module, entryPoint, buffers },
      fragment: {
        module,
        entryPoint: LIGHT_SHAPE_FRAGMENT,
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
    })
  return {
    layout,
    point: of(LIGHT_SHAPE_ENTRIES.point),
    spot: of(LIGHT_SHAPE_ENTRIES.spot),
    rect: of(LIGHT_SHAPE_ENTRIES.rect),
  }
})

type Kind = 'point' | 'spot' | 'rect'
const KIND_OF_LIGHT: Partial<Record<number, Kind>> = {
  [LIGHT_KIND.point]: 'point',
  [LIGHT_KIND.spot]: 'spot',
  [LIGHT_KIND.rect]: 'rect',
}
/** The order of the kinds in a tie of distance: the reference sorts by distance, then kind, then position, farthest and largest first. */
const KIND_RANK: Record<Kind, number> = { point: 0, spot: 1, rect: 2 }

/** The cosine of the barn doors' angle, where the light names none. */
const BARN_COSINE = Math.cos(DEFAULT_BARN_DOOR_DEGREES * DEG2RAD)

/**
 * The record of every local light the view `draw`s, in the order they are drawn (the farthest from the eye first), written into
 * `data` (grown as needed): the instance of each (`LIGHT_SHAPE_INSTANCE_FLOATS` floats, `lightShapeWgsl.ts`), and the kind of each in order.
 */
export function lightShapeInstances(
  packed: Float32Array,
  kindOf: (slot: number) => number,
  count: number,
  eye: ArrayLike<number>,
  drawn: (slot: number) => boolean,
  held: { data: Float32Array<ArrayBuffer> },
) {
  const order: { slot: number; kind: Kind; far: number }[] = []
  for (let slot = 0; slot < count; slot++) {
    const kind = KIND_OF_LIGHT[kindOf(slot)]
    if (!kind || !drawn(slot)) continue
    const at = baseOf(slot) + LIGHT_FIELD.position
    if (!(packed[baseOf(slot) + LIGHT_FIELD.range] > 0)) continue
    const dx = packed[at] - eye[0],
      dy = packed[at + 1] - eye[1],
      dz = packed[at + 2] - eye[2]
    order.push({ slot, kind, far: dx * dx + dy * dy + dz * dz })
  }
  // Farthest first, then the later kind, then the later slot.
  order.sort((a, b) => b.far - a.far || KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.slot - a.slot)
  if (held.data.length < order.length * LIGHT_SHAPE_INSTANCE_FLOATS)
    held.data = new Float32Array(Math.max(order.length, 16) * 2 * LIGHT_SHAPE_INSTANCE_FLOATS)
  const { data } = held
  order.forEach(({ slot, kind }, at) => {
    const base = baseOf(slot)
    const light = (field: number, k: number) => packed[base + field + k]
    const out = at * LIGHT_SHAPE_INSTANCE_FLOATS
    for (let k = 0; k < 3; k++) data[out + k] = light(LIGHT_FIELD.position, k)
    data[out + 3] = light(LIGHT_FIELD.range, 0)
    for (let k = 0; k < 3; k++) data[out + 4 + k] = light(LIGHT_FIELD.direction, k)
    data[out + 7] = light(LIGHT_FIELD.cosCone, 0)
    data.fill(0, out + 8, out + 16)
    data[out + 11] = BARN_COSINE
    data[out + 14] = DEFAULT_BARN_DOOR_LENGTH
    data[out + 15] = slot
    if (kind === 'rect') {
      // The width axis is the stored half width times a unit vector; the height axis across it and the direction.
      const rx = light(LIGHT_FIELD.halfWidth, 0),
        ry = light(LIGHT_FIELD.halfWidth, 1),
        rz = light(LIGHT_FIELD.halfWidth, 2)
      const half = length3(rx, ry, rz) || 1
      const fx = data[out + 4],
        fy = data[out + 5],
        fz = data[out + 6]
      const ux = (fy * rz - fz * ry) / half,
        uy = (fz * rx - fx * rz) / half,
        uz = (fx * ry - fy * rx) / half
      data[out + 8] = ux
      data[out + 9] = uy
      data[out + 10] = uz
      data[out + 12] = half
      data[out + 13] = light(LIGHT_FIELD.halfHeight, 0)
    }
  })
  return { count: order.length, kinds: order.map(({ kind }) => kind) }
}

const frameOf = (rt: WebgpuPagesRuntime): LightShapeFrame =>
  (rt.lights.lightShape ??= { toggle: 0, animating: false, scratch: { data: new Float32Array(0) } })

/** Whether the shapes are fading in or out: a quiet view is drawn again meanwhile (`drawsEveryImage`). */
export const lightShapesAnimating = (rt: WebgpuPagesRuntime) =>
  rt.lights.lightShape?.animating === true

/** The shapes' fade figures written into `words`: the view-projection, the toggle and the time, the inverse duration, the inverse distance, the delay and the opacity. */
function writeFade(
  fade: UniformBlock,
  viewProjection: ArrayLike<number>,
  toggle: number,
  now: number,
  v: ReturnType<typeof lightShapeValues>,
) {
  const words = fade.words.f
  copyMatrix4(words, viewProjection)
  words.set(
    [
      toggle,
      now,
      0,
      0,
      // A fade of no duration is an instant one: the whole alpha at the first image, never a 0 over 0.
      v.fadeDuration > 0 ? 1 / v.fadeDuration : 1e30,
      1 / v.maxDelayDistance,
      v.maxDelay,
      v.maxOpacity,
    ],
    16,
  )
  fade.send()
}

/** Releases what the visualization holds: the instances' buffer. */
export function releaseLightShapes(rt: WebgpuPagesRuntime) {
  const frame = rt.lights.lightShape
  if (frame && rt.gpu.device)
    for (const buffer of [frame.instances, frame.fade?.buffer])
      if (buffer) retire(rt.gpu.device, buffer)
  rt.lights.lightShape = undefined
}

/**
 * Lays the light shapes over the lit image, as the frame's last scene pass before the furnace test and the post chain: nothing while the
 * switch is off and its fade out is done, or the pipelines compile (the frame is held on them).
 */
export function encodeLightShapes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, lights } = rt
  const values = lightShapeValues((field) => Number(readLightShapeSetting(rt, field)))
  const frame = frameOf(rt)
  // The wall clock, not the world's: a paused world must still fade the shapes in and out (and stop redrawing once the fade is done).
  const now = rt.run.graphClocks.realTime
  const shown = toggledShapes(
    frame,
    !!readLightShapeSetting(rt, 'visualizeLightShape'),
    now,
    values.fadeDuration,
  )
  frame.animating =
    shown && (frame.toggle < 0 || now - frame.toggle < values.fadeDuration + values.maxDelay)
  if (!shown || !gpu.hdrView || !gpu.depthView || !gpu.deferred) return
  const state = pipelines(device)
  if (!chainReady(state.point, state.spot, state.rect)) return
  const { store } = lights
  const draw = lightDrawViewOf(cam, store, vsmMapSettings(rt).shadows)
  const { count, kinds: order } = lightShapeInstances(
    store.packed,
    store.kindOf,
    store.count,
    cam.eye,
    (slot) => lightDrawn(slot, draw),
    frame.scratch,
  )
  if (!count) return
  const bytes = count * LIGHT_SHAPE_INSTANCE_FLOATS * 4
  if (!frame.instances || frame.instances.size < bytes) {
    if (frame.instances) retire(device, frame.instances)
    frame.instances = device.createBuffer({
      label: 'Trillion3D light shape instances',
      size: Math.max(bytes, 4096) * 2,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(
    frame.instances,
    0,
    frame.scratch.data,
    0,
    count * LIGHT_SHAPE_INSTANCE_FLOATS,
  )
  const fade = (frame.fade ??= uniformBlock(
    device,
    'Trillion3D light shape fade',
    LIGHT_SHAPE_FADE_FLOATS * 4,
  ))
  writeFade(fade, cam.viewProjection, frame.toggle, now, values)
  // The group is made again only when the view's uniform or the depth view is another (a resize).
  const view = gpu.deferred.uniform
  const group =
    frame.group?.view === view && frame.group.depth === gpu.depthView
      ? frame.group
      : (frame.group = {
          view,
          depth: gpu.depthView,
          bound: device.createBindGroup({
            layout: state.layout,
            entries: [
              { binding: LIGHT_SHAPE_BINDINGS.view, resource: { buffer: view } },
              { binding: LIGHT_SHAPE_BINDINGS.depth, resource: gpu.depthView },
              { binding: LIGHT_SHAPE_BINDINGS.fade, resource: { buffer: fade.buffer } },
            ],
          }),
        })
  const geometry = meshes(device)
  const pass = encoder.beginRenderPass({
    label: LIGHT_SHAPE_PASS,
    colorAttachments: [{ view: gpu.hdrView, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setBindGroup(0, group.bound)
  pass.setVertexBuffer(1, frame.instances)
  // The runs of one kind, in the order of the instances, each one draw of the mesh's edges.
  for (let first = 0; first < count;) {
    const kind = order[first]
    let end = first + 1
    while (end < count && order[end] === kind) end++
    const mesh = geometry[kind]
    pass.setPipeline(state[kind].get()!)
    pass.setVertexBuffer(0, mesh.vertices)
    pass.setIndexBuffer(mesh.indices, 'uint16')
    pass.drawIndexed(mesh.count, end - first, 0, 0, first)
    first = end
  }
  pass.end()
}
