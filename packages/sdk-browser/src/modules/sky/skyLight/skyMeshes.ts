import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { commitOnSubmit, retire } from '../../../gpu/core/frameRetire.ts'
import { createCachedGroup } from '../../../gpu/bind/cachedGroup.ts'
import { drawFullscreenTriangle, FULLSCREEN_ENTRY } from '../../../gpu/shader/fullscreenTriangle.ts'
import { CUBE_FACES, SKY_LIGHT_CUBE_FORMAT } from './layout.ts'
import {
  SKY_MESH_CODE,
  SKY_MESH_DEPTH_ENTRY,
  SKY_MESH_DEPTH_FORMAT,
  SKY_MESH_ENTRY,
  SKY_MESH_LAYOUT,
} from './skyMeshWgsl.ts'

/**
 * THE SKY MESHES' CUBE: the image of the sky meshes (the surfaces of a sky material), drawn alone from the sky light's place through the
 * six cameras of a cube (`../../../frame/render/encodeSkyMeshes.ts`), kept a layer a face. The real-time capture draws the faces from it
 * in the place of the atmosphere while the scene has a sky material (`drawFace`, `captureFaces.ts`). With the depth buffer
 * (`skyLightDepthBuffer`) the cube keeps beside it the depth of each camera, a layer a face, which the fog over the faces reads
 * (`depthLayer`).
 */
export interface SkyMeshes {
  /** The cube's side, the real-time capture's. */
  readonly width: number
  /** Whether every face holds an image. */
  readonly ready: boolean
  /** Counts the changes of what the cube holds: an image taken into a face, a face given up. */
  readonly revision: number
  /** Face `face` holds no image any more (the meshes it showed are gone): the cube is not whole until it is drawn again. */
  drop(face: number): void
  /** Whether the cube keeps the depth of the meshes (`skyLightDepthBuffer`). */
  readonly depthBuffer: boolean
  /** Face `face` taken from the lit image `lit` of its camera, `drawn` pixels of a target of `allocated` (`HdrViewsJob.copy`), and,
   *  with the depth buffer, its depth from `depth` of the same camera. */
  copyIn(
    encoder: GPUCommandEncoder,
    face: number,
    lit: GPUTextureView,
    drawn: readonly number[],
    allocated: readonly number[],
    depth?: GPUTextureView,
  ): void
  /** The depth of face `face`: a texture of the cube's side, the hardware depth of its camera, zero where no mesh was drawn; none without the depth buffer. */
  depthLayer(face: number): GPUTextureView | undefined
  /** Face `face` of the real-time capture, whose colour target is `target`, written from its layer multiplied by `preExposure`. */
  drawFace(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    face: number,
    preExposure: number,
  ): void
  dispose(): void
}

/** What the copies write: the colour's three channels, the depth's one. */
const COLOUR_TARGET: GPUColorTargetState = { format: SKY_LIGHT_CUBE_FORMAT, writeMask: 7 }
const DEPTH_TARGET: GPUColorTargetState = { format: SKY_MESH_DEPTH_FORMAT, writeMask: 1 }

/** One program of the cube: its pipeline, compiled off the frame, and a bind group for each block, made again only where its source or the pipeline moved. */
function copyStage(
  device: GPUDevice,
  module: GPUShaderModule,
  entryPoint: string,
  target: GPUColorTargetState,
  groups: number,
) {
  const prepared = preparedPipeline(device, {
    label: `Trillion3D sky meshes ${entryPoint}`,
    layout: 'auto',
    vertex: { module, entryPoint: FULLSCREEN_ENTRY },
    fragment: { module, entryPoint, targets: [target] },
  })
  return {
    prepared,
    groups: Array.from({ length: groups }, () => createCachedGroup()),
    layout: undefined as GPUBindGroupLayout | undefined,
  }
}
type CopyStage = ReturnType<typeof copyStage>

