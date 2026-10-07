// The reference image of the page-texture chain's class-2 bound: `develop`'s reduction, one level
// drawn into a render target of the pool format — its sRGB encode the target's own —, the coverage
// counts in a pass of their own per level and the pick's `t` copied into the level's uniform.
import { COVERAGE_COUNT_WGSL } from '../../../packages/sdk-browser/src/texture/mipsWgsl.ts'
import {
  COVERAGE_PICK_WGSL,
  COVERAGE_SCALE_WGSL,
} from '../../../packages/sdk-browser/src/texture/coverageRule.ts'
import { FULLSCREEN_XY } from '../../../packages/sdk-browser/src/gpu/shader/fullscreenTriangle.ts'
import { levelSize } from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { wgslModule, wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../packages/math/src/wgsl/decl.ts'

/** One chain of the proof: its pool format, size, colour rule, cutoff, and level 0's RGBA8 bytes. */
export interface ChainCase {
  name: string
  format: 'rgba8unorm' | 'rgba8unorm-srgb'
  width: number
  height: number
  weighted: boolean
  cutoff: number
  texels: Uint8Array<ArrayBuffer>
}

const REFERENCE_WGSL = wgslProgram(
  `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 override weighted:bool;
 
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(${FULLSCREEN_XY},0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  let mean=(s0+s1+s2+s3)*0.25;
  let a=vec4f(s0.w,s1.w,s2.w,s3.w);
  let byAlpha=(s0.rgb*s0.w+s1.rgb*s1.w+s2.rgb*s2.w+s3.rgb*s3.w)/dot(a,vec4f(1.0));
  return vec4f(select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w))),reducedAlpha(a,extent.z,extent.w));
 }`,
  [COVERAGE_SCALE_WGSL],
)

/** `develop`'s pick: one thread over the level's bins, from 255 down, keeping the least key, beside
 *  the counts whose bins, level and sizes it reads. */
const CHOOSE_WGSL = wgslBlock(
  'CHOOSE_WGSL',
  [COVERAGE_COUNT_WGSL, COVERAGE_PICK_WGSL],
  `
 
 @compute @workgroup_size(1) fn choose(){
  let c=level.extent.z;var covered=0u;
  for(var b=c;b<256u;b++){covered+=atomicLoad(&cover[b]);}
  let n0=sizeOf(0u);let nk=sizeOf(level.base.z);let texels=vec2u(n0.x*n0.y,nk.x*nk.y);
  let goal=wide(covered,texels.y);var best=vec4u(0xffffffffu,0xffffffffu,255u,c);var above=0u;
  for(var t=255u;t>0u;t--){
   above+=atomicLoad(&cover[level.base.z*256u+t]);
   let next=pickKey(c,t,above,texels,goal);
   if(below(next,best)){best=next;}
  }
  atomicStore(&cover[level.base.z*256u],best.w);
 }`,
)

/** `develop`'s chain of `chain` in `texture` (its pool format, level 0 written), encoded into
 *  `encoder`; returns what to destroy once submitted. */
export function encodeReferenceChain(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  chain: ChainCase,
) {
  const { width, height, cutoff, weighted, format } = chain
  const levels = texture.mipLevelCount
  const uniforms = device.createBuffer({
    size: levels * 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const packed = new Uint32Array(levels * 64)
  for (let level = 0; level < levels; level++)
    packed.set(
      [...levelSize(width, height, Math.max(0, level - 1)), cutoff, 0, width, height, level],
      level * 64,
    )
  device.queue.writeBuffer(uniforms, 0, packed)
  const bins = device.createBuffer({
    size: levels * 1024,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const views = Array.from({ length: levels }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  )
  const module = device.createShaderModule({ code: REFERENCE_WGSL })
  const reduce = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
      constants: { weighted: +weighted },
    },
  })
  const visibility = GPUShaderStage.COMPUTE
  const countLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, buffer: { type: 'uniform' } },
      { binding: 2, visibility, buffer: { type: 'storage' } },
    ],
  })
  const counts = device.createShaderModule({ code: wgslModule(CHOOSE_WGSL) }),
    layout = device.createPipelineLayout({ bindGroupLayouts: [countLayout] })
  const [count, choose] = ['count', 'choose'].map((entryPoint) =>
    device.createComputePipeline({ layout, compute: { module: counts, entryPoint } }),
  )
  const countGroup = (block: number, source: number) =>
    device.createBindGroup({
      layout: countLayout,
      entries: [
        { binding: 0, resource: views[source] },
        { binding: 1, resource: { buffer: uniforms, offset: block * 256, size: 32 } },
        { binding: 2, resource: { buffer: bins } },
      ],
    })
  for (let level = 1; level < levels; level++) {
    if (cutoff) {
      const pass = encoder.beginComputePass()
      pass.setPipeline(count)
      const dispatch = ([w, h]: [number, number]) =>
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8))
      if (level === 1) {
        pass.setBindGroup(0, countGroup(0, 0))
        dispatch([width, height])
      }
      pass.setBindGroup(0, countGroup(level, level - 1))
      dispatch(levelSize(width, height, level))
      pass.setPipeline(choose)
      pass.dispatchWorkgroups(1)
      pass.end()
      encoder.copyBufferToBuffer(bins, level * 1024, uniforms, level * 256 + 12, 4)
    }
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: views[level], loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(reduce)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: reduce.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: views[level - 1] },
          { binding: 1, resource: { buffer: uniforms, offset: level * 256, size: 16 } },
        ],
      }),
    )
    pass.draw(3)
    pass.end()
  }
  return [uniforms, bins]
}
