/**
 * CPU step profile of a render loop: a bounded ring of recent images plus the worst images by total
 * duration, summarised on demand. It exists so an engine can report where its own CPU time goes in
 * `summary` mode — turning the per-frame trace on to find that out changes the timing being measured.
 * Nothing is allocated per image: the caller fills the scratch row and hands it over.
 */
export type CpuStepSummary={frames:number;steps:Record<string,{p50:number;p95:number;max:number}>;worst:Array<Record<string,number>>};

export function createCpuStepProfile(names:readonly string[],options:{capacity?:number;worst?:number}={}){
 const width=names.length;
 if(!width)throw new Error('CPU_STEP_PROFILE_EMPTY');
 const capacity=Math.max(1,Math.floor(options.capacity??256)),worstCount=Math.max(1,Math.floor(options.worst??10));
 const ring=new Float64Array(capacity*width);
 // The worst images keep their own rows, sorted by `total` descending, so a long window cannot evict
 // the image a host actually needs to see.
 const worstRows=new Float64Array(worstCount*width),worstTotal=new Float64Array(worstCount),worstFrame=new Float64Array(worstCount);
 const row=new Float64Array(width),column=new Float64Array(capacity);
 let recorded=0,cursor=0,worstFilled=0;
 const pick=(sorted:Float64Array,count:number,quantile:number)=>sorted[Math.min(count-1,Math.floor(quantile*count))];
 return {
  names,
  /** The row the caller fills before `record`; its order is `names`. */
  row,
  /** Files the filled row under `frame`, ranked by `total`. */
  record(frame:number,total:number){
   ring.set(row,(cursor%capacity)*width);cursor++;recorded=Math.min(capacity,recorded+1);
   if(worstFilled<worstCount||total>worstTotal[worstFilled-1]){
    let at=Math.min(worstFilled,worstCount-1);
    while(at>0&&worstTotal[at-1]<total){
     worstTotal[at]=worstTotal[at-1];worstFrame[at]=worstFrame[at-1];
     worstRows.copyWithin(at*width,(at-1)*width,at*width);
     at--;
    }
    worstTotal[at]=total;worstFrame[at]=frame;worstRows.set(row,at*width);
    if(worstFilled<worstCount)worstFilled++;
   }
  },
  /** Percentiles over the ring and the worst images, then forgets both. */
  summary():CpuStepSummary|null{
   if(!recorded)return null;
   const steps:Record<string,{p50:number;p95:number;max:number}>={};
   for(let c=0;c<width;c++){
    for(let i=0;i<recorded;i++)column[i]=ring[i*width+c];
    const sorted=column.subarray(0,recorded).sort();
    steps[names[c]]={p50:pick(sorted,recorded,0.5),p95:pick(sorted,recorded,0.95),max:sorted[recorded-1]};
   }
   const worst:Array<Record<string,number>>=[];
   for(let w=0;w<worstFilled;w++){
    const entry:Record<string,number>={frame:worstFrame[w]};
    for(let c=0;c<width;c++)entry[names[c]]=worstRows[w*width+c];
    worst.push(entry);
   }
   const frames=recorded;
   recorded=0;cursor=0;worstFilled=0;worstTotal.fill(0);
   return {frames,steps,worst};
  },
 };
}
