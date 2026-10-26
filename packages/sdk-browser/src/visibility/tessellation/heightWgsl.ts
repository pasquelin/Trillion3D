import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE HEIGHT OF A DISPLACEMENT WHERE A GRAPH GIVES IT: `diceHeight`, the one read of the height at a
 * point the dicing makes (`diceVertex`, `diceSetupWgsl.ts`), in place of the height map's where the
 * row's displacement record names a graph (`DisplacementRecord.map.z`, the material's rank in `.w`):
 * the graph's `displacement` output, evaluated for the surface of that rank at the point's coordinate
 * and footprint (`displacementValue`, `../shader/maskGraphWgsl.ts`). A surface whose record names a
 * map reads the map, as it did. Listed by the programs that dice a row beside the graph outputs the
 * rasters evaluate (`maskKeepWgsl`), the dicing of the image and of the shadow maps alike.
 */
export const graphHeightWgsl = wgslFn(
  'diceHeight',
  [],
  `fn diceHeight(rec:DisplacementRecord,uv:vec2f,step:f32)->f32{
 if(rec.map.z!=0u){return displacementValue(materialAt(rec.map.w),uv,vec2f(step),vec2f(step));}
 return dataSample(rec.map.x,uv,vec2f(step),vec2f(step),true).x;
}`,
)
