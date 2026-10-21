/**
 * THE BANK PASS, in WGSL: the palette of every track of the session's animation banks
 * (`bankTracks.ts`) posed from its bake, before the deformation stage reads it (`computeWgsl.ts`).
 * One workgroup a track, one invocation a joint of it; each writes the joint's palette twice into
 * the track's record in the deformation block (`layout.ts`), wherever the float pool holds the
 * block this image: this frame's, at the second the track's clock draws, then the last frame's, at
 * the second it drew — the pose the temporal pass reprojects by.
 *
 * The steps are the reference's. The two keys a second lies between: the first key at or before
 * the track's start and for a bake of one key; the last one at or past its end, its length the
 * bake's frames less one over the sample rate; else the key before it, the one after — itself at
 * the last key —, and the fraction between, zero when the run-time setting
 * `animationBankInterpolation` is off. Each key's rotation is normalized (the identity for one of no
 * length); the two are blended — the translation linearly, the rotation along the shorter way,
 * normalized —, or the one key is taken where the fraction is none or whole. The joint's palette is
 * its pose's rigid matrix times its inverse bind: the three rows of a 3×4 affine
 * (`PALETTE_FLOATS`), as the CPU writes a skeleton's (`Skeleton.palette`).
 *
 * The banks' floats (`banks`): per bake, each joint's inverse bind as three rows of four floats
 * (`ANIMATION_BANK_INVERSE_FLOATS`), then for each frame each joint's key — translation x y z,
 * rotation x y z w (`ANIMATION_BANK_KEY_FLOATS`) — at `(frame · joints + joint) · 7`. The table
 * (`tracks`) is `BANK_TRACK`'s, one row a track.
 */
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { ANIMATION_BANK_SAMPLE_RATE } from '../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  ANIMATION_BANK_INVERSE_FLOATS,
  ANIMATION_BANK_KEY_FLOATS,
} from '../../../sdk-core/src/contracts/writtenFormats.ts'
import { PALETTE_FLOATS } from '../../../sdk-core/src/world/animation/skeleton.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { computeBufferEntry, computeUniformEntry } from '../gpu/core/computeBindings.ts'

/** The pass's bindings, named once: the text and the layout print them. `positions` is the float
 *  pool the tracks' records lie in; `banks` every banks' floats end to end (`BankTracks.pool`);
 *  `tracks` the table; `record` the pass's own record. */
export const ANIMATION_BANK_BINDING = {
  positions: 0,
  banks: 1,
  tracks: 2,
  record: 3,
} as const
const B = ANIMATION_BANK_BINDING

