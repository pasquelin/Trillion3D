import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { TILE_SLICE_WGSL } from '../lighting/direct/lightingWgsl.ts'

/** The binding both bounce passes read the light grid's buffer at (`bindings.ts`): the view's
 *  records and lists, then the world grid's. */
export const BOUNCE_LIGHT_LIST_BINDING = 6

/**
 * The lights a bounce point walks (`bounceLightSlice`): the list of its cell of the world light grid,
 * the last cascade level's lattice — world-fixed, over the scene —, which the light grid pass lists
 * per cell as it lists the view's, in the same buffer every reader of a list binds as `tileLights`
 * (`../lighting/tiles/tiles.ts`), from the word the cascades' uniform names (`lists.x`). A cell's
 * record is at `((y · side + x) · side + z) · TILE_STRIDE` past it: its column's, then its cell's
 * along z. A point outside the lattice, a cascade-less frame, lists not yet listed, or a cell the
 * pool had no room for walks every declared light (`cellSlice`): the same sum, a light its cell
 * does not list reaching no point of it. The cell is the point's offset from the lattice's corner
 * times the cell's inverse side (`base.w`), which the lists' runs are widened past
 * (`WORLD_GRID_BOUNDS_WGSL`). Every reader of the irradiance walks it so — the bounce passes, the
 * reflections' proxy hits —: one behaviour of the loop.
 *
 * Cost: (B + R) · L light reads become (B + R) · L_cell, B the cache texels updated, R the probe
 * and reflection hits on owned leaves, L_cell the lights of their cells, for one pass over side²
 * columns and L lights a frame the lights change.
 */
export const BOUNCE_LIGHT_CELL_WGSL = wgslBlock(
  'BOUNCE_LIGHT_CELL_WGSL',
  [TILE_SLICE_WGSL],
  `
fn bounceLightSlice(P:vec3f)->vec2u{
 let start=bounce.lists.x;
 if(bounce.counts.y==0u||start==TILE_NO_SLICE){return vec2u(TILE_NO_SLICE,directLights.count);}
 let level=bounce.levels[bounce.counts.y-1u];
 let side=bounce.counts.x;
 let at=floor((P-level.base.xyz*level.originSpacing.w)*level.base.w);
 if(any(at<vec3f(0.0))||any(at>=vec3f(f32(side)))){return vec2u(TILE_NO_SLICE,directLights.count);}
 let cell=vec3u(at);
 return cellSlice(start+((cell.y*side+cell.x)*side+cell.z)*TILE_STRIDE);
}`,
)
