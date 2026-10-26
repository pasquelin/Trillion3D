import type { CloudDepthSource } from './cloudModes.ts'

/**
 * WHAT THE VIEW TRACING READS OF THE SCENE'S DEPTH, one text for each place it reads it from
 * (`CloudSetup.depth`), declared in the tracing's group (`traceWgsl.ts`) and read by the one
 * function the tracing calls, `cloudSceneDepth`:
 * - `range`: the texture of the lowest and highest device depth of the block of the view a traced
 *   texel stands for, at half the size the depth is read at; the tracing keeps both, the closest
 *   surface for the second image;
 * - `checkerboard`: the half-size depth (`depthRange.ts`), the first channel; one surface;
 * - `scene`: the scene's depth itself; one surface.
 *
 * The texel read is the traced texel's times the mapping's scale, plus the pixel of the block the
 * image traces, kept inside the part of the image the view fills (`sizes` of the block). The
 * depth is a distance from the ray's origin (the eye, or in an orthographic view the pixel's point on
 * the near plane), in kilometres, of the point of the texel's ray at that device depth; the nearest depths that read as zero are held off it. Where only one surface is kept, the
 * closest and the furthest are the same.
 */

/** The texture of the scene's depth: a depth texture, or a colour one of the range. */
export const cloudDepthBinding = (group: number, binding: number, source: CloudDepthSource) =>
  `@group(${group}) @binding(${binding}) var depthRange:${source === 'scene' ? 'texture_depth_2d' : 'texture_2d<f32>'};`

/** The texel of the depth image the traced texel `p` reads. */
const COORD = `let coord=min(p*cloudTrace.mapping.x+cloudTrace.traced.zw,cloudTrace.sizes.zw);`

const RANGE = `
fn cloudSceneDepth(p:vec2u,ndc:vec2f)->CloudDepth{
 ${COORD}
 let range=textureLoad(depthRange,coord/2u,0).xy;
 let device=max(range.yx,vec2f(DEVICE_DEPTH_FLOOR));
 let closestKm=min(length(cloudUnproject(ndc,device.x)-cloudOrigin)*CLOUD_M_TO_KM,HALF_MAX);
 let furthestKm=min(length(cloudUnproject(ndc,device.y)-cloudOrigin)*CLOUD_M_TO_KM,HALF_MAX);
 var d:CloudDepth;
 d.closestCm=closestKm*CM_PER_KM;
 d.furthestCm=furthestKm*CM_PER_KM;
 d.km=vec4f(furthestKm,furthestKm,closestKm,furthestKm);
 return d;
}`

const ONE_SURFACE = (read: string) => `
fn cloudSceneDepth(p:vec2u,ndc:vec2f)->CloudDepth{
 ${COORD}
 let device=max(${read},DEVICE_DEPTH_FLOOR);
 let km=min(length(cloudUnproject(ndc,device)-cloudOrigin)*CLOUD_M_TO_KM,HALF_MAX);
 var d:CloudDepth;
 d.closestCm=km*CM_PER_KM;
 d.furthestCm=d.closestCm;
 d.km=vec4f(km);
 return d;
}`

/** The nearest and the farthest depth of the texel's block, as distances from the eye. */
export const cloudSceneDepthFn = (source: CloudDepthSource) =>
  source === 'range'
    ? RANGE
    : ONE_SURFACE(
        source === 'scene'
          ? 'textureLoad(depthRange,coord,0)'
          : 'textureLoad(depthRange,coord,0).x',
      )