/** One workgroup per track, one invocation per joint of it (the header). */
export const ANIMATION_BANK_WGSL = wgslProgram(
  `${wgslConsts({
    ANIMATION_BANK_SAMPLE_RATE,
    ANIMATION_BANK_KEY_FLOATS,
    ANIMATION_BANK_INVERSE_FLOATS,
    PALETTE_FLOATS,
  })}
/** A track's row of the table, in \`BANK_TRACK\`'s order (\`bankTracks.ts\`). */
struct BankTrackRow{palette:u32,joints:u32,frames:u32,inverse:u32,keys:u32,time:f32,previous:f32,pad:u32,}
@group(0) @binding(${B.positions}) var<storage,read_write> positions:array<f32>;
@group(0) @binding(${B.banks}) var<storage,read> banks:array<f32>;
@group(0) @binding(${B.tracks}) var<storage,read> tracks:array<BankTrackRow>;
/** x the tracks, y 1 where a track blends its two nearest keys, z the deformation block's first
 *  float in the pool. */
@group(0) @binding(${B.record}) var<uniform> bank:vec4u;
/** The keys a track of \`frames\` keys lies between at second \`time\`, and the fraction past the
 *  lower one (the header). */
struct BankKeys{lower:u32,upper:u32,blend:f32,}
fn bankKeys(time:f32,frames:u32)->BankKeys{
 let span=f32(frames-1u)*(1.0/f32(ANIMATION_BANK_SAMPLE_RATE));
 if(time<=0.0||frames==1u){return BankKeys(0u,0u,0.0);}
 if(time>=span){return BankKeys(frames-1u,0u,0.0);}
 let at=time*(f32(frames-1u)/span);
 let lower=u32(clamp(i32(floor(at)),0,i32(frames)-1));
 return BankKeys(lower,select(lower+1u,lower,lower+1u==frames),at-f32(lower));
}
/** A joint's pose: its translation, and its unit rotation. */
struct BankPose{t:vec3f,q:vec4f,}
/** Joint \`j\`'s key \`key\` of \`track\`, its rotation normalized: the identity for one of no
 *  length. */
fn bankKey(track:BankTrackRow,key:u32,j:u32)->BankPose{
 let at=track.keys+(key*track.joints+j)*ANIMATION_BANK_KEY_FLOATS;
 let q=vec4f(banks[at+3u],banks[at+4u],banks[at+5u],banks[at+6u]);
 let n=dot(q,q);
 return BankPose(vec3f(banks[at],banks[at+1u],banks[at+2u]),select(vec4f(0.0,0.0,0.0,1.0),q*inverseSqrt(n),n>0.0));
}
/** Joint \`j\` of \`track\` at second \`time\`: its two nearest keys blended, or one of them alone. */
fn bankPose(track:BankTrackRow,j:u32,time:f32)->BankPose{
 var keys=bankKeys(time,track.frames);
 if(bank.y==0u){keys.blend=0.0;}
 if(keys.blend<=0.0){return bankKey(track,keys.lower,j);}
 if(keys.blend>=1.0){return bankKey(track,keys.upper,j);}
 let a=bankKey(track,keys.lower,j);let b=bankKey(track,keys.upper,j);
 let q=select(b.q,-b.q,dot(a.q,b.q)<0.0);
 return BankPose(mix(a.t,b.t,keys.blend),normalize(mix(a.q,q,keys.blend)));
}
fn bankStore(at:u32,row:vec4f){positions[at]=row.x;positions[at+1u]=row.y;positions[at+2u]=row.z;positions[at+3u]=row.w;}
/** Joint \`j\`'s palette at second \`time\`, from float \`at\`: each row of its pose's rotation
 *  carries the rows of its inverse bind, its translation added to the last column. */
fn bankJoint(track:BankTrackRow,j:u32,time:f32,at:u32){
 let pose=bankPose(track,j,time);
 let x=pose.q.x;let y=pose.q.y;let z=pose.q.z;let w=pose.q.w;
 let b=track.inverse+j*ANIMATION_BANK_INVERSE_FLOATS;
 let i0=vec4f(banks[b],banks[b+1u],banks[b+2u],banks[b+3u]);
 let i1=vec4f(banks[b+4u],banks[b+5u],banks[b+6u],banks[b+7u]);
 let i2=vec4f(banks[b+8u],banks[b+9u],banks[b+10u],banks[b+11u]);
 bankStore(at,(1.0-2.0*(y*y+z*z))*i0+2.0*(x*y-w*z)*i1+2.0*(x*z+w*y)*i2+vec4f(0.0,0.0,0.0,pose.t.x));
 bankStore(at+4u,2.0*(x*y+w*z)*i0+(1.0-2.0*(x*x+z*z))*i1+2.0*(y*z-w*x)*i2+vec4f(0.0,0.0,0.0,pose.t.y));
 bankStore(at+8u,2.0*(x*z-w*y)*i0+2.0*(y*z+w*x)*i1+(1.0-2.0*(x*x+y*y))*i2+vec4f(0.0,0.0,0.0,pose.t.z));
}
@compute @workgroup_size(WORKGROUP_THREADS)
fn poseTracks(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let t=flatIndex(group,groups,1u);
 if(t>=min(bank.x,arrayLength(&tracks))){return;}
 let track=tracks[t];let palette=bank.z+track.palette;
 for(var j=lane;j<track.joints;j+=WORKGROUP_THREADS){
  bankJoint(track,j,track.time,palette+j*PALETTE_FLOATS);
  bankJoint(track,j,track.previous,palette+(track.joints+j)*PALETTE_FLOATS);
 }
}`,
  [FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
)

/** The pass's layout, each binding at its name's (`ANIMATION_BANK_BINDING`), as the text declares
 *  it. */
export const animationBankBindings = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.positions, 'storage'),
  computeBufferEntry(B.banks, 'read-only-storage'),
  computeBufferEntry(B.tracks, 'read-only-storage'),
  computeUniformEntry(B.record),
]
