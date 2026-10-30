import * as layer from './layers.ts'
import { bindingsWgsl, type UpdateShape } from './bindingsWgsl.ts'
import { HISTORY_WEIGHTS_WGSL, historyReadWgsl, historyWeightsWgsl } from './historyWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { RANGE_BOUND } from '../../../../math/src/wgsl/constants.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { ndcToUv, uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import {
  COLOR_SPACES_WGSL,
  DITHER_WGSL,
  FULL_PRECISION,
  colorSpacesWgsl,
  ditherWgsl,
  sceneColorWgsl,
  SCENE_COLOR_WORDS,
  type Precision,
} from './colorSpaceWgsl.ts'
import { REPROJECTION_VECTOR_WGSL } from './velocityWgsl.ts'
import { ANTI_ALIAS_OFFSET_WGSL } from './spatialAntiAliasingWgsl.ts'

/** What the history update opens with: bindings, uniform, the colour spaces, the scene colour's
 *  words in the history's colour format (`sceneColorWgsl`) and their read at a render texel, the
 *  history's read and weight laws (`historyWgsl.ts`), the reprojection vector's decoding and the
 *  anti-aliaser's offset (`spatialAntiAliasingWgsl.ts`), and the layers' bindings (`layers.ts`). */
export const taaPrelude = (shape: UpdateShape, p: Precision = FULL_PRECISION) =>
  wgslBlock(
    `taaPrelude(${shape.filtered}, ${shape.color}, ${shape.validity}, ${shape.half}, ${p.F})`,
    [
      bindingsWgsl(shape),
      COLOR_SPACES_WGSL,
      colorSpacesWgsl(p),
      DITHER_WGSL,
      ditherWgsl(p),
      sceneColorWgsl(shape.color),
      historyReadWgsl(p),
      HISTORY_WEIGHTS_WGSL,
      historyWeightsWgsl(p),
      REPROJECTION_VECTOR_WGSL,
      ANTI_ALIAS_OFFSET_WGSL,
      RANGE_BOUND,
      clampToExtent,
      ndcToUv,
      uvToNdc,
    ],
    `${layer.layerText(shape.filtered, 'bindings')}
fn sceneColorAt(c:vec2i)->vec4f{
 let at=(u32(c.y)*u32(view.analysisGrid.x)+u32(c.x))*${SCENE_COLOR_WORDS}u;
 var words:array<u32,${SCENE_COLOR_WORDS}>;
 for(var k=0u;k<${SCENE_COLOR_WORDS}u;k++){words[k]=sceneColor[at+k];}
 return unpackSceneColor(words);
}`,
  )
