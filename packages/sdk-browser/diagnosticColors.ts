/** Error is measured in screen pixels; green is exact, yellow approaches the cut threshold, red exceeds it. */
export function screenErrorRatio(error:number,threshold:number){
 if(!(error>0))return 0;
 if(!Number.isFinite(error)||!(threshold>0))return 1;
 return Math.max(0,Math.min(1,error/threshold));
}

export function screenErrorColor(error:number,threshold:number):[number,number,number]{
 const ratio=screenErrorRatio(error,threshold);
 return [ratio,1-ratio,0.12];
}
