import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { SCREEN_MARCH_PLANES_WGSL } from './screenMarchPlanes.ts'
import { SCREEN_MARCH_REFERENCE_WGSL } from './screenMarchReference.ts'
import type { MarchLanes } from './screenMarchLanes.ts'

/**
 * THE ENGINE'S SCREEN MARCH (`screenMarch`): where a ray crosses the depth the image drew, by a
 * hierarchical traversal of the depth pyramid (`hizDepthWgsl`, bound at `group`, `binding`): the
 * reflection's screen answer, with its reach and its thickness. The virtual shadow maps' contact
 * ray is not a march: four samples of level 0 (`vsmScreenRayFrom`), a contact ray being short.
 *
 * The ray is `o + d·t`, `o` in pixels and reversed depth, `t` from 0 to `end` (`screenMarchEnd`:
 * the image's edge, or the ray's far end). It returns the `t` it stopped at, the plane (depth at its
 * centre, slopes) and centre of the pixel it stopped in (`ScreenHit`), and the iterations it took
 * (`steps`), `t` −1 where it meets nothing, and `above`, where a miss stopped knowing the ray: the furthest `t` the
 * march has the ray in front of every surface it walked (`end` where it crossed the image, its `t` where the iterations ran out,
 * the last `t` it passed above a surface where the ray went behind one; on a hit, the last `t` it passed above a surface before it, where a rejected hit resumes from, zero for the planes' march); `front` says the hit is a transparent surface before the
 * opaque depth (`hizFrontOver`, false where the pyramid holds none): the reflection keeps it, the
 * contact shadow skips it.
 *
 * Two walks read the pyramid, by the setting `hizTrace` (`hizOptions.ts`), which the host sends in
 * the levels uniform with the pyramid built for it (`GpuHiz.planes`): the reference's, the default
 * (`screenMarchReference`), over the closest depth of each texel's centre; the engine's own
 * (`screenMarchPlanes`), over the planes of the pixels. The reference's walk goes down to the
 * full-resolution depth, or, `full` false, stops at the half-resolution level (`hizFullResDepth`,
 * read by the screen probes' trace; the reflections' goes down). The surface's thickness is two values, the march picking its own: `pixels`
 * for the planes' march, in pixels of footprint, and `relative` for the reference's walk, a share
 * of the surface's depth (`reflectionRelativeDepthThickness` or `screenProbeRelativeDepthThickness`, `screenRelativeThickness`).
 *
 * `lanes` (`screenMarchLanes.ts`): the reference walk gives up when no more than `occupancy` lanes of its subgroup are still walking (the call takes
 * that last argument), the reflections' minimum occupancy; `none`, the default, is the walk without that test, which the screen probes read. Under
 * `polyfill` every thread of the workgroup must call `screenMarch`, in uniform control flow, a thread with no ray calling it with `end` zero.
 */
export const SCREEN_MARCH_WGSL = (
  group: number,
  binding: number,
  lanes: MarchLanes = 'none',
  threads?: number,
) =>
  wgslBlock(
    `SCREEN_MARCH_WGSL(${group}, ${binding}, ${lanes}${threads === undefined ? '' : `, ${threads}`})`,
    [
      SCREEN_MARCH_PLANES_WGSL(group, binding),
      SCREEN_MARCH_REFERENCE_WGSL(group, binding, lanes, threads),
    ],
    `fn screenMarch(o:vec3f,d:vec3f,end:f32,pixels:f32,relative:f32,slab:vec4f,cap:u32,full:bool${lanes === 'none' ? '' : ',occupancy:u32'})->ScreenHit{
 if(hizTracePlanes()){return screenMarchPlanes(o,d,end,pixels,slab,cap);}
 return screenMarchReference(o,d,end,relative,slab,cap,full${lanes === 'none' ? '' : ',occupancy'});
}`,
  )
