import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsWgsl, type SurfaceHitBindings } from '../surfaceCache/hitWgsl.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'

/** The centimetres in a metre (`BOUNCE_CM`), the field's unit, which the lengths of a ray are converted to and the cards are read in. */
export const BOUNCE_CM_WGSL = wgslBlock(
  'BOUNCE_CM_WGSL',
  [],
  wgslConsts({ BOUNCE_CM: DISTANCE_FIELD_UNITS_PER_METRE }),
)

/**
 * THE LIGHT THE CARDS OF A HIT HOLD (`tracedCardLight`): the cards of the placement the object `object` names (`scHitPlacement`) read at the world point `world` (centimetres) of a hit `hitCm` centimetres away, its normal
 * `normal`, over `radius` centimetres of footprint and `depthBias` of sampling depth bias, `hiRes` the finest pages; the back of a one-sided primitive brings none, nor does a hit nearer than `nearest` centimetres
 * (the cards are too coarse to tell a surface from the one it lights).
 */
export const tracedCardLightWgsl = (
  cards: Pick<SurfaceHitBindings, 'group' | 'cards' | 'instances' | 'visualize'>,
  light: LightAtlasFormat,
) =>
  wgslBlock(
    `tracedCardLightWgsl(${cards.group},${cards.cards},${cards.instances},${cards.visualize ?? 0},${light})`,
    [BOUNCE_CM_WGSL, surfaceHitCardsWgsl(cards, light)],
    `fn tracedCardLight(object:u32,frontFace:bool,twoSided:bool,hitCm:f32,world:vec3f,normal:vec3f,radius:f32,depthBias:f32,nearest:f32,hiRes:bool,coord:vec2u)->ScHit{
 if((!frontFace&&!twoSided)||hitCm<nearest){return ScHit(vec3f(0.0),false);}
 return scEvaluateMeshCards(scPlacementMeshCards(scHitPlacement(object)),world,normal,radius,depthBias,hiRes,coord);
}`,
  )

/** The cards of a hit of the hit lighting's second pass (`litCards`, read by `litResolve`): the indirect light the placement's cards hold at the hit, over the footprint of the ray's cone, `depthBias` and `nearest` (centimetres) being the host's WGSL expressions. */
export const tracedLitCardsWgsl = (depthBias: string, nearest: string) =>
  wgslBlock(
    `TRACED_LIT_CARDS_WGSL(${depthBias}|${nearest})`,
    [],
    `fn litCards(object:u32,P:vec3f,N:vec3f,distance:f32,look:LitLook)->ScHit{
 let hitCm=distance*f32(BOUNCE_CM);
 return tracedCardLight(object,true,true,hitCm,P*f32(BOUNCE_CM),N,scConeTangent(look.cone)*hitCm,${depthBias},${nearest},false,look.coord);
}`,
  )

/**
 * THE LIGHT OF A HIT OF A RAY CAST THROUGH THE SCENE'S TRIANGLES (`tracedHitLight`), the one text the world probes' rays and the screen probes'
 * share: the hit `hit` of the ray from the world point `origin` along `d` (a trace in the scene trace's group `scene.group`) brings the light the
 * cards of the placement it met hold at its point (`scHitPlacement` by the object the hit names, `scEvaluateMeshCards`: the coarse pages, no
 * feedback), with the hit's normal, the footprint of the cone of a ray of `side²` that share the sphere at the hit's distance, and
 * `depthBias` centimetres of sampling depth bias, for how far a texel of a card may lie from the point; the back of a one-sided primitive
 * brings none, nor does a hit nearer than `nearest` centimetres (the cards are too coarse to tell a surface from the one it lights).
 */
export const tracedHitLightWgsl = (
  cards: Pick<SurfaceHitBindings, 'group' | 'cards' | 'instances' | 'visualize'>,
  scene: { readonly group: number; readonly first: number },
  light: LightAtlasFormat,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
) =>
  wgslBlock(
    `tracedHitLightWgsl(${cards.group},${cards.cards},${cards.instances},${scene.group},${scene.first},${light},${sceneMaskKey(programs)})`,
    [
      BOUNCE_CM_WGSL,
      tracedCardLightWgsl(cards, light),
      sceneTraceWgsl(scene.group, scene.first),
      sceneMaskWgsl(scene.group, scene.first, programs),
    ],
    `fn tracedHitLight(hit:StHit,origin:vec3f,d:vec3f,side:f32,depthBias:f32,nearest:f32,coord:vec2u)->vec3f{
 let hitCm=hit.distance*f32(BOUNCE_CM);
 return tracedCardLight(hit.object,hit.frontFace,hit.twoSided,hitCm,origin*f32(BOUNCE_CM)+d*hitCm,hit.normal,scConeTangent(side)*hitCm,depthBias,nearest,false,coord).radiance;
}`,
  )
