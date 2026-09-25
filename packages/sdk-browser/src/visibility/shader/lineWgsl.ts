/**
 * THE SCREEN-SPACE LINE: how a corner of a line quad (`drawnTriangles`, sdk-core `drawn.ts`)
 * leaves its segment.
 *
 * Every corner of a quad sits on an endpoint of its segment, and its normal carries the segment's
 * direction, signed by the side it moves to. A raster projects the corner, then moves it
 * perpendicular to the segment AS SEEN ON SCREEN by half the surface's `lineWidth`. The width is in
 * CSS pixels, as the reference's `LineMaterial` counts it (its `resolution` is the CSS size): the
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
 * The WebGPU paths draw reversed depth (near plane `z = w`), the WebGL2 path forward depth (near
 * plane `z = −w`): the only difference between the two texts, statement for statement. The CPU
 * software raster runs `lineClip` below, the WGSL text's twin.
 */
export const LINE_CLIP_WGSL = `fn lineClip(clip:vec4f,along:vec4f,width:f32,viewport:vec2f,pixelRatio:f32)->vec4f{
 let f=clip.w-clip.z;let g=along.w-along.z;
 let c=clip-along*select(0.0,f/g,f<0.0&&g!=0.0);
 let t=(along.xy*c.w-c.xy*along.w)*viewport;
 let n=length(t);
 if(n==0.0){return c;}
 return vec4f(c.xy+vec2f(-t.y,t.x)*(width*pixelRatio/n)/viewport*c.w,c.z,c.w);
}`;

/** The same corner in the WebGL2 program's forward depth (`../../webgl/cluster/shaders.ts`). */
export const LINE_CLIP_GLSL = `vec4 lineClip(vec4 clip,vec4 along,float width,vec2 viewport,float pixelRatio){
 float f=clip.w+clip.z,g=along.w+along.z;
 vec4 c=clip-along*(f<0.0&&g!=0.0?f/g:0.0);
 vec2 t=(along.xy*c.w-c.xy*along.w)*viewport;
 float n=length(t);
 if(n==0.0)return c;
 return vec4(c.xy+vec2(-t.y,t.x)*(width*pixelRatio/n)/viewport*c.w,c.z,c.w);
}`;

/** `LINE_CLIP_WGSL` on the CPU, statement for statement, in the engine's reversed depth: the
 *  software raster (`../projection.ts`) widens a line quad's corner with it. Writes into `out`,
 *  which may be `clip` itself; `viewport` is `[width, height]`. */
export function lineClip(
  out: Float64Array,
  clip: ArrayLike<number>,
  along: ArrayLike<number>,
  width: number,
  viewport: ArrayLike<number>,
  pixelRatio: number,
) {
  const f = clip[3] - clip[2],
    g = along[3] - along[2];
  const k = f < 0 && g !== 0 ? f / g : 0;
  for (let i = 0; i < 4; i++) out[i] = clip[i] - along[i] * k;
  const tx = (along[0] * out[3] - out[0] * along[3]) * viewport[0],
    ty = (along[1] * out[3] - out[1] * along[3]) * viewport[1];
  const n = Math.hypot(tx, ty);
  if (n === 0) return out;
  const s = (width * pixelRatio) / n;
  out[0] += ((-ty * s) / viewport[0]) * out[3];
  out[1] += ((tx * s) / viewport[1]) * out[3];
  return out;
}

/**
 * THE DASH: whether a pixel of a dashed line is drawn. `at` is the distance along the line of
 * the pixel, in world units — the first texture coordinate a dashed line's quads carry, the
 * running length of its segments (`drawnTriangles`, sdk-core `drawn.ts`) — and `dash` its
 * `(dashSize, gapSize)`. The line repeats a dash then a gap from its first vertex, as the
 * reference's `LineDashedMaterial` does: a pixel whose distance modulo `dashSize + gapSize` passes
 * `dashSize` is in a gap, and every raster discards it. A dash of zero keeps every pixel: that is
 * a line that is not dashed. The rasters read it through the cutout (`maskKeep`, `pageWgsl.ts`),
 * the transparent pass and the opaque fallback in their fragment stage, the CPU raster by `lineDash`.
 */
export const LINE_DASH_WGSL = `fn lineDash(at:f32,dash:vec2f)->bool{
 let period=dash.x+dash.y;
 return dash.x<=0.0||at-period*floor(at/period)<=dash.x;
}`;

/** The same dash in the WebGL2 program (`../../webgl/cluster/shaders.ts`). */
export const LINE_DASH_GLSL = `bool lineDash(float at,vec2 dash){
 float period=dash.x+dash.y;
 return dash.x<=0.0||at-period*floor(at/period)<=dash.x;
}`;

/** `LINE_DASH_WGSL` on the CPU, statement for statement: the software raster's dash. */
export function lineDash(at: number, dashSize: number, gapSize: number) {
  const period = dashSize + gapSize;
  return dashSize <= 0 || at - period * Math.floor(at / period) <= dashSize;
}
