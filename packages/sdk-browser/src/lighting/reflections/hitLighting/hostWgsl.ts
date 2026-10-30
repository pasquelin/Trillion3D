import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import type { LightFunctionBindings } from '../../lightFunction/readWgsl.ts'
import type { LightProfileBindings } from '../../lightProfile/lightProfileText.ts'
import type { LitPathHost } from './pathWgsl.ts'

/** Where a host reads the light functions' atlas (as a read-only storage texture) and the light profiles, and the expressions of its eye, of the exposure its lights are strengthened under and of the scale its light is held under (`LitPathHost`): the sides of the path it chooses (`LitPathHost`), all in group 0. */
export const litPathHostOf = (
  at: { lightFunction: number; lightProfile: number; lightProfileSampler: number },
  eye: string,
  exposure: string,
  scale: string,
): LitPathHost => ({
  lightFunction: {
    group: 0,
    atlas: at.lightFunction,
    eye,
    storage: true,
  } satisfies LightFunctionBindings,
  lightProfile: {
    group: 0,
    atlas: at.lightProfile,
    sampler: at.lightProfileSampler,
  } satisfies LightProfileBindings,
  eye,
  exposure,
  scale,
})

/** The bindings of the lists of a host's lit passes (group 0): the list of the hits to light, its sorted copy and the radiance of the first pass. */
export interface LitListBindings {
  readonly litList: number
  readonly litSorted: number
  readonly litRadiance: number
}

/**
 * THE LISTS THE PASSES OVER THE HITS TO LIGHT READ (`litList`, `litSorted`, `litRadiance`) and the vec4u a path's first vertex holds in the radiance (`LIT_FIRST_VECS`), as the host declares them; the first pass writes the radiance, the second reads it.
 */
export const litListWgsl = (at: LitListBindings, firstVecs: number, writesRadiance: boolean) =>
  wgslBlock(
    `LIT_LIST_WGSL(${at.litList},${at.litSorted},${at.litRadiance},${firstVecs},${writesRadiance})`,
    [],
    `struct LitList{count:u32,entries:array<vec2u>,}
@group(0) @binding(${at.litList}) var<storage,read> litList:LitList;
@group(0) @binding(${at.litSorted}) var<storage,read> litSorted:array<vec2u>;
@group(0) @binding(${at.litRadiance}) var<storage,${writesRadiance ? 'read_write' : 'read'}> litRadiance:array<vec4u>;
const LIT_FIRST_VECS:u32=${firstVecs}u;`,
  )

/** What the first pass asks of its host (`litPath`): the share of a lobe of squared roughness that the next ray carries, how far a shadow ray toward the sun runs and whether a hit on the back of a surface that is not two-sided ends the path, each a WGSL expression (`hit` in scope for the last). */
export const litDirectHostWgsl = (host: {
  traceShare: string
  sunReach: string
  backFaceEnds: string
}) =>
  wgslBlock(
    `LIT_DIRECT_HOST_WGSL(${host.traceShare}|${host.sunReach}|${host.backFaceEnds})`,
    [],
    `fn litTraceShare(alpha:f32)->f32{return ${host.traceShare};}
fn litSunReach()->f32{return ${host.sunReach};}
fn litBackFaceEnds(hit:StHit)->bool{return ${host.backFaceEnds};}`,
  )
