import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE CHOICE OF ONE AMONG WEIGHTED CANDIDATES by resampling (`PtRis`), made one candidate at a time without keeping them: `ptRisStart(r)` begins it with the random number `r`, and `ptRisAccept(ris, w)`, called
 * with each candidate's weight, says whether the candidate replaces the one kept. The chance that the one kept at the end is a candidate is its weight over the sum of the weights, and the random number is rescaled at every
 * step so that the same one number serves them all (the sum so far is `sum`, the whole sum once every candidate has been offered).
 */
export const PT_RIS_WGSL = wgslBlock(
  'PT_RIS_WGSL',
  [],
  `struct PtRis{sum:f32,rand:f32,}
fn ptRisStart(rand:f32)->PtRis{return PtRis(0.0,rand);}
fn ptRisAccept(ris:ptr<function,PtRis>,w:f32)->bool{
 (*ris).sum+=w;
 let sum=select(1.0,(*ris).sum,(*ris).sum>0.0);
 let scaled=(*ris).rand*sum;
 let keep=scaled<w;
 (*ris).rand=min((scaled-select(w,0.0,keep))/select(sum-w,w,keep),0.99999994);
 return keep;
}`,
)
