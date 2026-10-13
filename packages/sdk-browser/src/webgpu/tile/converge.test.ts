import test from 'node:test'
import assert from 'node:assert/strict'
import { MAP_CHOICES, PICK_BLENDS, PICK_TAPS } from './pickCounts.ts'
import { FEEDBACK_EVERY, PICK_SHIFT } from './feedback.ts'
import { TILE_REQUEST_WGSL } from './requestWgsl.ts'
import { SHADE_REQUEST_WGSL } from '../../visibility/shader/request.ts'
import { blendRequestWgsl } from '../blend/requestWgsl.ts'
import {
  convergeBound,
  drainsAgain,
  mustRestartTaaAfterSettle,
  texturesConverged,
} from './convergeRules.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

test('a quiet barrier leaves TAA history in place', () => {
  assert.equal(mustRestartTaaAfterSettle(0, 0), false)
})

test('tiles or shadow pages that landed during the barrier restart the still TAA average', () => {
  assert.equal(mustRestartTaaAfterSettle(1, 0), true)
  assert.equal(mustRestartTaaAfterSettle(0, 3), true)
})

// A pixel named ONE map, blend level and tap, picked by its position. A sliver of a
// surface — three pixels at the edge of a lamp — named nothing it reads, and the settled image
// read what the pool kept of the run before. A convergence image now runs through every pick of
// every pixel and names the first whose tile the table does not hold at its level.
test('a convergence image names, per pixel, the first of all its picks whose tile is missing', () => {
  const pick = (px: number, choices: number) => [
    px % choices,
    Math.floor(px / choices) & (PICK_BLENDS - 1),
    Math.floor(px / choices / PICK_BLENDS) % PICK_TAPS,
  ]
  for (const choices of [1, MAP_CHOICES, MAP_CHOICES + 1])
    for (const px of [0, 7, 1280 + 719]) {
      const named = new Set<string>()
      for (let turn = 0; turn < choices * PICK_BLENDS * PICK_TAPS; turn++)
        named.add(pick(px + turn, choices).join())
      assert.equal(named.size, choices * PICK_BLENDS * PICK_TAPS, `pixel ${px}, ${choices} maps`)
    }
  assert.match(wgslSource(TILE_REQUEST_WGSL), /const PICK_TURNS:u32=6u;/)
  assert.match(
    wgslSource(TILE_REQUEST_WGSL),
    /fn everyPick\(pos:vec2f,choices:u32,turn:u32\)[^\n]*pickOf\(u32\(pos\.x\)\+u32\(pos\.y\)\+turn,choices\)/,
  )
  assert.match(
    wgslSource(TILE_REQUEST_WGSL),
    /if\(missing&&word!=0u&&\(\(word>>24u\)&0x7fu\)==level\)\{return 0u;\}/,
  )
  for (const [name, text, choices] of [
    ['shade', wgslSource(SHADE_REQUEST_WGSL), 'choices'],
    ['blend', wgslSource(blendRequestWgsl(false)), 'choices'],
    ['lobed blend', wgslSource(blendRequestWgsl(true)), 'choices'],
  ]) {
    const loop = new RegExp(
      `if\\(feedbackMissing\\([^)]*,uni\\.feedback\\)\\)\\{\\n  for\\(var turn=0u;turn<${choices}\\*PICK_TURNS;turn\\+\\+\\)\\{\\n` +
        `   let rank=\\w+\\([^;]*everyPick\\([^;]*,${choices},turn\\),true,[^;]*;\\n   if\\(rank!=0u\\)\\{return rank;\\}`,
    )
    assert.match(text, loop, `${name}: every pick, the first missing`)
    assert.match(
      text,
      /requestPick\([^;]*,uni\.feedback\),false,/,
      `${name}: its own pick otherwise`,
    )
  }
})

