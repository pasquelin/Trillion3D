import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE } from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
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
 * THE LIGHT OF A HIT OF A RAY CAST THROUGH THE SCENE'S TRIANGLES (`tracedHitLight`), the one text the world probes' rays and the screen probes'
 * share: the hit `hit` of the ray from the world point `origin` along `d` (a trace in the scene trace's group `scene.group`) brings the light the
 * cards of the placement it met hold at its point (`scHitPlacement` by the object the hit names, `scEvaluateMeshCards`: the coarse pages, no
 * feedback), with the hit's normal, the footprint of the cone of a ray of `side²` that share the sphere at the hit's distance, and
 * `depthBias` centimetres of sampling depth bias, for how far a texel of a card may lie from the point; the back of a one-sided primitive
 * brings none, nor does a hit nearer than `nearest` centimetres (the cards are too coarse to tell a surface from the one it lights).
 */
export const tracedHitLightWgsl = (
  cards: Pick<SurfaceHitBindings, 'group' | 'cards' | 'instances'>,
  scene: { readonly group: number; readonly first: number },
  light: LightAtlasFormat,
) =>
  wgslBlock(
    `tracedHitLightWgsl(${cards.group},${cards.cards},${cards.instances},${scene.group},${scene.first},${light})`,
    [BOUNCE_CM_WGSL, surfaceHitCardsWgsl(cards, light), sceneTraceWgsl(scene.group, scene.first)],
    `fn tracedHitLight(hit:StHit,origin:vec3f,d:vec3f,side:f32,depthBias:f32,nearest:f32,coord:vec2u)->vec3f{
 let hitCm=hit.distance*f32(BOUNCE_CM);
 if((!hit.frontFace&&!hit.twoSided)||hitCm<nearest){return vec3f(0.0);}
 let placement=scPlacementMeshCards(scHitPlacement(hit.object));
 return scEvaluateMeshCards(placement,origin*f32(BOUNCE_CM)+d*hitCm,hit.normal,scConeTangent(side)*hitCm,depthBias,false,coord).radiance;
}`,
  )
