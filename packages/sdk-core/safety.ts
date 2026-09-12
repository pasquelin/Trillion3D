export type CapabilityTier='full'|'degraded'|'baseline';
export interface SafetyDecision {tier:CapabilityTier;enabled:boolean;reason:string;changedAt:number;revision:number}
export interface MeasuredCosts {contextKey:string;provenance:'measured';cpuMs:number;gpuMs:number|null;latencyMs:number;memoryBytes:number|null;evictionsPerSecond:number|null}
export interface SafetyConfig {minimumSamples:number;minimumPeriodMs:number;disableRatio:number;enableRatio:number;consecutiveViolations:number;memoryBudgetBytes?:number;maxEvictionsPerSecond?:number;requireGpuTiming?:boolean}
/** Policy evaluates evidence; it never fabricates a reference or samples a clock itself. */
export function createSafetyPolicy(config:SafetyConfig){
 if(!Number.isInteger(config.minimumSamples)||config.minimumSamples<1||!Number.isInteger(config.consecutiveViolations)||config.consecutiveViolations<1||!Number.isFinite(config.minimumPeriodMs)||config.minimumPeriodMs<0||!Number.isFinite(config.enableRatio)||config.enableRatio<=0||!Number.isFinite(config.disableRatio)||config.enableRatio>=config.disableRatio)throw new Error('INVALID_SAFETY_POLICY');
 let decision:SafetyDecision={tier:'baseline',enabled:false,reason:'No comparable measured evidence',changedAt:0,revision:0},good=0,bad=0,lastTime=-Infinity;
 const transition=(enabled:boolean,reason:string,now:number)=>{if(decision.enabled!==enabled||decision.reason!==reason)decision={tier:enabled?'full':'baseline',enabled,reason,changedAt:now,revision:decision.revision+1};return decision;};
 return {getDecision:()=>decision,
  trip(reason:'error'|'oom'|'device-lost'|'thrashing'|'quality-failed',now:number){if(!Number.isFinite(now)||now<lastTime)throw new Error('INVALID_CLOCK');lastTime=now;good=bad=0;return transition(false,`Circuit breaker: ${reason}`,now);},
  observe(reference:MeasuredCosts,candidate:MeasuredCosts,now:number){
   if(!Number.isFinite(now)||now<lastTime)throw new Error('INVALID_CLOCK');lastTime=now;
   const valid=(value:number|null)=>value===null||Number.isFinite(value)&&value>=0;
   if(reference.provenance!=='measured'||candidate.provenance!=='measured'||reference.contextKey!==candidate.contextKey||![reference,candidate].every(v=>[v.cpuMs,v.gpuMs,v.latencyMs,v.memoryBytes,v.evictionsPerSecond].every(valid))){good=bad=0;return transition(false,'Incomparable or invalid evidence',now);}
   if(config.requireGpuTiming&&(reference.gpuMs===null||candidate.gpuMs===null)){good=bad=0;return transition(false,'GPU evidence unavailable',now);}
   if(config.memoryBudgetBytes!==undefined&&candidate.memoryBytes===null){good=bad=0;return transition(false,'Memory evidence unavailable',now);}
   const ratio=(a:number,b:number)=>b===0?(a===0?1:Infinity):a/b;
   const ratios=[ratio(candidate.cpuMs,reference.cpuMs),ratio(candidate.latencyMs,reference.latencyMs)];if(candidate.gpuMs!==null&&reference.gpuMs!==null)ratios.push(ratio(candidate.gpuMs,reference.gpuMs));
   const pressure=config.memoryBudgetBytes!==undefined&&candidate.memoryBytes!==null&&candidate.memoryBytes>config.memoryBudgetBytes;
   const thrashing=config.maxEvictionsPerSecond!==undefined&&candidate.evictionsPerSecond!==null&&candidate.evictionsPerSecond>config.maxEvictionsPerSecond;
   if(pressure||thrashing){good=bad=0;return transition(false,pressure?'Circuit breaker: memory budget':'Circuit breaker: thrashing',now);}
   const harmful=ratios.some(r=>r>config.disableRatio),beneficial=ratios.every(r=>r<=config.enableRatio);
   bad=harmful?bad+1:0;good=beneficial?good+1:0;
   if(now-decision.changedAt<config.minimumPeriodMs)return decision;
   if(decision.enabled&&bad>=config.consecutiveViolations){bad=good=0;return transition(false,'Measured cost exceeds reference',now);}
   if(!decision.enabled&&good>=config.minimumSamples){bad=good=0;return transition(true,'Measured benefit within configured budgets',now);}
   return decision;
  },
 };
}
