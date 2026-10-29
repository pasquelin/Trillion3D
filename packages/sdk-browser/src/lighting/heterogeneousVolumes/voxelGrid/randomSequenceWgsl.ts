import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  evolveSobolSeed,
  fastOwenScrambling,
  strongIntegerHash,
} from '../../sobolScramblingWgsl.ts'

/**
 * A RANDOM SEQUENCE FOR A PIXEL, the Owen-scrambled Sobol one: made from a position and a frame, it gives a number in [0, 1) at each draw,
 * every draw independent of the one before. The index of the sequence is the frame's bits mirrored, the seed the position's hash; a draw
 * scrambles the index by the seed (Owen's scrambling in the cheap hash form), takes the Sobol point of that index and scrambles it again by
 * the next seed, the number its top 24 bits over 2^24. A draw of four dimensions steps the seed five times; the draw of one steps it as many,
 * so that the sequence does not move whether a pixel draws one dimension or four. The program uses `randomSequenceCreate` and `randomDraw`.
 */
export const VG_RANDOM_SEQUENCE_WGSL = wgslBlock(
  'VG_RANDOM_SEQUENCE_WGSL',
  [strongIntegerHash, evolveSobolSeed, fastOwenScrambling],
  `struct RandomSequence{index:u32,seed:u32,}
fn randomSequenceCreate(position:u32,frame:u32)->RandomSequence{
 return RandomSequence(reverseBits(frame),strongIntegerHash(position));
}
/** The next number of the sequence, in [0, 1). */
fn randomDraw(sequence:ptr<function,RandomSequence>)->f32{
 var seed=(*sequence).seed;
 let sobol=fastOwenScrambling((*sequence).index,evolveSobolSeed(&seed));
 let scrambled=fastOwenScrambling(sobol,evolveSobolSeed(&seed));
 for(var skipped=0;skipped<3;skipped++){_=evolveSobolSeed(&seed);}
 (*sequence).seed=seed;
 return f32(scrambled>>8u)*5.96046447754e-08;
}`,
)
