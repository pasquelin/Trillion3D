import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { GRAPH_SHADING_MODELS } from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { PIXEL_MODEL, isPixelModel } from './pixelModel.ts'
import { SHADING_MODEL_MODEL_SHIFT } from './surfaceModelWord.ts'

const SHADING_MODEL_CODES = [
  PIXEL_MODEL.skin,
  PIXEL_MODEL.profile,
  PIXEL_MODEL.eye,
  PIXEL_MODEL.hair,
  GRAPH_SHADING_MODELS.unlit,
  PIXEL_MODEL.subsurface,
] as const
/** The code of a shading model's number in the record (0 for none, and for a number that is none of them). */
export const shadingModelCode = (model: number | undefined) =>
  model === undefined ? 0 : (SHADING_MODEL_CODES as readonly number[]).indexOf(model) + 1
/** The shading model number a record's model word names (`GRAPH_SHADING_MODELS`): a pixel model's, the unlit's, the default lit's for none. */
export const shadingNumberOfModel = wgslFn(
  'shadingNumberOfModel',
  [],
  `fn shadingNumberOfModel(model:u32)->u32{
 let code=(model>>${SHADING_MODEL_MODEL_SHIFT}u)&7u;
 if(code==1u){return ${PIXEL_MODEL.skin}u;}
 if(code==2u){return ${PIXEL_MODEL.profile}u;}
 if(code==3u){return ${PIXEL_MODEL.eye}u;}
 if(code==4u){return ${PIXEL_MODEL.hair}u;}
 if(code==5u){return ${GRAPH_SHADING_MODELS.unlit}u;}
 if(code==6u){return ${PIXEL_MODEL.subsurface}u;}
 return ${GRAPH_SHADING_MODELS.defaultLit}u;
}`,
)
/** The number of the pixel model a record's model word names (`PIXEL_MODEL`), 0 for none and for the unlit. */
export const shadingModelOfModel = wgslFn(
  'shadingModelOfModel',
  [shadingNumberOfModel, isPixelModel],
  `fn shadingModelOfModel(model:u32)->u32{
 let number=shadingNumberOfModel(model);
 return select(0u,number,isPixelModel(number));
}`,
)
/** Whether a record's model word names the unlit model. */
export const shadingUnlitOfModel = wgslFn(
  'shadingUnlitOfModel',
  [],
  `fn shadingUnlitOfModel(model:u32)->bool{return ((model>>${SHADING_MODEL_MODEL_SHIFT}u)&7u)==5u;}`,
)