// The barrier must not converge only at the jitter of the image it replays; the still
// frames average eight others, whose slivers named tiles that landed during the average, when
// the readback happened to come back. A capture's barrier converges a whole round of phases.
test("a capture's convergence stops on a quiet round of the still phases, closing on the replayed one", () => {
  assert.equal(texturesConverged(7, 8, 6, 0, false), false, 'a phase not yet heard')
  assert.equal(texturesConverged(8, 8, 7, 0, false), true)
  assert.equal(
    texturesConverged(9, 8, 8, 0, false),
    false,
    'the next image is not the replayed one',
  )
  assert.equal(texturesConverged(8, 8, 15, 0, false), true)
  assert.equal(texturesConverged(8, 8, 7, 2, true), false, 'a level still read is waited for')
  assert.equal(texturesConverged(1, 1, 0, 0, false), false, 'no accumulation: one row of two heard')
  assert.equal(texturesConverged(2, 1, 1, 0, false), true, 'no accumulation: two quiet images')
})

// A round of the still phases outnumbers the 64 turns at a low render scale (8 per
// (display / render)²): a barrier whose last tile landed late never had a whole quiet round left.
test('a convergence always has room for a quiet round after a tile served on its last turn', () => {
  for (const phases of [1, 8, 32, 128]) {
    const last = convergeBound(1) - 3
    let closed = -1
    for (let image = last + 1, quiet = 1; image < convergeBound(phases); image++, quiet++)
      if (texturesConverged(quiet, phases, image, 0, false)) {
        closed = image
        break
      }
    assert.ok(closed > last, `${phases} phases: a quiet round closes`)
  }
})

// Casters that land after the drain's last image changed nothing a shadow map saw. The
// barrier ended there, and their pages were drawn again during the still average, as each
// session's streaming happened to time them. A landing after the last image now draws one more.
test('a page made resident after the last drain image draws one more image', () => {
  const settled = () => false
  assert.equal(drainsAgain(7, 7, settled), false, 'nothing moved: the drain ends')
  assert.equal(drainsAgain(7, 8, settled), true, 'a landing no map saw: one more')
  assert.equal(
    drainsAgain(7, 7, () => true),
    true,
    'shadows unsettled: one more',
  )
})

// A convergence image named, on every pixel, the first missing pick: a pixel never posted the
// resident tiles it reads, so a surface whose normal tile was missing everywhere left its base
// tile unstamped (`stampWgsl.ts`), and the GPU's queue gave it up while the image read it. The
// asking rows now alternate with rows that post their own read, swapping each image.
test('a convergence image asks the missing picks on every other row and posts the read on the others', () => {
  assert.match(
    wgslSource(TILE_REQUEST_WGSL),
    /fn feedbackMissing\(p:vec2f,word:u32\)->bool\{return feedbackEvery\(word\)&&\(\(u32\(p\.y\)\+word\)&1u\)==0u;\}/,
  )
  // The shaders' rule, mirrored: does pixel row `y` of image word `word` ask, or post its read.
  const asks = (y: number, word: number) => (word & FEEDBACK_EVERY) !== 0 && ((y + word) & 1) === 0
  const choices = MAP_CHOICES + 1
  for (let phase = 0; phase < FEEDBACK_EVERY; phase++) {
    const word = FEEDBACK_EVERY | phase | (3 << PICK_SHIFT),
      next = FEEDBACK_EVERY | ((phase + 1) % FEEDBACK_EVERY) | (3 << PICK_SHIFT)
    // A block where every pixel misses a pick: the reading rows post every map of the block.
    const read = new Set<number>()
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < choices; x++) if (!asks(y, word)) read.add((x + y + 3) % choices)
    assert.equal(read.size, choices, `image ${phase}: every map of the block is read and stamped`)
    for (let y = 0; y < 2; y++)
      assert.notEqual(asks(y, word), asks(y, next), `row ${y} asks one image in two`)
  }
  for (let y = 0; y < 4; y++)
    assert.equal(asks(y, 5 << PICK_SHIFT), false, 'an ordinary image reads')
})
