/**
 * THE RUN-TIME PROXY'S ANSWER TO A LOBE, text of the program that casts its rays (`runtimeTraceWgsl.ts`), after
 * `rtRadiance`: what the store (`runtimeLayout.ts`) holds of a pixel, and the sample a frame adds to it.
 *
 * `rtLobeAnswer` is the mean, over the directions of the pixel's lobe (GGX of width `alpha`, round), of the
 * radiance the proxy brings back, and the share of the lobe the proxy holds. A frame adds one sample to the mean in
 * the store — a direction of the lobe, `rtSampleLobe`, along a low-discrepancy sequence a pixel rotates of its own
 * (`rtRotation`), so that neighbours' samples are not the same and the prefix of the sequence at any count is
 * well spread — within the budget of the frame, the rays it leaves out go on in the next frames. A pixel at its
 * cap (`rtCapOf`) of an epoch that is the current one casts no ray: a still view costs nothing once it holds.
 *
 * The mean is of the radiance premultiplied by the share each sample holds (its confidence), and of the share:
 * the answer is the first over the second, with the second as its confidence, so that the stage after it, the
 * probes and the environment, take exactly the share of the lobe that no ray of the proxy stopped.
 *
 * A second call for a pixel — the clear coat's lobe — is one ray along its centre, kept nowhere.
 */
