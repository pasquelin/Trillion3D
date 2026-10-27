import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS as CARD_RANGE_IN_VOXELS,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE as GRID_CELL_SIZE,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { globalDistanceFieldTraceWgsl } from '../distanceField/globalTraceWgsl.ts'
import { globalObjectGridReadWgsl } from '../distanceField/objectGridWgsl.ts'
import { globalReadLayoutEntries, type GlobalFieldRead } from '../distanceField/view.ts'
import {
  SURFACE_CACHE_LAYER_AT as L,
  surfaceCacheReadLayoutEntries,
  surfaceCacheSampleWgsl,
} from './sampleWgsl.ts'

/**
 * THE LIGHT OF THE SURFACE A RAY MARCHED THROUGH THE GLOBAL DISTANCE FIELD MET (`scGlobalHit`), read in the surface cache's final
 * lighting: the one hit read of the rays that bring light back — the screen probes', the radiance cache's, the world probes',
 * the cache's own radiosity's and the reflections'.
 *
 * The march's hit (`GdfTraceResult`, from the world point `origin` along `dir`) is a point of the world, where the field's gradient
 * (`gdfNormal`, the ray turned back where it vanishes) gives the surface's face. One voxel of that clipmap along the face, the
 * point finds, in the field's object grid, the cell of the objects near it — up to four, the nearest first (`gdfObjectGridCellOf`) —
 * and their cards: the object's instance is the placement of the cache by `hitInstances` (the table of `../reflections/hitInstances.ts`,
 * at binding `instances`), whose mesh cards (`scPlacementMeshCards`) are read at the point (`scSampleMeshCards`), the cards' range
 * `CARD_RANGE_IN_VOXELS` voxels of the clipmap, the footprint of the ray's cone at the hit (`spread`, the tangent of its half angle,
 * times the hit time) its radius — the finest page of a card in the atlas for a ray that asks it (`hiRes`). The objects are read in
 * turn until the weights the cards gave reach 0.9; the light of the surface is the sums over their weight (`scEvaluate`, the final
 * layer's). The answer (`ScHitSurface`) holds that light, the surface's face and whether any card gave any weight: where none did the
 * hit is dark and `valid` is false, which a reader that has another answer for the ray (the reflections') takes up.
 *
 * A ray whose surface expands by its time (`fade`: `GdfTraceInput.expandByTime`) brings back none of its light for a hit nearer than
 * one and a half voxels, and all of it from two: it never reads its own surface, so that no light feeds back at once. A ray that
 * starts inside a surface (`hitTime <= startedInside`, a time under 0 for a ray that has no such rule) brings back none.
 *
 * Lengths are centimetres, the cards' and the field's unit. The reads of the field (`globalDistanceFieldTraceWgsl`), its grid and
 * the cache's library (`surfaceCacheSampleWgsl`, which writes the feedback — the finer page the ray's cone would have read — only for
 * a program whose bindings say so: `SurfaceHitBindings.feedback`, at the pixel `coord`) are read at the bindings of `SurfaceHitBindings`.
 */

/** Where a program of group `group` binds what a hit reads: the global field's six bindings from `field`, its object grid, the cache's
 *  library from `cards` (the tables, then the layers and the feedback buffer where `feedback`, at `SURFACE_CACHE_LAYER_AT`), and the table from an object
 *  of the grid to its placement in the cache. */
export interface SurfaceHitBindings {
  readonly group: number
  readonly field: number
  readonly grid: number
  readonly cards: number
  readonly instances: number
  readonly feedback?: boolean
}

/** The bindings of a program that binds a hit's reads consecutively from `first`: its field, its grid, its cards, its instances. */
export const surfaceHitBindingsFrom = (group: number, first: number): SurfaceHitBindings => ({
  group,
  field: first,
  grid: first + 6,
  cards: first + 7,
  instances: first + 15,
})

/** The cards' bindings a hit reads, as offsets of `cards`: the tables, the depth and the final light. */
const SURFACE_HIT_CARDS_READ = [0, L.depth, L.final] as const

/** What the library is asked to read at `b`: the emission, which a compressed atlas keeps as blocks, is no layer a hit reads. */
const readOf = (b: Pick<SurfaceHitBindings, 'feedback'>) => ({
  feedback: !!b.feedback,
  compressed: false,
})

/** What a hit reads of the cache, as the bind group binds it: its tables, the depth and final layers, the feedback buffer, the field's
 *  object grid and the table of instances (`../reflections/hitCards.ts`). */
export interface SurfaceHitResources {
  readonly tables: GPUBuffer
  readonly depth: GPUTextureView
  readonly final: GPUTextureView
  readonly feedback: GPUBuffer
  readonly grid: GPUBuffer
  readonly instances: GPUBuffer
}

/** What a pass whose rays read the cache at their hits binds: the global field they are marched through and the cache's resources
 *  (`surfaceHitReads`, `frame.ts`). */
export interface SurfaceHitReads {
  field: GlobalFieldRead
  hit: SurfaceHitResources
}

/** The layout entries of what a hit reads of the cache at `b`: its tables, depth and final layers and its feedback buffer where `b` says
 *  (the library's other layers are left out of the stage's layout: it holds nothing of a binding it does not reach), the instances'. */
export function surfaceHitCardsLayoutEntries(
  b: Pick<SurfaceHitBindings, 'cards' | 'instances' | 'feedback'>,
): GPUBindGroupLayoutEntry[] {
  const read = SURFACE_HIT_CARDS_READ.map((at) => b.cards + at)
  if (b.feedback) read.push(b.cards + L.feedback)
  return [
    ...surfaceCacheReadLayoutEntries(b.cards, readOf(b)).filter(({ binding }) =>
      read.includes(binding),
    ),
    computeBufferEntry(b.instances, 'read-only-storage'),
  ]
}

