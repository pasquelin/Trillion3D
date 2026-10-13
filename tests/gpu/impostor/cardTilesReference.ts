// The card read before #1527, the proof's reference (`cardTilesPage.ts`): the card program the
// engine ships, its three maps read by the hardware sampler from three textures holding their whole
// mip chains — colour and coverage sRGB, the normal and depth and the ORM linear —, at the card's
// level, as the cards read them before their maps moved into the tile pool. Only the reads differ:
// the reference declares the tile reads' names over those textures (`referenceReads`), so the rest
// of the program is the shipped text, word for word.
import { wgslBlock } from '../../../packages/math/src/wgsl/decl.ts'
import { FEEDBACK_RULE_WGSL } from '../../../packages/sdk-browser/src/webgpu/tile/requestWgsl.ts'
import { cardPassWgsl } from '../../../packages/sdk-browser/src/webgpu/impostor/cardWgsl.ts'
import { SURFACE_FORMATS } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'
import {
  VIS_DEPTH,
  VIS_TARGETS,
} from '../../../packages/sdk-browser/src/webgpu/visibility/pipelines.ts'
import type { Chain } from './cardTileRig.ts'

/** The tile reads' names over the three whole-chain textures of group 1: a map's slot is its
 *  texture (the data atlas's 1 the normal and depth, 2 the ORM), its level clamped by the chain's
 *  `last` as before; the hardware samples. No pixel asks a tile. */
const referenceReads = (last: number) =>
  wgslBlock(
    'referenceReads',
    [FEEDBACK_RULE_WGSL],
    `struct TileSlot{last:u32,map:u32}
@group(1) @binding(0) var refColour:texture_2d<f32>;
@group(1) @binding(1) var refNormalDepth:texture_2d<f32>;
@group(1) @binding(2) var refOrm:texture_2d<f32>;
@group(1) @binding(3) var refSampler:sampler;
fn colorSlot(slot:u32)->TileSlot{return TileSlot(${last}u,0u);}
fn dataSlot(slot:u32)->TileSlot{return TileSlot(${last}u,slot);}
fn colorBlend(s:TileSlot,uv:vec2f,lod:f32,nearest:bool,finest:bool)->vec4f{return textureSampleLevel(refColour,refSampler,uv,lod);}
fn dataBlend(s:TileSlot,uv:vec2f,lod:f32,nearest:bool,finest:bool)->vec4f{
 if(s.map==1u){return textureSampleLevel(refNormalDepth,refSampler,uv,lod);}
 return textureSampleLevel(refOrm,refSampler,uv,lod);
}
fn colorRequestAt(s:TileSlot,uv:vec2f,level:u32,missing:bool)->u32{return 0u;}
fn dataRequestAt(s:TileSlot,uv:vec2f,level:u32,missing:bool)->u32{return 0u;}`,
  )

/** The reference's visibility and surface pipelines on the engine's image and identifier layouts,
 *  their group 1 the three textures (`referenceGroup`), for chains of `levels` levels. */
export async function referencePipelines(
  device: GPUDevice,
  imageLayout: GPUBindGroupLayout,
  idsLayout: GPUBindGroupLayout,
  levels: number,
) {
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const tilesLayout = device.createBindGroupLayout({
    entries: [
      ...[0, 1, 2].map((binding) => ({ binding, visibility: FRAGMENT, texture: {} })),
      { binding: 3, visibility: FRAGMENT, sampler: {} },
    ],
  })
  const module = device.createShaderModule({ code: cardPassWgsl(referenceReads(levels - 1)) })
  const make = (
    entryPoint: string,
    targets: GPUColorTargetState[],
    layouts: GPUBindGroupLayout[],
    depthStencil?: GPUDepthStencilState,
  ) =>
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: { module, entryPoint: 'card_vs' },
      fragment: { module, entryPoint, targets },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      ...(depthStencil && { depthStencil }),
    })
  const [vis, surface] = await Promise.all([
    make('card_vis_hiz_fs', VIS_TARGETS, [imageLayout, tilesLayout], VIS_DEPTH),
    make(
      'card_fs',
      SURFACE_FORMATS.map((format) => ({ format })),
      [imageLayout, tilesLayout, idsLayout],
    ),
  ])
  return { tilesLayout, vis, surface }
}

/** The reference's group over three textures holding `maps`' whole chains, as the cards' textures
 *  held them: each level written at its mip. */
export function referenceGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  sampler: GPUSampler,
  maps: { colour: Chain; normalDepth: Chain; orm: Chain },
) {
  const textureOf = ({ side, levels }: Chain, format: GPUTextureFormat) => {
    const texture = device.createTexture({
      size: [side, side],
      mipLevelCount: levels.length,
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    levels.forEach((texels, mipLevel) => {
      const width = Math.max(1, side >> mipLevel)
      device.queue.writeTexture({ texture, mipLevel }, texels, { bytesPerRow: width * 4 }, [
        width,
        width,
      ])
    })
    return texture.createView()
  }
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: textureOf(maps.colour, 'rgba8unorm-srgb') },
      { binding: 1, resource: textureOf(maps.normalDepth, 'rgba8unorm') },
      { binding: 2, resource: textureOf(maps.orm, 'rgba8unorm') },
      { binding: 3, resource: sampler },
    ],
  })
}
