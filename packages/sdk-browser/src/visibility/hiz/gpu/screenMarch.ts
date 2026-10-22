import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { SCREEN_MARCH_PLANES_WGSL } from './screenMarchPlanes.ts'
import { SCREEN_MARCH_REFERENCE_WGSL } from './screenMarchReference.ts'

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
 * march has the ray in front of every surface it walked (`end` where it crossed the image, its `t` where the budget ran out or
 * the ray went behind a surface; zero on a hit); `front` says the hit is a transparent surface before the
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
 * of the surface's depth (`hizRelativeDepthThickness`, `screenRelativeThickness`).
 */
export const SCREEN_MARCH_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_WGSL(${group}, ${binding})`,
    [SCREEN_MARCH_PLANES_WGSL(group, binding), SCREEN_MARCH_REFERENCE_WGSL(group, binding)],
    `fn screenMarch(o:vec3f,d:vec3f,end:f32,pixels:f32,relative:f32,slab:vec4f,cap:u32,full:bool)->ScreenHit{
 if(hizTracePlanes()){return screenMarchPlanes(o,d,end,pixels,slab,cap);}
 return screenMarchReference(o,d,end,relative,slab,cap,full);
}`,
  )
