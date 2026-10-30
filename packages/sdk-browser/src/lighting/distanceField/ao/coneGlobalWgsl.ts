import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { globalDistanceFieldReadWgsl } from '../globalReadWgsl.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { DFAO_GRID_WGSL, DFAO_VISIBILITY_WRITE_WGSL } from './gridWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'

/** The side of the group of cone-grid cells one global trace covers. */
export const CONE_GLOBAL_GROUP = 8

/**
 * THE CONES AGAINST THE GLOBAL DISTANCE FIELD (`dfaoConeGlobal`), a thread a cone-grid cell, at the cell's position carried
 * to the field's translated space (`gdfTranslated`): the nine cones of its
 * surface's hemisphere, each stepped through the field of the finest clipmap that holds the surface further than
 * the occlusion distance from its edge.
 *
 * A step reads the distance to the nearest surface, the cone's visibility there the share of the cone's radius at
 * that offset the distance covers (a distance past the radius sees the whole sky), raised to a floor that fades in
 * with the offset over the occlusion distance, so that no seam stands where the trace ends; the cone keeps its least.
 * The next step is the distance away, or a voxel at least. Where the meshes' own fields are traced as well
 * (`objects`), the cones start where those end (their last step's offset); otherwise they start two voxels out,
 * and every visibility is scaled by `0.6 + 0.4 ·` the square of the share of that first step's distance in the
 * step itself (`leakFill`), so that a light leaking through a thin wall is covered. The nine are folded into the
 * cell's visibilities by minimum (`dfaoKeepVisibility`). The field's coarse mip is read through the hardware's filter where `filterableMip`, as in the
 * layout (`DFAO_LAYOUTS`).
 */
export const dfaoConeGlobalShader = (objects: boolean, filterableMip: boolean) =>
  wgslProgram(
    `fn dfaoTraceClipmap(clipmap:u32,position:vec3f,normal:vec3f,axes:DfaoAxes,cell:u32){
 let reach=dfao.global.x;
 let voxel=gdfView.centerExtent[clipmap].w*gdfView.texel;
 var firstOffset=voxel*2.0;
 var leakFill=1.0;
${
  objects
    ? ' firstOffset=max(firstOffset,dfaoStepOffset(f32(CONE_STEPS)));'
    : ` let around=gdfSample(position+normal*firstOffset,reach,clipmap)/firstOffset;
 leakFill=saturate(around*around)*0.4+0.6;`
}
 for(var cone=0u;cone<CONE_DIRECTIONS;cone++){
  let direction=dfaoConeDirection(cone,normal,axes);
  var least=1.0;
  var offset=firstOffset;
  for(var stepIndex=0u;stepIndex<CONE_STEPS&&offset<reach;stepIndex++){
   let toSurface=gdfSample(position+direction*offset,reach,clipmap);
   var visibility=saturate(toSurface/(offset*dfao.global.y));
   let fraction=(offset+toSurface)/reach;
   visibility=max(visibility,saturate(fraction*fraction*0.6));
   least=min(least,visibility);
   offset+=max(toSurface,voxel);
  }
  dfaoKeepVisibility(cone,cell,least*leakFill);
 }
}
@compute @workgroup_size(${CONE_GLOBAL_GROUP},${CONE_GLOBAL_GROUP})
fn dfaoConeGlobal(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.cones.xy)){return;}
 let cell=id.y*dfao.cones.x+id.x;
 let surface=dfaoGrid(dfaoCellTexel(id.xy));
 if(dot(surface.xyz,surface.xyz)<0.5){return;}
 let position=gdfTranslated(dfaoWorldAt(dfaoCellNdc(id.xy),surface.w));
 for(var clipmap=0u;clipmap<gdfView.clipmaps;clipmap++){
  let box=gdfView.centerExtent[clipmap];
  if(gdfBoxDistanceInside(box.xyz,box.w,position)>dfao.global.x){
   dfaoTraceClipmap(clipmap,position,surface.xyz,dfaoAxes(surface.xyz),cell);
   return;
  }
 }
}`,
    [
      DFAO_COMMON_WGSL,
      DFAO_GRID_WGSL,
      DFAO_VISIBILITY_WRITE_WGSL,
      globalDistanceFieldReadWgsl(0, B.field, filterableMip),
    ],
  )
