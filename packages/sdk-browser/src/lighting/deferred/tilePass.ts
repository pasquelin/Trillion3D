import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import {
  TILE_CLASS,
  TILE_CLASS_NAMES,
  TILE_CLASSES,
  TILE_PIXELS,
  tileArgsAt,
  type TileClass,
} from './tileClass.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { VIEW_WGSL } from './worldAtWgsl.ts'

/**
 * THE VERTEX STAGE OF A TILE PASS: the quad of one tile of its class's list (`tileLists`, cut by
 * `classifyMain`), a strip of four corners an instance, instance `k` of the class's indirect draw
 * (`tileArgsAt`) being the list's `k`th word. The class is the pipeline's (`TILE_CLASS`, an override
 * of the vertex stage); the lists lie one after the other, `across × down` words each, at the size the
 * view draws. The quad covers its `TILE_PIXELS` pixels square, past the image's edge where the image
 * ends mid-tile: the viewport clips it.
 */
export const TILE_VERTEX_WGSL = wgslBlock(
  'TILE_VERTEX_WGSL',
  [VIEW_WGSL],
  `
override TILE_CLASS:u32=0u;
@group(0) @binding(${DEFERRED_BINDINGS.tileList}) var<storage,read> tileList:array<u32>;
@vertex fn tile(@builtin(vertex_index) corner:u32,@builtin(instance_index) instance:u32)->@builtin(position) vec4f{
 let size=vec2u(view.viewport.xy);
 let stride=((size.x+${TILE_PIXELS - 1}u)/${TILE_PIXELS}u)*((size.y+${TILE_PIXELS - 1}u)/${TILE_PIXELS}u);
 let packed=tileList[TILE_CLASS*stride+instance];
 let pixel=(vec2f(vec2u(packed&0xffffu,packed>>16u))+vec2f(f32(corner&1u),f32(corner>>1u)))*${TILE_PIXELS}.0;
 return vec4f(pixel.x/view.viewport.x*2.0-1.0,1.0-pixel.y/view.viewport.y*2.0,0.0,1.0);
}`,
)

/** A light added to the lit image: its colour summed with what lies there, and its alpha — the luminance of the light the subsurface
 *  scattering spreads (`SSS_LIT_WGSL`), zero for a pixel it does not reach. */
const ADDITIVE_LIGHT: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
}

/** The formats of the toon data the lights' passes add to beside the lit image, when the program writes it (`ContractKey.toonData`): the pre-exposed diffuse light of the
 *  toon pixels, unramped, and their weight and weighted cosine. Half floats, which the sums of many lights stay inside of and which a target can blend. */
export const TOON_DATA_FORMATS = {
  diffuse: 'rgba16float',
  weights: 'rg16float',
} as const satisfies Record<string, GPUTextureFormat>

/** The colour write mask of all four channels, and of none. */
const WRITE_ALL = 0xf
const WRITE_NONE = 0

/**
 * The targets of a pass of lights: the lit image, and, in a program that writes the toon data, its two targets — written by the passes of the classes that hold toon pixels
 * (`writesToon`), held by the others, whose pipelines write none of it (a pipeline of the pass names every target the pass has).
 */
const lightTargets = (toon: boolean, writesToon: boolean): GPUColorTargetState[] => {
  const targets: GPUColorTargetState[] = [{ format: HDR_FORMAT, blend: ADDITIVE_LIGHT }]
  if (toon)
    for (const format of Object.values(TOON_DATA_FORMATS))
      targets.push({
        format,
        blend: ADDITIVE_LIGHT,
        writeMask: writesToon ? WRITE_ALL : WRITE_NONE,
      })
  return targets
}

/**
 * The descriptor of the pipeline of one class of a tile pass: the fragment stage `entryPoint` of
 * `module`, over the tiles of `tileClass` (`TILE_VERTEX_WGSL`), on `layout`.
 */
const tilePipelineDescriptor = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entryPoint: string,
  targets: GPUColorTargetState[],
  label: string,
  tileClass: TileClass,
): GPURenderPipelineDescriptor => ({
  label,
  layout: device.createPipelineLayout({ bindGroupLayouts: [layout].flat() }),
  vertex: { module, entryPoint: 'tile', constants: { TILE_CLASS: tileClass } },
  fragment: { module, entryPoint, targets },
  primitive: { topology: 'triangle-strip' },
})

/** The module a class draws with: its own, or the highest the program holds (`modules`, one for each class the program holds code
 *  for, the cheapest first). */
export const moduleOfClass = <M>(modules: readonly M[], tileClass: TileClass) =>
  modules[Math.min(tileClass, modules.length - 1)]

/**
 * The descriptor of the pipeline of a class of a lit pass named `label`, that adds its light to the lit image: the fragment stage `entry`
 * of the module `modules` give the class, over the tiles of the class, on `layout`. The one description of a lit program's
 * pipelines, built at once (`litProgram.ts`) or prepared (`perLightProgram.ts`). In a program that writes the toon data (`toon`) the pass has the toon targets
 * too, written by the entries of the classes that hold the models (`toon.writes`, false for an entry that is not a light's, as the indirect light's or the shadows' view).
 */
export const lightPipelineDescriptor = (
  device: GPUDevice,
  modules: readonly GPUShaderModule[],
  layout: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entry: string,
  label: string,
  tileClass: TileClass,
  toon: { writes: boolean } | undefined = undefined,
) =>
  tilePipelineDescriptor(
    device,
    moduleOfClass(modules, tileClass),
    layout,
    entry,
    lightTargets(
      !!toon,
      !!toon?.writes && Math.min(tileClass, modules.length - 1) !== TILE_CLASS.simple,
    ),
    `${label}_${TILE_CLASS_NAMES[tileClass]}`,
    tileClass,
  )

/**
 * The tiles of every class drawn in `pass`, each by the indirect draw of its class in `draws`
 * (`tileArgsAt`), with that class's pipeline: a class with none is drawn with none. The group is
 * set by the caller. Returns the draws made.
 */
export function drawTileClasses(
  pass: GPURenderPassEncoder,
  pipelines: readonly (GPURenderPipeline | undefined)[],
  draws: GPUBuffer,
) {
  let made = 0
  for (const tileClass of TILE_CLASSES) {
    const pipeline = pipelines[tileClass]
    if (!pipeline) continue
    pass.setPipeline(pipeline)
    pass.drawIndirect(draws, tileArgsAt(tileClass))
    made++
  }
  return made
}
