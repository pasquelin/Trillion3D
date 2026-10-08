import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { floorMod } from '../../../../math/src/wgsl/reals.ts'

/**
 * THE SCREEN-SPACE LINE: how a corner of a line quad (`drawnTriangles`, sdk-core `drawn.ts`)
 * leaves its segment.
 *
 * Every corner of a quad sits on an endpoint of its segment, and its normal carries the segment's
 * direction, signed by the side it moves to. A raster projects the corner, then moves it
 * perpendicular to the segment AS SEEN ON SCREEN by half the surface's `lineWidth`. The width is in
 * CSS pixels, never the image's own: the
 * image draws `lineWidth × pixelRatio` of its own pixels, the host's pixel ratio read each frame.
 * The line keeps that width at every distance, and its depth stays the segment's own.
 * The screen direction is the derivative of the projected point along the segment,
 * `(d.xy·w − p.xy·d.w) / w²`, exact at the corner, so a quad needs no second endpoint.
 *
 * A corner behind the near plane has no screen position: it first slides along the segment's line
 * onto that plane, where the part of the line in front of the camera begins. A segment wholly
 * behind slides both ends onto one point and draws nothing. Seen end-on, a segment has no screen
 * direction and its quad keeps no width: nothing is drawn, as a line seen end-on shows nothing.
 *
 * Every path draws reversed depth: the near plane is `z = w`. The bench's CPU image oracle runs
 * its TypeScript twin, statement for statement (`bench/oracles/browser/cpu-image/line.ts`).
 */
export const LINE_CLIP_WGSL = wgslBlock(
  'LINE_CLIP_WGSL',
  [],
  `fn lineClip(clip:vec4f,along:vec4f,width:f32,viewport:vec2f,pixelRatio:f32)->vec4f{
 let f=clip.w-clip.z;let g=along.w-along.z;
 let c=clip-along*select(0.0,f/g,f<0.0&&g!=0.0);
 let t=(along.xy*c.w-c.xy*along.w)*viewport;
 let n=length(t);
 if(n==0.0){return c;}
 return vec4f(c.xy+vec2f(-t.y,t.x)*(width*pixelRatio/n)/viewport*c.w,c.z,c.w);
}`,
)

/**
 * THE DASH: whether a pixel of a dashed line is drawn. `at` is the distance along the line of
 * the pixel, in world units — the first texture coordinate a dashed line's quads carry, the
 * running length of its segments (`drawnTriangles`, sdk-core `drawn.ts`) — and `dash` its
 * `(dashSize, gapSize)`. The line repeats a dash then a gap from its first vertex: a pixel whose distance modulo `dashSize + gapSize` passes
 * `dashSize` is in a gap, and every raster discards it. A dash of zero keeps every pixel: that is
 * a line that is not dashed. The rasters read it through the cutout (`maskKeep`, `pageWgsl.ts`),
 * the transparent pass in its fragment stage; the CPU image oracle by its twin (`lineDash`).
 */
export const LINE_DASH_WGSL = wgslBlock(
  'LINE_DASH_WGSL',
  [floorMod],
  `fn lineDash(at:f32,dash:vec2f)->bool{
 let period=dash.x+dash.y;
 return dash.x<=0.0||floorMod(at,period)<=dash.x;
}`,
)
