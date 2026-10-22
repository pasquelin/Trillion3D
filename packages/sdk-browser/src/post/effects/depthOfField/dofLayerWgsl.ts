import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { DOF_COC_WGSL, DOF_PARAMS_WGSL, DOF_TILE_WGSL } from './dofCommonWgsl.ts'
import { MAX_RECOMBINE_COC } from './dofLayout.ts'

/** The layers a gather draws, as the pipeline constant `LAYER` reads them. */
export const GATHER_LAYERS = { foreground: 0, hole: 1, background: 2, slight: 4 } as const

/**
 * The layer a pass works on (`LAYER`) and what a tile of the circle of confusion's range says of it
 * (`suggestFor`): the layer's smallest, largest and closest circle in the tile, whether there is
 * nothing to do — none when the largest circle is at most the slight out of focus' bound less one
 * (the hole filling also when its circles differ by less than 5 % of the largest or are all past the
 * bound; the slight out of focus when all its circles are past it) — and whether the circles differ
 * by less than 5 % of the largest, which the fast kernel suffices for.
 */
export const DOF_LAYER_WGSL = wgslBlock(
  'DOF_LAYER_WGSL',
  [DOF_PARAMS_WGSL, DOF_COC_WGSL, DOF_TILE_WGSL],
  `
override LAYER:u32=0u;
const FOREGROUND:u32=${GATHER_LAYERS.foreground}u;
const HOLE:u32=${GATHER_LAYERS.hole}u;
const BACKGROUND:u32=${GATHER_LAYERS.background}u;
const SLIGHT:u32=${GATHER_LAYERS.slight}u;
const MIN_GATHER:f32=${MAX_RECOMBINE_COC - 1}.0;
struct Suggestion{early:bool,fast:bool,maxAbs:f32,closest:f32,minIntersect:f32}
fn suggestFor(t:CocTile)->Suggestion{
 var minAbs=0.0;
 var maxAbs=0.0;
 var closest=0.0;
 var intersect=DOF_EXTREME;
 if(LAYER==FOREGROUND||LAYER==HOLE){minAbs=-t.fgMax;maxAbs=-t.fgMin;closest=t.fgMin;}
 else if(LAYER==BACKGROUND){minAbs=t.bgMin;intersect=t.bgNear;maxAbs=t.bgMax;closest=t.bgMin;}
 else{
  if(t.fgMin==0.0&&t.bgMax==0.0){minAbs=DOF_EXTREME;}
  else if(t.fgMin==0.0){minAbs=t.bgMin;}
  else if(t.bgMax==0.0){minAbs=-t.fgMax;}
  else{minAbs=min(-t.fgMax,t.bgMin);}
  maxAbs=max(-t.fgMin,t.bgMax);
  closest=select(t.bgMin,t.fgMin,t.fgMin<0.0);
 }
 let error=maxAbs*0.05;
 var early=maxAbs<=MIN_GATHER;
 if(LAYER==HOLE){early=maxAbs-minAbs<error||minAbs>DOF_SLIGHT||maxAbs<=MIN_GATHER;}
 if(LAYER==SLIGHT){early=minAbs>DOF_SLIGHT;}
 return Suggestion(early,maxAbs-minAbs<error,maxAbs,closest,intersect);
}`,
)
