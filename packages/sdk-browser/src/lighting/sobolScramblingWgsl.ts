import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/**
 * The pieces of an Owen-scrambled Sobol sequence a shader draws from, one way each: the hash that
 * seeds a sequence from a position, the step that moves its seed at every draw, and the scrambling
 * of a bit-reversed index by a seed (Owen's scrambling in the cheap hash form).
 */

/** A word of integer hash (two multiplies between three xor-shifts): the seed of a sequence from the position it belongs to. */
export const strongIntegerHash = wgslFn(
  'strongIntegerHash',
  [],
  `fn strongIntegerHash(word:u32)->u32{
 var x=word;
 x^=x>>16u;
 x*=0x21f0aaadu;
 x^=x>>15u;
 x*=0xf35a2d97u;
 x^=x>>15u;
 return x;
}`,
)

/** The seed one draw on (a linear congruential step), and the value it takes. */
export const evolveSobolSeed = wgslFn(
  'evolveSobolSeed',
  [],
  `fn evolveSobolSeed(seed:ptr<function,u32>)->u32{
 *seed=*seed*0x915f77f5u+0x93d765ddu;
 return *seed;
}`,
)

/** The word `word` (an index whose bits are mirrored) scrambled by `seed`, mirrored back so that the scrambling runs from the left. */
export const fastOwenScrambling = wgslFn(
  'fastOwenScrambling',
  [],
  `fn fastOwenScrambling(word:u32,seed:u32)->u32{
 var x=word;
 x^=x*0xe0705d72u;
 x+=seed;
 x*=(seed^(seed>>16u))|1u;
 return reverseBits(x);
}`,
)
