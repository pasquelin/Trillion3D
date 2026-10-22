import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TILE_SLICE_WGSL } from '../direct/lightingWgsl.ts'
import { BOUNCE_GRID_HEAD_WGSL } from './gridWgsl.ts'

/** The binding the bounce probe pass reads the light grid's buffer at (`bindings.ts`): the view's
 *  records and lists, then the world grid's. */
export const BOUNCE_LIGHT_LIST_BINDING = 6

/**
 * The lights a bounce point walks (`bounceLightSlice`): the list of its cell of the world light grid,
 * a lattice of `lightGridSide` cells a side over the scene (`lightLattice`, the uniform's `lattice`), which the light grid pass lists
 * per cell as it lists the view's, in the same buffer every reader of a list binds as `tileLights`
 * (`../tiles/tiles.ts`), from the word the levels' uniform names (`lists.x`). A cell's
 * record is at `((y · side + x) · side + z) · TILE_STRIDE` past it: its column's, then its cell's
 * along z. A point outside the lattice reads the edge cell it is clamped to, whose list holds every
 * light that reaches past it (`WORLD_GRID_BOUNDS_WGSL`): no point walks every light for lying out of
 * the lattice. No lists — none listed yet, a device without the grid — or a cell the pool had no room for is the one rule of a
 * missing list (`cellSlice`): every declared light, the same sum, a light its cell does not list
 * reaching no point of it. The cell is the point's offset from the lattice's corner over the cell's side, as the
 * lists' runs are cut (`lightRun`), which they are widened past. Every reader of the irradiance
 * walks it so — the bounce passes, the reflections' proxy hits —: one behaviour of the loop.
 *
 * Cost: R · L light reads become R · L_cell, R the probe and reflection hits on owned leaves,
 * L_cell the lights of their cells, for one pass over side²
 * columns and L lights a frame the lights change.
 */
export const BOUNCE_LIGHT_CELL_WGSL = wgslBlock(
  'BOUNCE_LIGHT_CELL_WGSL',
  [TILE_SLICE_WGSL, BOUNCE_GRID_HEAD_WGSL],
  `
fn bounceLightSlice(P:vec3f)->vec2u{
 let start=bounce.lists.x;
 let side=bounce.lists.y;
 let at=floor((P-bounce.lattice.xyz)/bounce.lattice.w);
 let cell=vec3u(clamp(at,vec3f(0.0),vec3f(f32(side-1u))));
 return cellSlice(select(start+((cell.y*side+cell.x)*side+cell.z)*TILE_STRIDE,TILE_NO_SLICE,start==TILE_NO_SLICE));
}`,
)
