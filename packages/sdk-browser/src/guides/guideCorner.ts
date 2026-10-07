import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
/**
 * A corner of a guide's quad, `corner` naming its end (`x`: 0 at `a`, 1 at `b`) and its side
 * (`y`: ±1), in clip space. `lineClip` moves it off the segment by half the width; a second
 * `lineClip`, along that offset, moves it half a width past its end — the cap. A dot has no
 * screen direction of its own: it runs along the screen's `x` axis, and its quad is a square. Each
 * end is first put on the near plane (`lineClip` at no width): a segment whose two ends both slid
 * there lies wholly behind it and keeps no width, so its caps draw no square either.
 */
export const GUIDE_CORNER_WGSL = wgslBlock(
  'GUIDE_CORNER_WGSL',
  [],
  `fn guideCorner(ca:vec4f,cb:vec4f,corner:vec2f,width:f32,viewport:vec2f,pixelRatio:f32)->vec4f{
 let run=select(cb-ca,vec4f(1.0,0.0,0.0,0.0),length(cb-ca)==0.0);
 let na=lineClip(ca,run,0.0,viewport,pixelRatio);
 let nb=lineClip(cb,run,0.0,viewport,pixelRatio);
 let shown=select(width,0.0,length(na-ca)>0.0&&length(nb-cb)>0.0);
 let end=select(na,nb,corner.x>0.5);
 let side=lineClip(end,run*corner.y,shown,viewport,pixelRatio);
 return lineClip(side,(side-end)*(corner.y*(1.0-2.0*corner.x)),shown,viewport,pixelRatio);
}`,
)