export const RUNTIME_ANSWER_WGSL = `
/** A pixel's cell of the store: its mean premultiplied radiance, its mean confidence, the samples they are of
 *  and the stamps of the epochs they were made in. */
struct RtCell{premult:vec3f,confidence:f32,count:u32,scene:u32,view:u32,}
/** A radiance on a shared exponent, nine bits a channel (rgb9e5): the pixel's mean in one word. */
fn rtPackShared(c:vec3f)->u32{
 let v=clamp(c,vec3f(0.0),vec3f(65408.0));
 let top=max(v.x,max(v.y,v.z));
 var exponent=max(-16.0,floor(log2(max(top,1e-30))))+16.0;
 var step=exp2(exponent-24.0);
 if(floor(top/step+0.5)>=512.0){exponent+=1.0;step*=2.0;}
 let m=vec3u(floor(v/step+vec3f(0.5)));
 return m.x|(m.y<<9u)|(m.z<<18u)|(u32(exponent)<<27u);
}
fn rtUnpackShared(w:u32)->vec3f{
 let m=vec3f(f32(w&511u),f32((w>>9u)&511u),f32((w>>18u)&511u));
 return m*exp2(f32(w>>27u)-24.0);
}
/** An epoch's stamp on seven bits, never zero: a pixel never answered holds none. */
fn rtStamp(epoch:u32)->u32{return epoch%127u+1u;}
fn rtCellRead(at:vec2u)->RtCell{
 let a=textureLoad(rtStore,at,0u).x;
 let b=textureLoad(rtStore,at,1u).x;
 return RtCell(rtUnpackShared(a),f32(b&RT_CONFIDENCE_MAX)/f32(RT_CONFIDENCE_MAX),(b>>RT_COUNT_SHIFT)&255u,(b>>RT_SCENE_SHIFT)&127u,(b>>RT_VIEW_SHIFT)&127u);
}
fn rtCellWrite(at:vec2u,premult:vec3f,confidence:f32,count:u32,scene:u32,view:u32){
 let c=u32(round(clamp(confidence,0.0,1.0)*f32(RT_CONFIDENCE_MAX)));
 textureStore(rtStore,at,0u,vec4u(rtPackShared(premult),0u,0u,0u));
 textureStore(rtStore,at,1u,vec4u(c|(count<<RT_COUNT_SHIFT)|(scene<<RT_SCENE_SHIFT)|(view<<RT_VIEW_SHIFT),0u,0u,0u));
}
/** What a cell answers: the radiance of the share it holds, and that share. */
fn rtCellAnswer(cell:RtCell)->RtRadiance{
 if(!(cell.confidence>0.0)){return RtRadiance(vec3f(0.0),0.0);}
 return RtRadiance(cell.premult/cell.confidence,min(cell.confidence,1.0));
}
/** The samples a lobe of width \`alpha\` is the mean of: one for a mirror. */
fn rtCapOf(alpha:f32)->u32{return select(RT_SAMPLE_CAP,1u,alpha<RT_MIRROR_ALPHA);}
/** A pixel's own offset into the sequence: two numbers of [0, 1) from its coordinates. */
fn rtRotation(p:vec2u)->vec2f{
 var h=p.x*1597334673u^p.y*3812015801u;
 h=(h^(h>>15u))*2246822519u;
 h=(h^(h>>13u))*3266489917u;
 h=h^(h>>16u);
 let g=h*747796405u+2891336453u;
 return vec2f(f32(h>>8u),f32(g>>8u))*5.9604644775390625e-8;
}
/** Sample \`k\` of the pixel's sequence, two numbers of [0, 1): the R2 sequence (the plastic number's
 *  powers) rotated by the pixel's offset. */
fn rtSequence(k:u32,p:vec2u)->vec2f{
 return fract(rtRotation(p)+f32(k)*vec2f(0.7548776662466927,0.5698402909980532));
}
/** A direction of the lobe of \`alpha\` at a surface of normal \`N\` seen from \`V\`: the half vector drawn from the
 *  GGX distribution weighed by its cosine, the view reflected about it. It may point under the surface. */
fn rtSampleLobe(N:vec3f,V:vec3f,alpha:f32,u:vec2f)->vec3f{
 let cosine=sqrt((1.0-u.x)/(1.0+(alpha*alpha-1.0)*u.x));
 let sine=sqrt(max(0.0,1.0-cosine*cosine));
 let phi=6.283185307179586*u.y;
 let s=select(-1.0,1.0,N.z>=0.0);
 let a=-1.0/(s+N.z);
 let b=N.x*N.y*a;
 let T=vec3f(1.0+s*N.x*N.x*a,s*b,-s*N.x);
 let B=vec3f(b,s+N.y*N.y*a,-N.y);
 let H=T*(sine*cos(phi))+B*(sine*sin(phi))+N*cosine;
 return reflect(-V,H);
}
/** The density, per unit of solid angle, of \`rtSampleLobe\` at the direction \`L\`. */
fn rtLobePdf(N:vec3f,V:vec3f,alpha:f32,L:vec3f)->f32{
 let H=normalize(V+L);
 let nh=dot(N,H);
 if(nh<=0.0||dot(N,L)<=0.0){return 0.0;}
 let a2=alpha*alpha;
 let d=nh*nh*(a2-1.0)+1.0;
 return a2/(3.141592653589793*d*d)*nh/(4.0*max(dot(V,H),1e-6));
}
/**
 * The mean radiance of the lobe, from \`P\` (the surface's point, off its normal by the proxy's error), of normal
 * \`N\`, seen from \`V\`, \`reach\` far, and the share of the lobe the proxy holds; \`tangent\` is \`rtRadiance\`'s.
 */
fn rtLobeAnswer(P:vec3f,N:vec3f,V:vec3f,alpha:f32,reach:f32,tangent:f32)->RtRadiance{
 if(rtProxy.instances==0u){return RtRadiance(vec3f(0.0),0.0);}
 let first=rtCalls==0u;
 rtCalls++;
 if(!first){
  if(atomicLoad(&rtList[RT_SPENT])>=RT_FRAME_WORK){return RtRadiance(vec3f(0.0),0.0);}
  let coat=rtRadiance(P,reflect(-V,N),reach,tangent);
  atomicAdd(&rtList[RT_SPENT],rtWork);
  return coat;
 }
 let cap=rtCapOf(alpha);
 let scene=rtStamp(reflectionView.runtime.x);
 let view=rtStamp(reflectionView.runtime.y);
 let cell=rtCellRead(rtPixel);
 var n=cell.count;
 // An answer of another epoch is kept as a mean of a few samples, which the new ones then replace.
 if(cell.scene!=scene){n=min(n,min(RT_SCENE_COUNT,cap-1u));}
 else if(cell.view!=view){n=min(n,min(RT_MOTION_COUNT,cap-1u));}
 if(n>=cap){return rtCellAnswer(cell);}
 if(atomicLoad(&rtList[RT_SPENT])>=RT_FRAME_WORK){
  atomicAdd(&rtList[RT_LEFT],1u);
  return rtCellAnswer(cell);
 }
 var direction=reflect(-V,N);
 if(cap>1u){direction=rtSampleLobe(N,V,alpha,rtSequence(n,rtPixel));}
 var premult=vec3f(0.0);
 var share=0.0;
 if(dot(N,direction)>0.0){
  let seen=rtRadiance(P,direction,reach,tangent);
  premult=seen.color*seen.confidence;
  share=seen.confidence;
 }
 atomicAdd(&rtList[RT_SPENT],rtWork);
 atomicMax(&rtList[RT_CURSOR],rtRank+1u);
 let next=n+1u;
 let before=select(vec3f(0.0),cell.premult,n>0u);
 let held=select(0.0,cell.confidence,n>0u);
 let mean=before+(premult-before)/f32(next);
 let confidence=held+(share-held)/f32(next);
 rtCellWrite(rtPixel,mean,confidence,next,scene,view);
 if(next<cap){atomicAdd(&rtList[RT_LEFT],1u);}
 return rtCellAnswer(RtCell(mean,confidence,next,scene,view));
}
`
