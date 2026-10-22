import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { HIZ_MIP_WGSL } from './rectWgsl.ts'
import { HIZ_LEVELS_STRUCT_WGSL, HIZ_READ_WGSL } from './pyramidTexture.ts'

/**
 * THE REFERENCE'S TEST OF A PIXEL RECTANGLE AGAINST THE CULLING LAYER: the rectangle halved to the
 * half-resolution texels (`pyramid level k + 1` is the half-resolution level `k`), the lowest level
 * where it spans at most four texels a side (`footprintLevel`), and the sixteen texels there — the
 * ones past a rectangle's edge clamped to it — whose minimum, the farthest depth of the footprint
 * in reverse-Z, a surface at `nearest` must not be behind (`pyramidShows`). A level past the last
 * shows everything. Reads the culling layer through `hizCullFarthest` over the host's `hizPyramid`
 * and `hizLevels` bindings: the cut's occlusion and, by the setting `hizTransparentTest`
 * `'reference'`, the transparent clusters' test.
 */
export const HIZ_FOOTPRINT_WGSL = wgslBlock(
  'HIZ_FOOTPRINT_WGSL',
  [HIZ_LEVELS_STRUCT_WGSL, HIZ_READ_WGSL, HIZ_MIP_WGSL],
  `/** The half-resolution level where an inclusive rectangle of half-resolution texels \`t\` spans at
 *  most four texels a side: two texels of level \`k\` cover \`2^(k+1)\`, one level more where the
 *  rectangle's alignment needs it. */
fn footprintLevel(t:vec4i)->u32{
 let span=t.zw-t.xy;
 let level=u32(max(max(firstLeadingBit(span.x),firstLeadingBit(span.y))-1,0));
 return level+select(0u,1u,any((t.zw>>vec2u(level))-(t.xy>>vec2u(level))>vec2i(3)));
}
/** The farthest depth of the footprint (\`footprintLevel\`) of the pixel rectangle \`r\`
 *  (\`centreRect\`): the minimum, in reverse-Z, of the sixteen texels there; zero when the level
 *  is past the last, which no depth is farther than. */
fn pyramidFarthest(r:vec4i)->f32{
 let half=vec4i(r.xy,max(r.xy,r.zw))>>vec4u(1u);
 let level=footprintLevel(half);
 let t=half>>vec4u(level);
 let l=level+1u;
 if(l>=hizLevels.count.x){return 0.0;}
 let mip=hizMip(l);let size=vec2i(hizLevels.level[l].yz);
 var farthest=1.0;
 for(var y=0;y<4;y++){
  for(var x=0;x<4;x++){
   let at=clamp(min(t.xy+vec2i(x,y),t.zw),vec2i(0),size-vec2i(1));
   farthest=min(farthest,hizCullFarthest(mip.x+u32(at.y)*mip.y+u32(at.x)));
  }
 }
 return farthest;
}
/** Whether the pyramid lets the pixel rectangle \`r\` (\`centreRect\`) show a surface at reversed
 *  depth \`nearest\`: the farthest depth of its footprint no nearer than it. */
fn pyramidShows(r:vec4i,nearest:f32)->bool{return nearest>=pyramidFarthest(r);}`,
)

/**
 * Whether the pyramid hides a projected box by the reference's test: the unclipped rectangle clipped
 * to the viewport (the host's uniform `uni`, `width` and `height`), then `pyramidShows` of the
 * box's nearest depth; a rectangle outside the viewport hides nothing. The transparent-cluster
 * test's other choice (`hiddenByPyramid`, `rectWgsl.ts`) reads the finer level.
 */
export const HIZ_REFERENCE_HIDDEN_WGSL = wgslBlock(
  'HIZ_REFERENCE_HIDDEN_WGSL',
  [HIZ_FOOTPRINT_WGSL],
  `fn hiddenByReferencePyramid(rect:vec4i,nearest:f32)->bool{
 let r=vec4i(max(rect.x,0),max(rect.y,0),min(rect.z,i32(uni.width)-1),min(rect.w,i32(uni.height)-1));
 if(r.z<r.x||r.w<r.y){return false;}
 return !pyramidShows(r,nearest);
}`,
)
