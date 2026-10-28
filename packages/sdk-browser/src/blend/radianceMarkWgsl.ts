import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { translucencyMedium } from '../lighting/translucency/modeWgsl.ts'
import { translucencyVolumeMarkWgsl } from '../lighting/translucency/markWgsl.ts'
import { hizDepthWgsl } from '../visibility/hiz/gpu/pyramidTexture.ts'
import {
  translucentMark,
  TRANSLUCENT_MARK_BINDINGS,
} from '../lighting/bounce/pool/translucentMark.ts'
import { clipDirective, type Clipping } from '../gpu/core/clipDistances.ts'
import { NO_VERTEX_WORDS } from './cloudVertexText.ts'
import { blendVertexWgsl, cutBlendByPixel } from './vertexWgsl.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
import { stageSurface } from './stageOptions.ts'
import { NO_WPO, type WpoSet } from '../materials/graph/wpoProgram.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { materialTableWgsl } from '../materials/table/materialWgsl.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { FACING_MATERIAL_MASK } from './facing.ts'
import { WORDS } from './vertexReadsWgsl.ts'
import { BLEND_LOBELESS_WGSL } from './physicalWgsl.ts'
import { BLEND_FRAGMENT_KEPT_WGSL } from './frontStageWgsl.ts'

/** The group the radiance mark's resources are bound in, and where its depth pyramid's three bindings begin in it. */
export const RADIANCE_MARK_GROUP = 1
export const RADIANCE_MARK_DEPTH_BINDING = 3
/** The bindings, after the depth pyramid's three, of the translucency volume's frame and of its marks (`translucencyVolumeMarkWgsl`). */
export const VOLUME_MARK_FRAME_BINDING = RADIANCE_MARK_DEPTH_BINDING + 3
export const VOLUME_MARK_TEXTURE_BINDING = VOLUME_MARK_FRAME_BINDING + 1

/**
 * THE RADIANCE MARK STAGE (`fsRadianceMark`), the translucent surfaces' fragment that marks the cells of the radiance cache they read
 * (`../lighting/bounce/pool/translucentMark.ts`), in a module of its own (`blendRadianceMarkShader`): the blend's vertex stage and material
 * reads, no light and no target. A fragment is marked unless the opaque surfaces hide it (the farthest depth of the pyramid's level `hizMip`
 * at its place being nearer than it, compared as device depths, the reverse of a view depth's order, so handed over negated), the blend would
 * not keep it (`blendFragmentKept`: the cutout, the line dash, a thin layer always kept), or its surface is lit as a medium
 * (`translucencyMedium`: a medium reads the translucency lighting volume, not the cache). The same fragment marks the cells of the
 * translucency lighting volume the surface reads (`translucencyVolumeMarkVoxels`, `translucencyVolumeMarkWgsl`), mediums included, as the reference
 * marks both in one pass. Its bindings: the parameters, the levels' uniform and the bitmap (`TRANSLUCENT_MARK_BINDINGS`), then the depth pyramid
 * (`hizDepthWgsl`), then the volume's frame and marks, in the group after the blend's.
 */
const radianceMarkStageWgsl = (graphs: readonly SurfaceProgram[]) =>
  wgslBlock(
    `radianceMarkStageWgsl(${graphs.length ? 'graphs' : ''})`,
    [
      stageSurface(false, graphs),
      materialTableWgsl(BLEND_BINDINGS.material),
      translucencyMedium,
      BLEND_FRAGMENT_KEPT_WGSL,
      BLEND_LOBELESS_WGSL,
      hizDepthWgsl(RADIANCE_MARK_GROUP, RADIANCE_MARK_DEPTH_BINDING),
      translucentMark(RADIANCE_MARK_GROUP, TRANSLUCENT_MARK_BINDINGS),
      translucencyVolumeMarkWgsl(
        RADIANCE_MARK_GROUP,
        VOLUME_MARK_FRAME_BINDING,
        VOLUME_MARK_TEXTURE_BINDING,
      ),
    ],
    `/** The farthest opaque depth at the place \`uv\` of the view, in the pyramid's level \`hizMip\` (level 0 is the depth itself). */
fn markFarthest(uv:vec2f)->f32{
 let level=min(i32(translucentMark.hizMip),hizLevelCount()-1);
 if(level<=0){return hizOpaqueDepth(vec2i(uv*vec2f(hizLevels.level[0].yz)));}
 return hizCellCullFarthest(vec2i(uv*vec2f(hizLevels.level[level].yz)),level);
}
@fragment fn fsRadianceMark(in:VSOut,@builtin(front_facing) front:bool){
 let g=blendGrads(in);
 if(translucentMarkHidden(-in.position.z,-markFarthest(translucentMarkUv(in.position.xy)))){discard;return;}
 let thin=materialAt(in.${WORDS.material}&${FACING_MATERIAL_MASK}u).transmission>0.0;
 let flags=${graphs.length ? 'blendGraphFlags(in.ids.y,g.graph)' : 'in.ids.y'};
 // The base map is sampled only where the cutout asks its alpha: a thin layer is kept whole, a cutout of 0 passes any alpha.
 var base=vec4f(1.0);
 if(!thin&&in.alphaAo.x>0.0){base=blendBase(in,g);}
 if(!blendFragmentKept(in,base,thin,front)){discard;return;}
 if(tv.marks.x!=0u){markVolumeVoxels(in.view);}
 if(translucencyMedium(flags)){return;}
 markTranslucent(in.position.xy,in.view);
}`,
  )

/** The radiance mark stage's module (`fsRadianceMark`): the blend's vertex stage, its maps, and the stage; with `graphs`, the programs of the
 *  graphs its items wear, `offsets` those that move their vertices. */
export const blendRadianceMarkShader = (
  clipping?: Clipping,
  graphs: readonly SurfaceProgram[] = [],
  offsets: WpoSet = NO_WPO,
) =>
  cutBlendByPixel(
    wgslModule(
      blendVertexWgsl(false, clipping, NO_VERTEX_WORDS, offsets),
      BLEND_MAPS_WGSL,
      radianceMarkStageWgsl(graphs),
      ...clipDirective(clipping),
    ),
    clipping,
  )