/** The cube of `width` pixels a side: its texture, with `depthBuffer` its depth beside it, its programs and the blocks of its copies. */
export function createSkyMeshes(device: GPUDevice, width: number, depthBuffer: boolean): SkyMeshes {
  const cube = (label: string, format: GPUTextureFormat) =>
    device.createTexture({
      label,
      size: { width, height: width, depthOrArrayLayers: CUBE_FACES },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
  const layersOf = (texture: GPUTexture) =>
    Array.from({ length: CUBE_FACES }, (_, face) =>
      texture.createView({ dimension: '2d', baseArrayLayer: face, arrayLayerCount: 1 }),
    )
  const texture = cube('Trillion3D sky meshes', SKY_LIGHT_CUBE_FORMAT)
  const layers = layersOf(texture)
  const depthTexture = depthBuffer
    ? cube('Trillion3D sky meshes depth', SKY_MESH_DEPTH_FORMAT)
    : undefined
  const depthLayers = depthTexture && layersOf(depthTexture)
  const module = device.createShaderModule({ label: 'Trillion3D sky meshes', code: SKY_MESH_CODE })
  const colour = copyStage(device, module, SKY_MESH_ENTRY, COLOUR_TARGET, 2 * CUBE_FACES)
  const depth = depthBuffer
    ? copyStage(device, module, SKY_MESH_DEPTH_ENTRY, DEPTH_TARGET, CUBE_FACES)
    : undefined
  const sampler = postSamplers(device).clamped
  const block = () =>
    device.createBuffer({
      label: 'Trillion3D sky meshes block',
      size: SKY_MESH_LAYOUT.words * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  const blocks = Array.from({ length: 2 * CUBE_FACES }, block)
  const words = new Float32Array(SKY_MESH_LAYOUT.words)
  let written = 0,
    revision = 0
  /** The block `at` written with `scale`: the share of the source image the copy reads, whether it is turned, the factor it is multiplied by. */
  const writeBlock = (at: number, scale: readonly [number, number, number, number]) => {
    words.set(scale, SKY_MESH_LAYOUT.at.scale)
    words[SKY_MESH_LAYOUT.at.side] = 1 / width
    device.queue.writeBuffer(blocks[at], 0, words)
  }
  /** One copy by `stage`: `entries` over `scale` of the source, into `target`, the block `at`; false while the program is still compiling. */
  const copy = (
    stage: CopyStage,
    encoder: GPUCommandEncoder,
    at: number,
    source: GPUTextureView,
    target: GPUTextureView,
    entries: GPUBindGroupEntry[],
  ) => {
    const pipeline = stage.prepared.get()
    if (!pipeline) return false
    stage.layout ??= pipeline.getBindGroupLayout(0)
    const group = stage.groups[at](device, stage.layout, [source], () => entries)
    drawFullscreenTriangle(
      encoder,
      {
        label: 'Trillion3D sky meshes copy',
        colorAttachments: [
          {
            view: target,
            loadOp: 'clear',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: 'store',
          },
        ],
      },
      pipeline,
      group,
    )
    return true
  }
  const blockEntry = (at: number): GPUBindGroupEntry => ({
    binding: 2,
    resource: { buffer: blocks[at] },
  })
  return {
    width,
    depthBuffer,
    get ready() {
      return written === (1 << CUBE_FACES) - 1
    },
    get revision() {
      return revision
    },
    drop(face) {
      if (!(written & (1 << face))) return
      written &= ~(1 << face)
      revision++
    },
    copyIn(encoder, face, lit, drawn, allocated, depthImage) {
      writeBlock(face, [drawn[0] / allocated[0], drawn[1] / allocated[1], 1, 1])
      const copied = copy(colour, encoder, face, lit, layers[face], [
        { binding: 0, resource: lit },
        { binding: 1, resource: sampler },
        blockEntry(face),
      ])
      // The depth is taken in the same image as the colour: a face counts as held once both are.
      const depthCopied =
        !depth ||
        (!!depthImage &&
          copy(depth, encoder, face, depthImage, depthLayers![face], [
            { binding: 3, resource: depthImage },
            blockEntry(face),
          ]))
      // The face is held once the encoder that copies it is submitted: one dropped leaves the cube as it was.
      if (copied && depthCopied)
        commitOnSubmit(encoder, () => {
          written |= 1 << face
          revision++
        })
    },
    depthLayer: (face) => depthLayers?.[face],
    drawFace(encoder, target, face, preExposure) {
      const at = CUBE_FACES + face
      writeBlock(at, [1, 1, 0, preExposure])
      copy(colour, encoder, at, layers[face], target, [
        { binding: 0, resource: layers[face] },
        { binding: 1, resource: sampler },
        blockEntry(at),
      ])
    },
    // The commands of this image may still name them: they go once it is submitted (`retire`).
    dispose: () => {
      for (const resource of [texture, depthTexture, ...blocks])
        if (resource) retire(device, resource)
    },
  }
}
