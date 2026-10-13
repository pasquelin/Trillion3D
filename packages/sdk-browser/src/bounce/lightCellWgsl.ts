import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { TILE_SLICE_WGSL } from '../lighting/direct/lightingWgsl.ts'

/** The binding both bounce passes read the world grid's lists at (`bindings.ts`): its records,
 *  then the pool of its lists, as the view's grid holds them. */
export const BOUNCE_LIGHT_LIST_BINDING = 7

/**
 * The lights a bounce point walks (`bounceLightSlice`): the list of its cell of the bounce's world
 * light grid, the last cascade level's lattice — world-fixed, over the scene —, which the light grid
 * pass lists per cell as it lists the view's (`../lighting/tiles/shader.ts`, `kind` `world`). A
 * cell's record is at `((y · side + x) · side + z) · TILE_STRIDE`: its column's, then its cell's
 * along z. A point outside the lattice, or a cell the pool had no room for, walks every declared
 * light (`cellSlice`): the same sum, a light its cell does not list reaching no point of it.
 *
 * Cost: (B + R) · L light reads become (B + R) · L_cell, B the cache texels updated, R the probe
 * hits on owned leaves, L_cell the lights of their cells, for one pass over side² columns and L
 * lights, a frame the lights change.
 */
export const BOUNCE_LIGHT_CELL_WGSL = wgslBlock(
  'BOUNCE_LIGHT_CELL_WGSL',
  [TILE_SLICE_WGSL],
  `
@group(0) @binding(${BOUNCE_LIGHT_LIST_BINDING}) var<storage,read> tileLights:array<u32>;
fn bounceLightSlice(P:vec3f)->vec2u{
 let level=bounce.levels[bounce.counts.y-1u];
 let spacing=level.originSpacing.w;
 let side=bounce.counts.x;
 let at=floor((P-level.base.xyz*spacing)/spacing);
 if(any(at<vec3f(0.0))||any(at>=vec3f(f32(side)))){return vec2u(TILE_NO_SLICE,directLights.count);}
 let cell=vec3u(at);
 return cellSlice(((cell.y*side+cell.x)*side+cell.z)*TILE_STRIDE);
}`,
)
