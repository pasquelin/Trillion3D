/**
 * THE SCREEN-SPACE LINE: how a corner of a line quad (`drawnTriangles`, sdk-core `drawn.ts`)
 * leaves its segment.
 *
 * Every corner of a quad sits on an endpoint of its segment, and its normal carries the segment's
 * direction, signed by the side it moves to. A raster projects the corner, then moves it
 * perpendicular to the segment AS SEEN ON SCREEN by half the surface's `lineWidth`, in pixels of
 * the image: the line keeps that width at every distance, and its depth stays the segment's own.
 * The screen direction is the derivative of the projected point along the segment,
 * `(d.xy·w − p.xy·d.w) / w²`, exact at the corner, so a quad needs no second endpoint.
 *
 * A corner behind the near plane has no screen position: it first slides along the segment's line
 * onto that plane, where the part of the line in front of the camera begins. A segment wholly
 * behind slides both ends onto one point and draws nothing. Seen end-on, a segment has no screen
 * direction and its quad keeps no width: nothing is drawn, as a line seen end-on shows nothing.
 *
 * The WebGPU paths draw reversed depth (near plane `z = w`), the WebGL2 path forward depth (near
 * plane `z = −w`): the only difference between the two texts, statement for statement.
 */
export const LINE_CLIP_WGSL = `fn lineClip(clip:vec4f,along:vec4f,width:f32,viewport:vec2f)->vec4f{
 let f=clip.w-clip.z;let g=along.w-along.z;
 let c=clip-along*select(0.0,f/g,f<0.0&&g!=0.0);
 let t=(along.xy*c.w-c.xy*along.w)*viewport;
 let n=length(t);
 if(n==0.0){return c;}
 return vec4f(c.xy+vec2f(-t.y,t.x)*(width/n)/viewport*c.w,c.z,c.w);
}`;

/** The same corner in the WebGL2 program's forward depth (`../../webgl/cluster/shaders.ts`). */
export const LINE_CLIP_GLSL = `vec4 lineClip(vec4 clip,vec4 along,float width,vec2 viewport){
 float f=clip.w+clip.z,g=along.w+along.z;
 vec4 c=clip-along*(f<0.0&&g!=0.0?f/g:0.0);
 vec2 t=(along.xy*c.w-c.xy*along.w)*viewport;
 float n=length(t);
 if(n==0.0)return c;
 return vec4(c.xy+vec2(-t.y,t.x)*(width/n)/viewport*c.w,c.z,c.w);
}`;
