import { MODEL_SHIFT, SURFACE_MODEL_MASK } from '../materials/surface/surfaceModelWord.ts'
import {
  PIXEL_MODEL_MASK,
  PIXEL_MODEL_SHIFT,
  shadingFlagsOfNumber,
} from '../materials/surface/pixelModel.ts'
import { GRAPH_SHADING_MODELS } from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { LIGHTLESS_MODEL, volumeLightsNumber } from '../materials/surface/translucencyLighting.ts'

/** The item flags of a fragment whose graph picks its shading model (`g.model`, wired where `modelBit` of `g.flags` is set), the record's
 *  own where it does not: the stale pixel model number of the record's is cleared, the model's number then gives the flags the rule
 *  the record's model gives an item (`shadingFlagsOfNumber`: the unlit model clears the lit flag, a pixel model leaves its number in
 *  their bits), and the lane follows the one rule of the translucency lighting volume (`volumeLightsNumber`): a model the volume does not
 *  light (all but the default lit and the thin subsurface) puts a standard surface on the lightless lane (`lightlessLane`), a model it
 *  lights brings a lightless lane back to the standard one — the record's lane was made for the record's model, not this pixel's. A negative number wired is the default lit model. */
export const blendGraphFlagsWgsl = (
  modelBit: number,
) => `fn blendGraphFlags(flags:u32,g:BlendGraph)->u32{
 if((g.flags&${modelBit}u)==0u){return flags;}
 let number=select(${GRAPH_SHADING_MODELS.defaultLit}u,u32(g.model),g.model>=0);
 let out=shadingFlagsOfNumber(flags&~(${PIXEL_MODEL_MASK}u<<${PIXEL_MODEL_SHIFT}u),number);
 let lane=(out>>${MODEL_SHIFT}u)&${SURFACE_MODEL_MASK}u;
 let lightless=${LIGHTLESS_MODEL}u<<${MODEL_SHIFT}u;
 if(${volumeLightsNumber('number')}){return select(out,out&~lightless,lane==${LIGHTLESS_MODEL}u);}
 return select(out,out|lightless,lane==0u);
}
`