/** The layout entries of a hit's reads at `b`: the field's, its grid's, then the cache's (`surfaceHitCardsLayoutEntries`). */
export function surfaceHitLayoutEntries(b: SurfaceHitBindings): GPUBindGroupLayoutEntry[] {
  return [
    ...globalReadLayoutEntries(b.field),
    computeBufferEntry(b.grid, 'read-only-storage'),
    ...surfaceHitCardsLayoutEntries(b),
  ]
}

/** The bind group entries of what a hit reads of the cache at `b`, over the cache's `hit` resources. */
export function surfaceHitCardsEntries(
  b: Pick<SurfaceHitBindings, 'cards' | 'instances' | 'feedback'>,
  hit: SurfaceHitResources,
): GPUBindGroupEntry[] {
  return [
    { binding: b.cards, resource: { buffer: hit.tables } },
    { binding: b.cards + L.depth, resource: hit.depth },
    { binding: b.cards + L.final, resource: hit.final },
    ...(b.feedback ? [{ binding: b.cards + L.feedback, resource: { buffer: hit.feedback } }] : []),
    { binding: b.instances, resource: { buffer: hit.instances } },
  ]
}

/** The bind group entries of a hit's reads at `b`, over the global `field` and the cache's `hit` resources. */
export function surfaceHitEntries(
  b: SurfaceHitBindings,
  field: GlobalFieldRead,
  hit: SurfaceHitResources,
): GPUBindGroupEntry[] {
  return [
    ...field.readEntries(b.field),
    { binding: b.grid, resource: { buffer: hit.grid } },
    ...surfaceHitCardsEntries(b, hit),
  ]
}

/** The placement of a hit and the cone of a ray, over the bindings `b`: the table from an instance (an object of the grid, or a
 *  placement of the scene trace's cut) to its placement in the cache, and the cache's read library the placement's mesh cards are
 *  read with (`scPlacementMeshCards`, `scEvaluateMeshCards`). Nothing of the global field: a hit found without it reads this alone. */
export function surfaceHitCardsWgsl(
  b: Pick<SurfaceHitBindings, 'group' | 'cards' | 'instances' | 'feedback'>,
) {
  return wgslBlock(
    `SURFACE_HIT_CARDS_WGSL(${b.group},${b.cards},${b.instances},${!!b.feedback})`,
    [surfaceCacheSampleWgsl(b.group, b.cards, readOf(b))],
    `@group(${b.group}) @binding(${b.instances}) var<storage,read> hitInstances:array<u32>;
/** The placement of the cache that the object of the grid named \`instance\` is, none for an instance past the table. */
fn scHitPlacement(instance:u32)->u32{
 if(instance>=hitInstances[0]){return SC_NONE;}
 return hitInstances[1u+instance];
}
/** The tangent of the half angle of the cone of a ray that is one of \`side²\` that share the sphere's solid angle: \`acos(1 - 1 / side²)\`. */
fn scConeTangent(side:f32)->f32{
 let c=max(1.0-1.0/(side*side),0.05);
 return sqrt(1.0-c*c)/c;
}`,
  )
}

/** The hit's read (`scGlobalHit`) over the bindings `b`, and the march (`gdfTrace`) it follows. */
export function surfaceHitWgsl(b: SurfaceHitBindings) {
  return wgslBlock(
    `SURFACE_HIT_WGSL(${b.group},${b.field},${b.grid},${b.cards},${b.instances},${!!b.feedback})`,
    [
      surfaceHitCardsWgsl(b),
      globalDistanceFieldTraceWgsl(b.group, b.field),
      globalObjectGridReadWgsl(b.group, b.field, b.grid),
    ],
    `struct ScHitSurface{radiance:vec3f,face:vec3f,valid:bool,}
/** The surface the march \`hit\` of the ray from the world point \`origin\` along \`dir\` met: its light, its face, and whether the cache gave
 *  any. \`spread\` is the tangent of the angle of the ray's cone, \`hiRes\` whether the finest pages are read, \`coord\` the pixel the
 *  feedback is written for. */
fn scGlobalHit(origin:vec3f,dir:vec3f,hit:GdfTraceResult,spread:f32,fade:bool,startedInside:f32,hiRes:bool,coord:vec2u)->ScHitSurface{
 let world=origin+dir*hit.hitTime;
 let translated=gdfTranslated(world);
 let face=gdfNormal(translated,hit.clipmap,-dir);
 let voxel=gdfView.centerExtent[hit.clipmap].w*gdfView.texel;
 var factor=select(1.0,smoothstep(1.5*voxel,2.0*voxel,hit.hitTime),fade);
 if(hit.hitTime<=startedInside){factor=0.0;}
 if(!(factor>0.0)){return ScHitSurface(vec3f(0.0),face,false);}
 let cell=gdfObjectGridCellOf(translated+face*voxel,hit.clipmap);
 // The march's hit sits \`expand\` past the surface: the cards are read half of it nearer.
 let cardAt=world+dir*0.5*hit.expand;
 var taken=scAccumulator();
 for(var k=0u;k<${GRID_CELL_SIZE}u;k++){
  if(!gdfGridValid(cell[k])){break;}
  let cards=scPlacementMeshCards(scHitPlacement(gdfGridInstance(cell[k])));
  scSampleMeshCards(cards,cardAt,face,spread*hit.hitTime,${CARD_RANGE_IN_VOXELS}.0*voxel,hiRes,&taken);
  if(taken.weightSum>=0.9){break;}
 }
 let light=scEvaluate(taken,coord);
 return ScHitSurface(factor*light.radiance,face,light.valid);
}`,
  )
}
