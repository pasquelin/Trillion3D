import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  COMPUTE,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  OIT_PASS_SEPARATE,
  readOrderIndependentTranslucencySetting as readOit,
} from '../../../../sdk-core/src/contracts/orderIndependentTranslucencyOptions.ts'
import { opensDisplayFilter } from '../../frame/render/encodeDisplayFilter.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../gpu/core/uniformBlock.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  OBJECT_SHADOW_PACKED_LAYER_ROWS as LAYER_ROWS,
  OBJECT_SHADOW_PACKED_WIDTH as WIDTH,
} from '../../gpu/core/objectShadowRead.ts'

/**
 * THE SORTED TRANSLUCENCY'S DEPTH FOLDED INTO THE PACKED TABLE (`ObjectShadowAtlasRead` `'foldedDepth'`): on a device one sampled texture short even with the light profiles
 * folded, the depth the collecting fragments are tested against is not bound as a texture. A pass of its own writes it, before the collect pass, into the rows of the table the header
 * names (`OBJECT_SHADOW_HEADER_ROWS`), row after row of the depth as the words of a float, four values a texel, and the fragments read it from there (`OIT_DEPTH_FOLDED_WGSL`).
 */

/** The texels the depth of a `width` by `height` image takes in the table, and the rows of the table they fill. */
const foldedDepthTexels = (width: number, height: number) => ceilDiv(width * height, 4)
export const foldedDepthRows = (width: number, height: number) =>
  ceilDiv(foldedDepthTexels(width, height), WIDTH)

/** The words of the pass's uniform: the depth's width and height, the table's row it goes to, the texels to write. */
const DEPTH_FOLD_WORDS = 4

/** The pass: a thread a texel of the region, the grid `WIDTH` texels across, the rows of the region down. */
export const OBJECT_SHADOW_DEPTH_FOLD_WGSL = wgslProgram(
  `struct DepthFold{width:u32,height:u32,row:u32,texels:u32,}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var table:texture_storage_2d_array<rgba32uint,write>;
@group(0) @binding(2) var<uniform> fold:DepthFold;
@compute @workgroup_size(8,8) fn depthFold(@builtin(global_invocation_id) id:vec3u){
 let texel=id.y*${WIDTH}u+id.x;
 if(texel>=fold.texels){return;}
 var out=vec4u(0u);
 for(var k=0u;k<4u;k++){
  let index=texel*4u+k;
  if(index>=fold.width*fold.height){break;}
  out[k]=bitcast<u32>(textureLoad(depth,vec2i(i32(index%fold.width),i32(index/fold.width)),0));
 }
 let row=fold.row+id.y;
 textureStore(table,vec2u(id.x,row%${LAYER_ROWS}u),row/${LAYER_ROWS}u,out);
}`,
  [],
)

const stage = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D translucent object shadow depth fold',
    entries: [
      computeTextureEntry(0, 'depth', '2d', COMPUTE),
      computeStorageTextureEntry(1, 'rgba32uint', 'write-only', '2d-array', COMPUTE),
      computeUniformEntry(2, { minBindingSize: DEPTH_FOLD_WORDS * 4 }, COMPUTE),
    ],
  })
  return {
    layout,
    pipeline: preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({
        label: 'Trillion3D translucent object shadow depth fold',
        code: OBJECT_SHADOW_DEPTH_FOLD_WGSL,
      }),
      'depthFold',
      undefined,
      'Trillion3D translucent object shadow depth fold',
    ),
  }
})

/**
 * Whether the pass is compiled; asked (the frame waits for it) where it is not. The sorted translucency whose depth lies in the table collects only once it is: a frame never
 * collects without the depth test.
 */
export function depthFoldReady(device: GPUDevice) {
  const { pipeline } = stage(device)
  if (pipeline.ready) return true
  pipeline.ask()
  return false
}

/**
 * Whether this frame sorts its translucency with the depth in the table (`prepareOit` sorts under the same conditions): the table reserves the depth's rows for such a frame alone. The layers are
 * filtered (and not sorted) where the image opens the display layers (`opensDisplayFilter`, what `drawBlendPass` hands `prepareOit` as `filtered`): the layers are not open at the time the table is
 * made, so the same predicate is asked of what opens them, once an image (`shapeOf`).
 */
export const sortsFoldedDepth = (rt: WebgpuPagesRuntime, device: GPUDevice) =>
  !!rt.vis.blendPipelines?.oit &&
  !opensDisplayFilter(rt) &&
  readOit(rt, 'oitSortedPixelsEnable') &&
  (readOit(rt, 'oitPassType') & OIT_PASS_SEPARATE) !== 0 &&
  depthFoldReady(device)

/** What the pass holds between images: its uniform and the group over the depth view and the table it was made for. */
export interface DepthFoldState {
  params: UniformBlock | undefined
  group: GPUBindGroup | undefined
  depth: GPUTextureView | undefined
  table: GPUTextureView | undefined
}

export const newDepthFoldState = (): DepthFoldState => ({
  params: undefined,
  group: undefined,
  depth: undefined,
  table: undefined,
})

/** Lets go of what the pass holds (retired: the image's commands may still name the uniform). */
export function releaseDepthFold(device: GPUDevice, state: DepthFoldState) {
  if (state.params) retire(device, state.params.buffer)
  state.params = undefined
  state.group = undefined
}

/** Encodes the pass writing `depth` (`width` by `height`) into `table` from row `row`. False while the pass is compiling: the fragments then read no depth, which tests nothing. */
export function encodeDepthFold(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DepthFoldState,
  depth: GPUTextureView,
  table: GPUTextureView,
  width: number,
  height: number,
  row: number,
) {
  const { layout, pipeline } = stage(device)
  const compiled = pipeline.get()
  if (!compiled) return false
  const params = (state.params ??= uniformBlock(
    device,
    'Trillion3D translucent object shadow depth fold',
    DEPTH_FOLD_WORDS * 4,
  ))
  const words = params.words.u
  words[0] = width
  words[1] = height
  words[2] = row
  words[3] = foldedDepthTexels(width, height)
  params.send()
  if (state.depth !== depth || state.table !== table || !state.group) {
    state.group = device.createBindGroup({
      label: 'Trillion3D translucent object shadow depth fold',
      layout,
      entries: [
        { binding: 0, resource: depth },
        { binding: 1, resource: table },
        { binding: 2, resource: { buffer: params.buffer } },
      ],
    })
    state.depth = depth
    state.table = table
  }
  const pass = encoder.beginComputePass({
    label: 'Trillion3D translucent object shadow depth fold',
  })
  pass.setPipeline(compiled)
  pass.setBindGroup(0, state.group)
  pass.dispatchWorkgroups(WIDTH / 8, ceilDiv(foldedDepthRows(width, height), 8))
  pass.end()
  return true
}
