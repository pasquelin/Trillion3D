// The footprint rule on Dawn: the texture pools' `tileRead` (`texture/samplingFootprint.ts`) run
// as the pools run it — their header struct (`TileSlot`) and level of detail (`atlasLod`), the
// shadow pool's at no bias — on footprints given by their gradients; the level, the taps and the
// texel pick read back.
import {
  TILE_SLOT_WGSL,
  atlasLodWgsl,
  samplingFootprintWgsl,
} from '../../../packages/sdk-browser/src/texture/samplingFootprint.ts'
import { runCompute } from '../kit/computeRun.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** One read: the texture's filter word and last level, its size, and the footprint's gradients. */
export interface FootprintCase {
  sampling: number
  last: number
  size: [number, number]
  ddx: [number, number]
  ddy: [number, number]
}

/** The rule at the pools' level of detail with no bias, then one read a thread. */
function footprintWgsl() {
  return wgslProgram(
    `struct Case{sampling:u32,last:u32,size:vec2f,ddx:vec2f,ddy:vec2f,}
@group(0) @binding(0) var<storage,read> cases:array<Case>;
@group(0) @binding(1) var<storage,read_write> reads:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&cases)){return;}
 let c=cases[id.x];
 let s=TileSlot(c.size,0u,c.last,0u,0u,0u,c.sampling,0u);
 let r=tileRead(s,vec2f(0.5),c.ddx,c.ddy,true);
 reads[id.x]=vec4f(r.lod,f32(r.taps),select(0.0,1.0,r.nearest),0.0);
}`,
    [TILE_SLOT_WGSL, samplingFootprintWgsl(atlasLodWgsl('0.0'))],
  )
}

/** Each case's read: its level, its taps, and 1 when it picks a texel. */
export async function run(cases: FootprintCase[]) {
  const words = new ArrayBuffer(cases.length * 32),
    u32 = new Uint32Array(words),
    f32 = new Float32Array(words)
  cases.forEach(({ sampling, last, size, ddx, ddy }, n) => {
    u32.set([sampling, last], n * 8)
    f32.set([...size, ...ddx, ...ddy], n * 8 + 2)
  })
  const { adapter, values, errors } = await runCompute({
    code: footprintWgsl(),
    bytes: cases.length * 16,
    workgroups: ceilDiv(cases.length, 64),
    options: { inputs: [u32] },
  })
  const reads = cases.map((_, n) => values.slice(n * 4, n * 4 + 3))
  return { adapter, reads, errors }
}
