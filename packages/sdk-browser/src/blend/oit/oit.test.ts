import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ORDER_INDEPENDENT_TRANSLUCENCY_RULES as RULES,
  oitSampleCount,
} from '../../../../sdk-core/src/contracts/orderIndependentTranslucencyOptions.ts'
import { blendShader } from '../shader.ts'
import { variantOfBlend, transmitBase, WATER_BASE, pipelineBase } from '../plan/planCull.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { packLight } from '../../gpu/core/smallFloatWgsl.ts'
import { oitSceneDepth } from './oitCodec.ts'
import { unpackLightWord } from '../../gpu/core/smallFloat.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import {
  oitDebugOffset,
  oitHeadWords,
  oitNodesFitting,
  oitParams,
  oitPoolCeiling,
  oitPoolMinimum,
  oitPoolWords,
  oitSamplesFitting,
  oitSplit,
  OIT_HEADER_SPILL_LIGHT,
  OIT_HEADER_SPILL_SAT,
  OIT_HEADER_SPILL_TRANS,
  OIT_CLEAR_BYTES,
  OIT_DEBUG_WORDS,
  OIT_GLOBAL_WORDS,
  OIT_HEADER_WORDS,
  OIT_LIST_BOUND,
  OIT_NODE_WORDS,
  OIT_SLOT_WORDS,
  OIT_NO_CURSOR,
  OIT_PARAMS,
} from './oitLayout.ts'
import { oitDebugLines, OIT_PIXEL_BYTES, readOitPixel } from './oitDebug.ts'
import { oitPipelineSet, oitRank } from './oitPipelines.ts'
import { grantsOit } from './oitResources.ts'
import {
  oitCollectWgsl,
  OIT_COMBINE_DUAL_WGSL,
  OIT_COMBINE_WGSL,
  OIT_INSERT_WGSL,
  OIT_PACK_WGSL,
  OIT_WALK_WGSL,
} from './oitWgsl.ts'
import { opticsProjection } from '../../../../sdk-core/src/world/camera/referenceProjection.ts'

test('the settings are the reference defaults', () => {
  const defaults = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.default]))
  assert.deepEqual(defaults, {
    oitSortedPixels: false,
    oitSortedPixelsEnable: true,
    oitPassType: 3,
    oitMaxSampleCount: 4,
    oitMethod: 1,
    oitTransmittanceThreshold: 0.05,
    oitDebug: 0,
    oitDebugCursorX: -1,
    oitDebugCursorY: -1,
  })
})

test('the samples a pixel keeps are the largest square at most the count asked, from 1 to 16', () => {
  const kept = [1, 2, 3, 4, 5, 8, 9, 15, 16, 40, 0].map(oitSampleCount)
  assert.deepEqual(kept, [1, 1, 1, 4, 4, 4, 9, 9, 16, 16, 1])
})

test('the cpu twin reads the engine packed light word back within the mantissa kept', () => {
  const { packLight: pack } = shaderRun<{ packLight: (c: number[]) => number }>(
    wgslModule(packLight),
    ['packLight'],
    {},
  )
  for (const rgb of [
    [0, 0, 0],
    [1, 0.5, 0.25],
    [120.5, 3.3, 0.01],
    [65000, 1, 1],
  ]) {
    const back = unpackLightWord(pack(rgb))
    rgb.forEach((v, c) => {
      const kept = c === 2 ? 2 ** -5 : 2 ** -6
      assert.ok(Math.abs(back[c]! - v) <= v * kept + 1e-4, `${rgb} channel ${c}: ${back[c]}`)
    })
  }
})

test('the buffers are the globals, the headers and some slots; the other slots, the pool and the figures of a pixel', () => {
  assert.equal(OIT_HEADER_WORDS, 9)
  assert.equal(OIT_LIST_BOUND, 256)
  assert.equal(OIT_NODE_WORDS, OIT_SLOT_WORDS + 1)
  assert.equal(
    oitHeadWords(100, 3),
    OIT_GLOBAL_WORDS + 100 * (OIT_HEADER_WORDS + 3 * OIT_SLOT_WORDS),
  )
  assert.equal(
    oitPoolWords(100, 4, 3, 400),
    100 * OIT_SLOT_WORDS + 400 * OIT_NODE_WORDS + OIT_DEBUG_WORDS,
  )
  // Only the pass's node count is cleared after a pass: the combination resets the words of the pixels it reads.
  assert.equal(OIT_CLEAR_BYTES, 4)
  assert.equal(oitDebugOffset(100, 4, 3, 400) + OIT_PIXEL_BYTES, oitPoolWords(100, 4, 3, 400) * 4)
  // The pool starts at its minimum and grows on the demand counted; a pixel's list bounds what it can ask.
  assert.equal(oitPoolMinimum(100), 1024)
  assert.equal(oitPoolMinimum(80000), 10000)
  assert.equal(oitPoolCeiling(100, 4), 100 * 252)
  // The largest pool a buffer holds: one node more would not fit.
  const bytes = oitPoolWords(100, 4, 3, 1000) * 4
  assert.equal(oitNodesFitting(100, 4, 3, bytes), 1000)
  assert.ok(oitPoolWords(100, 4, 3, 1001) * 4 > bytes)
  // The slots are split over two buffers so that the samples asked fit: 1080p with 4 samples is 166 MB of slots, over a 128 MiB binding.
  const pixels = 1920 * 1080
  const limit = 128 * 1024 * 1024
  const low = oitSplit(pixels, 4, limit)
  assert.ok(low > 0 && low < 4, `${low}`)
  assert.ok(oitHeadWords(pixels, low) * 4 <= limit)
  assert.ok(oitPoolWords(pixels, 4, low, oitPoolMinimum(pixels)) * 4 <= limit)
  assert.equal(oitSamplesFitting(pixels, 4, limit), 4)
  // Sixteen samples do not fit two such buffers: the most that do are kept, a square.
  assert.ok(oitSamplesFitting(pixels, 16, limit) < 16 && oitSamplesFitting(pixels, 16, limit) >= 4)
  assert.equal(oitSamplesFitting(pixels, 16, limit * 4), 16)
  assert.equal(oitSamplesFitting(100000, 4, 1000), 0)
  assert.equal(oitSplit(100000, 4, 1000), -1)
  const words = wordViews(new ArrayBuffer(OIT_PARAMS.words * 4))
  oitParams(words, 10, 60, 4, 3, 200, 0.05, OIT_NO_CURSOR)
  const at = OIT_PARAMS.at
  assert.deepEqual(
    [
      words.u[at.pitch],
      words.u[at.samples],
      words.u[at.pixels],
      words.u[at.nodes],
      words.u[at.low],
    ],
    [10, 4, 60, 200, 3],
  )
  assert.equal(words.u[at.cursor], OIT_NO_CURSOR)
  assert.equal(words.f[at.threshold], Math.fround(0.05))
})

test('the figures of a pixel are read back with the depth un-negated', () => {
  const words = new Uint32Array(OIT_DEBUG_WORDS)
  const floats = new Float32Array(words.buffer)
  words[0] = 2
  words[1] = 5
  floats[2] = -0.25
  words[3] = 0x7ff
  words[4] = 0
  floats[5] = -0.5
  const figures = readOitPixel(words, 4)
  assert.equal(figures.count, 4)
  assert.equal(figures.samples.length, 2)
  assert.equal(figures.samples[0]!.depth, 0.25)
  assert.equal(OIT_PIXEL_BYTES, words.byteLength)
  const lines = oitDebugLines(1, 4, 3, 2, [10, 20], figures)
  assert.ok(lines.global[0]!.endsWith('MLAB'))
  assert.ok(lines.own.includes('Sample Count: 4 4'))
  const metres = oitDebugLines(1, 4, 3, 2, [10, 20], figures, (z) => z * 100)
  assert.ok(metres.own.includes('Depth 25.0000'))
})

test('the plan ranks the pixels sort are the normal and additive blends alone', () => {
  const forward = 'forward' as const
  assert.ok(oitRank(pipelineBase('normal', forward)))
  assert.ok(oitRank(pipelineBase('additive', forward) + 2))
  for (const mode of ['subtractive', 'multiply', 'alphaComposite', 'alphaHoldout'] as const)
    assert.ok(!oitRank(pipelineBase(mode, forward)), mode)
  assert.ok(!oitRank(transmitBase(false, false)))
  assert.ok(!oitRank(WATER_BASE))
  assert.ok(variantOfBlend('normal', forward) >= 0)
})

test('the pass that blends leaves the ranks the sorted pass has a pipeline for to that pass, which draws those alone', () => {
  const pipeline = {} as GPURenderPipeline
  const set = { at: () => pipeline, skips: (rank: number) => rank === 9 }
  const oit = oitPipelineSet((rank) => (rank === 3 ? pipeline : undefined))
  const apart = oit.apart(set)
  assert.equal(oit.apart(set), apart)
  assert.deepEqual(
    [2, 3, 9].map((rank) => apart.skips!(rank)),
    [false, true, true],
  )
  assert.deepEqual(
    [2, 3, 9].map((rank) => oit.collects.skips!(rank)),
    [true, false, true],
  )
})

test('a device grants the sorted translucency from ten storage buffers a fragment stage', () => {
  assert.ok(!grantsOit({ limits: { maxStorageBuffersPerShaderStage: 9 } } as GPUDevice))
  assert.ok(!grantsOit({ limits: { maxStorageBuffersPerShaderStage: 8 } } as GPUDevice))
  assert.ok(grantsOit({ limits: { maxStorageBuffersPerShaderStage: 10 } } as GPUDevice))
  const own = { maxStorageBuffersPerShaderStage: 10, maxStorageBuffersInFragmentStage: 8 }
  assert.ok(!grantsOit({ limits: own } as unknown as GPUDevice))
})

test('the blend module holds the stage that collects only when asked', () => {
  assert.ok(!blendShader({}).includes('fsBlendOit'))
  const sorted = blendShader({}, { oit: true })
  assert.ok(sorted.includes('fn fsBlendOit('))
  assert.ok(sorted.includes('@group(2) @binding(0) var<storage,read_write> oit:array<atomic<u32>>'))
  assert.ok(sorted.includes('@group(2) @binding(1) var<uniform> oitParams:OitParams'))
  assert.ok(!OIT_COMBINE_WGSL.includes('atomic'))
  assert.ok(
    sorted.includes('@group(2) @binding(3) var<storage,read_write> oitB:array<atomic<u32>>'),
  )
  // No lock, no wait, no loop: the fragments append, and the spill of a fragment past the list is summed by atomic adds that commute.
  assert.ok(!sorted.includes('atomicCompareExchangeWeak(') && !sorted.includes('atomicMax('))
  assert.ok(sorted.includes('if(node>=oitParams.nodes){oitSpill(header,f,key);return;}'))
  assert.ok(!sorted.includes('hizOpaqueDepth(vec2i(pixel))'))
})

test('the fragments are kept in slots then a pool, sorted by key in the combination, with no sum of an overflow', () => {
  const sorted = blendShader({}, { oit: true })
  // Every fragment is kept whatever the method: no room check, no method in the buffer's parameters.
  assert.ok(!sorted.includes('oitParams.method') && !OIT_COMBINE_WGSL.includes('oitParams.method'))
  assert.ok(!('method' in OIT_PARAMS.at))
  // The first fragments of a pixel take the slots it owns; the others a node of the pool; no unweighted sum of what the pool has no node for.
  assert.ok(sorted.includes('fn oitAdd(pixel:vec2u,f:OitFrag,key:vec2u)'))
  assert.ok(sorted.includes('if(arrived<oitParams.samples){frag=oitSlotRef(pix,arrived);}'))
  assert.ok(sorted.includes('if(arrived>=256u){oitSpill(header,f,key);return;}'))
  assert.ok(sorted.includes('oitPut(frag,3u,key.x);'))
  assert.ok(sorted.includes('oitPut(frag,4u,key.y);'))
  for (const gone of ['oitOverflow', 'oitAddWide', 'oitFixedLight', 'oitFixedLog', 'oitWide'])
    assert.ok(!sorted.includes(gone) && !OIT_COMBINE_WGSL.includes(gone), gone)
  // The key is the primitive's place in the paint order, whole, in the stage's fourth word, and the triangle's rank from the first.
  assert.ok(sorted.includes('oitAdd(pixel,f,vec2u(in.words.w,in.words.x&65535u))'))
  assert.match(sorted, /@location\(7\) @interpolate\(flat\) words:vec4u/)
  assert.ok(sorted.includes('out.words.w=(vertexIndex>>uni.vertexShift)+instance;'))
  assert.match(blendShader({}), /@location\(7\) @interpolate\(flat\) words:vec3u/)
  assert.ok(!blendShader({}).includes('out.words.w'))
  // Additive layers let one minus their opacity through, as the others do.
  assert.ok(sorted.includes('f.trans=vec3f(1.0-alpha);'))
  // The combination walks the list once (no link written back), resets the words it read, replaces the alpha.
  assert.ok(OIT_COMBINE_WGSL.includes('oitWalk(header,arrived,samples);'))
  assert.ok(!OIT_COMBINE_WGSL.includes('oit[at+4u]=node'))
  assert.ok(OIT_COMBINE_WGSL.includes('for(var i=0u;i<9u;i++){oit[header+i]=0u;}'))
  assert.ok(!OIT_COMBINE_WGSL.includes('3.0e38'))
  // One hold on a light for the packing.
  assert.ok(sorted.includes('fn oitPack(c:vec3f)->u32{return packLight(oitClean(c));}'))
})

test('a fragment that covers no sample adds nothing, and no backtick is in the programs', () => {
  const sorted = blendShader({}, { oit: true })
  assert.ok(sorted.includes('@builtin(sample_mask) covered:u32'))
  assert.ok(sorted.includes('if(covered!=0u&&alpha>OIT_OPACITY_THRESHOLD'))
  // The spill is summed by atomic adds, six sums and a flag word; nothing is stored whole, so nothing depends on the order.
  assert.equal(sorted.split('atomicAdd(&oit[header+word],step)').length - 1, 1)
  assert.equal(sorted.split('oitSpillAdd(header,').length - 1, 6)
  // The stage's own text (from its address helpers on), the pack and the walk, the combinations: a backtick in a WGSL string ends its template.
  assert.ok(sorted.includes('const OIT_POOL_BIT'))
  assert.ok(
    !sorted
      .slice(
        sorted.indexOf('const OIT_POOL_BIT'),
        sorted.indexOf('return BlendOut(vec4f(0.0),o.request'),
      )
      .includes('`'),
  )
  assert.ok(!wgslModule(OIT_PACK_WGSL).includes('`') && !walkProgram.includes('`'))
  assert.ok(!OIT_COMBINE_WGSL.includes('`') && !OIT_COMBINE_DUAL_WGSL.includes('`'))
})

test('the combination is one dual-source draw, or a multiply then an add, with the same walk', () => {
  assert.ok(OIT_COMBINE_DUAL_WGSL.includes('enable dual_source_blending;'))
  assert.ok(OIT_COMBINE_DUAL_WGSL.includes('@blend_src(1) factor:vec4f'))
  assert.ok(
    OIT_COMBINE_DUAL_WGSL.includes('OitDual(vec4f(oitSum,oitAlpha()),vec4f(oitThrough,0.0))'),
  )
  assert.ok(
    !OIT_COMBINE_WGSL.includes('dual_source_blending') && !OIT_COMBINE_WGSL.includes('blend_src'),
  )
  // The multiply draw does not reset the header the add draw reads; the per-channel transmittance multiplies the target.
  assert.ok(
    OIT_COMBINE_WGSL.includes('fn oitScale(') &&
      OIT_COMBINE_WGSL.includes('oitResolve(position,false)'),
  )
  assert.ok(OIT_COMBINE_WGSL.includes('return vec4f(oitThrough,1.0);'))
  // The second draw reads what the first left in the pixel's first slot, and resets the header.
  assert.ok(OIT_COMBINE_WGSL.includes('fn oitLight(') && !OIT_COMBINE_WGSL.includes('fn oitAdd('))
  assert.equal(OIT_COMBINE_WGSL.split('oitWalk(header,arrived,samples);').length - 1, 1)
  assert.ok(OIT_COMBINE_WGSL.includes('oitReset(header);\n return shown;'))
  assert.ok(OIT_COMBINE_WGSL.includes('saturate(dot(oitThrough,vec3f(1.0/3.0)))'))
})

type Frag = { colour: number[]; depth: number; trans: number[] }
interface Twin {
  oitMerge: (last: Frag, behind: Frag) => Frag
  oitHidden: (last: Frag, depth: number, threshold: number) => boolean
  oitClean: (c: number[]) => number[]
}
const twin = shaderRun<Twin>(wgslModule(OIT_PACK_WGSL), ['oitMerge', 'oitHidden', 'oitClean'], {})

test('the merge chains the last layer with the ones behind it, as the reference does', () => {
  const near: Frag = { colour: [0.2, 0.1, 0], depth: 1, trans: [0.5, 0.5, 0.5] }
  const mid: Frag = { colour: [0.1, 0.1, 0.1], depth: 2, trans: [0.5, 0.25, 0.5] }
  const far: Frag = { colour: [0, 0, 0.4], depth: 3, trans: [0.5, 0.5, 0.5] }
  const chained = twin.oitMerge(twin.oitMerge(near, mid), far)
  // Merging the two farther ones first gives the same light and transmittance: the product is associative.
  const behind = twin.oitMerge(mid, far)
  const grouped = twin.oitMerge(near, behind)
  chained.colour.forEach((v, c) => assert.ok(Math.abs(v - grouped.colour[c]!) < 1e-6))
  assert.deepEqual(
    chained.colour.map((v) => Math.fround(v)),
    [0.2 + 0.5 * 0.1 + 0.25 * 0, 0.1 + 0.5 * 0.1 + 0.125 * 0, 0 + 0.5 * 0.1 + 0.25 * 0.4].map((v) =>
      Math.fround(v),
    ),
  )
  assert.deepEqual(chained.trans, [0.125, 0.0625, 0.125])
  assert.equal(chained.depth, 1)
})

test('a fragment is dropped behind the last stored one only when its merged transmittance is under the threshold in every channel', () => {
  const last: Frag = { colour: [1, 1, 1], depth: 2, trans: [0.04, 0.01, 0.049] }
  assert.ok(twin.oitHidden(last, 3, 0.05))
  assert.ok(!twin.oitHidden(last, 1, 0.05))
  assert.ok(!twin.oitHidden({ ...last, trans: [0.04, 0.06, 0.01] }, 3, 0.05))
  // The merged transmittance counts: a layer that lets 0.2 through, with 0.2 merged behind it, hides what is farther.
  const merged = twin.oitMerge(
    { ...last, trans: [0.2, 0.2, 0.2] },
    { ...last, trans: [0.2, 0.2, 0.2] },
  )
  assert.ok(twin.oitHidden(merged, 5, 0.05))
})

test('the light is held once for the packing: no NaN, from 0 to a kept sample range, not under it', () => {
  assert.deepEqual(twin.oitClean([NaN, -1, 5000]), [0, 0, 5000])
  assert.deepEqual(twin.oitClean([1e9, 65504, 4097]), [65504, 65504, 4097])
})

interface SpillTwin {
  oitSpillLightFixed: (c: number[], key: number[]) => number[]
  oitSpillTransFixed: (t: number[], key: number[]) => number[]
  oitSpillLightOf: (w: number[], flags: number) => number[]
  oitSpillTransOf: (w: number[], flags: number) => number[]
}
const spillTwin = shaderRun<SpillTwin>(
  wgslModule(OIT_PACK_WGSL),
  ['oitSpillLightFixed', 'oitSpillTransFixed', 'oitSpillLightOf', 'oitSpillTransOf'],
  {},
)

/** The spill as the atomic adds make it: sums of fixed points (each rounded by the hash of the fragment's order key pair), the flag of a sum that wrapped past its 32 bits, in any order. */
function spilled(fragments: readonly { colour: number[]; trans: number[]; key: number[] }[]) {
  const sums = [0, 0, 0, 0, 0, 0]
  let flags = 0
  for (const f of fragments) {
    const steps = [
      ...spillTwin.oitSpillLightFixed(f.colour, f.key),
      ...spillTwin.oitSpillTransFixed(f.trans, f.key),
    ]
    steps.forEach((step, k) => {
      if (step === 0) return
      const old = sums[k]!
      sums[k] = (old + step) >>> 0
      if (sums[k]! < old) flags |= 1 << k
    })
  }
  return { light: sums.slice(0, 3), trans: sums.slice(3), flags }
}

test('the spill is a sum of fixed points: it starts as the identity, commutes, and chains the transmittances as the reference merges them', () => {
  assert.deepEqual(spillTwin.oitSpillTransOf([0, 0, 0], 0), [1, 1, 1])
  assert.deepEqual(spillTwin.oitSpillLightOf([0, 0, 0], 0), [0, 0, 0])
  const fragments = [
    { colour: [0.2, 0.1, 0], trans: [0.5, 0.5, 0.5], key: [1, 0] },
    { colour: [0.1, 0.1, 0.1], trans: [0.5, 0.25, 0.5], key: [2, 0] },
    { colour: [0, 0, 0.4], trans: [0.25, 0.5, 0.5], key: [3, 0] },
  ]
  const forward = spilled(fragments)
  // Whatever the order the fragments arrive in, the words are the same.
  assert.deepEqual(spilled(fragments.slice().reverse()), forward)
  assert.deepEqual(spilled([fragments[1]!, fragments[2]!, fragments[0]!]), forward)
  const trans = spillTwin.oitSpillTransOf(forward.trans, forward.flags)
  const light = spillTwin.oitSpillLightOf(forward.light, forward.flags)
  // The product of the transmittances and the sum of the lights (the fragments' mutual order is the approximation).
  ;[0.5 * 0.5 * 0.25, 0.5 * 0.25 * 0.5, 0.5 * 0.5 * 0.5].forEach((t, c) =>
    assert.ok(Math.abs(trans[c]! - t) < 5e-3, `trans ${c}`),
  )
  ;[0.3, 0.2, 0.5].forEach((l, c) => assert.ok(Math.abs(light[c]! - l) < 3 / 256, `light ${c}`))
  // Opaque layers drive the transmittance to zero without a NaN, and a sum past its range reads as the top, whatever the order.
  const opaque = spilled([{ colour: [1000, 1e9, NaN], trans: [0, -1, NaN], key: [1, 0] }])
  assert.ok(spillTwin.oitSpillTransOf(opaque.trans, opaque.flags).every((t) => t < 1e-6 || t === 1))
  assert.ok(spillTwin.oitSpillLightOf(opaque.light, opaque.flags).every((l) => l <= 65504))
  // The fixed point is made for the half float's range: 256 fragments at the largest light a fragment holds (65504) fit before the sum saturates,
  // the 257th wraps it, and a wrapped sum reads as the top; the precision is 1/256 of a unit.
  const full = (count: number) =>
    spilled(
      Array.from({ length: count }, (_, i) => ({
        colour: [65504, 0, 0],
        trans: [1, 1, 1],
        key: [i, 0],
      })),
    )
  const fits = full(256)
  assert.equal(fits.flags & 1, 0)
  assert.equal(spillTwin.oitSpillLightOf(fits.light, fits.flags)[0], 256 * 65504)
  const top = full(257)
  assert.equal(top.flags & 1, 1)
  assert.equal(spillTwin.oitSpillLightOf(top.light, top.flags)[0], 0xffffffff / 256)
  assert.equal(full(300).flags & 1, 1)
  // A light of a few thousandths keeps its precision: 1/256 of a unit a step, rounded up or down by the key's hash (one step of error at most).
  const small = spilled([{ colour: [0.3, 0.001, 1.5], trans: [1, 1, 1], key: [7, 1] }])
  const smallLight = spillTwin.oitSpillLightOf(small.light, small.flags)
  assert.ok(Math.abs(smallLight[0]! - 0.3) <= 1 / 256)
  assert.ok(Math.abs(smallLight[2]! - 1.5) <= 1 / 256)
  assert.ok(smallLight[1]! <= 1 / 256)
  // A transmittance keeps its logarithm to the same step: 2 to the minus 1/256 at worst, a relative error under 0.3 percent.
  const dim = spilled([{ colour: [0, 0, 0], trans: [0.3, 0.6, 0.9], key: [8, 2] }])
  spillTwin.oitSpillTransOf(dim.trans, dim.flags).forEach((t, c) => {
    const exact = [0.3, 0.6, 0.9][c]!
    assert.ok(Math.abs(t / exact - 1) < 0.003, `trans ${c}: ${t}`)
  })
  // The rounding is the key's alone: the same pair rounds the same way every time, whatever else arrives.
  const again = spilled([{ colour: [0.3, 0.001, 1.5], trans: [1, 1, 1], key: [7, 1] }])
  assert.deepEqual(again, small)
})

test('the spill rounds without bias: thousands of faint fragments sum to the exact float sums within one percent', () => {
  // 5000 fragments of an opacity of 0.0015 and a colour of 0.3: each light is 0.00045 (a tenth of a unit of 1/256 would round to nothing) and each
  // transmittance 0.9985 (a nearest rounding of its logarithm would leave it at one, or darken it by twice its own amount).
  const alpha = 0.0015
  const fragments = Array.from({ length: 5000 }, (_, i) => ({
    colour: [0.3 * alpha, 0.3 * alpha, 0.3 * alpha],
    trans: [1 - alpha, 1 - alpha, 1 - alpha],
    key: [(i >> 2) + 1, i & 3],
  }))
  const sums = spilled(fragments)
  const light = spillTwin.oitSpillLightOf(sums.light, sums.flags)
  const through = spillTwin.oitSpillTransOf(sums.trans, sums.flags)
  const exactLight = 5000 * 0.3 * alpha
  const exactThrough = (1 - alpha) ** 5000
  light.forEach((l, c) => assert.ok(Math.abs(l / exactLight - 1) < 0.01, `light ${c}: ${l}`))
  through.forEach((t, c) => assert.ok(Math.abs(t / exactThrough - 1) < 0.01, `trans ${c}: ${t}`))
  // Whatever order they arrive in, the same sums.
  assert.deepEqual(spilled(fragments.slice().reverse()), sums)
})

/** The reference's multi-layer insertion, fragment by fragment in the order its raster-ordered view gives them, as it is written. */
function mlab(fragments: readonly Frag[], samples: number, threshold: number) {
  const kept: Frag[] = []
  for (const fragment of fragments) {
    let cur = fragment
    const count = kept.length
    if (count > 0) {
      const last = kept[count - 1]!
      if (cur.depth > last.depth && last.trans.every((t) => t < threshold)) continue
    }
    for (let j = 0; j < count; j++) {
      if (cur.depth < kept[j]!.depth) [kept[j], cur] = [cur, kept[j]!]
    }
    if (count >= samples) {
      const last = kept[samples - 1]!
      kept[samples - 1] = {
        colour: last.colour.map((c, i) => Math.fround(c + last.trans[i]! * cur.colour[i]!)),
        trans: last.trans.map((t, i) => Math.min(Math.max(Math.fround(t * cur.trans[i]!), 0), 1)),
        depth: Math.min(last.depth, cur.depth),
      }
    } else kept.push(cur)
  }
  return kept
}

interface KeyedFrag extends Frag {
  key: number
  tri?: number
}
interface Walk {
  oitWalk: (header: number, arrived: number, samples: number) => void
  oitHeaderAt: (pix: number) => number
  packWord: (c: number[]) => number
  keptAt: (i: number) => Frag
  keptCount: () => number
  reset: () => void
}
const walkProgram = `${wgslModule(OIT_WALK_WGSL)}
fn packWord(c:vec3f)->u32{return oitPack(c);}
fn keptAt(i:u32)->OitFrag{return oitKept[i];}
fn keptCount()->u32{return oitCount;}
fn reset(){oitCount=0u;}
`

/** The buffers of one pixel keeping `samples` fragments, `low` slots in the head: the fragments put in as the stage that collects puts them, in the order given: the first take the slots, the others the pool, linked at its head. */
function collected(
  arrival: readonly KeyedFrag[],
  samples: number,
  low: number,
  pack: Walk['packWord'],
  spill?: ReturnType<typeof spilled>,
) {
  const nodes = Math.max(arrival.length, 1)
  const head = new Uint32Array(oitHeadWords(1, low))
  const pool = new Uint32Array(oitPoolWords(1, samples, low, nodes))
  const header = OIT_GLOBAL_WORDS
  let used = 0
  arrival.forEach((f, taken) => {
    head[header + 1] = taken + 1
    let words = head
    let at = header + OIT_HEADER_WORDS + taken * OIT_SLOT_WORDS
    if (taken >= samples) {
      const node = ++used
      words = pool
      at = (samples - low) * OIT_SLOT_WORDS + (node - 1) * OIT_NODE_WORDS
      pool[at + 5] = head[header]!
      head[header] = node
    } else if (taken >= low) {
      words = pool
      at = (taken - low) * OIT_SLOT_WORDS
    }
    new Float32Array(words.buffer)[at] = f.depth
    words[at + 1] = pack(f.colour)
    words[at + 2] = pack(f.trans)
    words[at + 3] = f.key
    words[at + 4] = f.tri ?? 0
  })
  head[0] = used
  if (spill) {
    spill.light.forEach((w, c) => (head[header + OIT_HEADER_SPILL_LIGHT + c] = w))
    spill.trans.forEach((w, c) => (head[header + OIT_HEADER_SPILL_TRANS + c] = w))
    head[header + OIT_HEADER_SPILL_SAT] = spill.flags
  }
  return { head, pool, nodes }
}

function randomFragments(count: number, random: () => number) {
  const levels = [0.25, 0.5, 0.75, 1, 0.125]
  // Paint order: the keys rise; the depths do not follow them.
  // Three primitives of a key share it, told apart by the triangle's rank: the order is the pair's, whatever chunk or run a pair falls at the end of.
  return Array.from({ length: count }, (_, i): KeyedFrag => ({
    key: Math.floor(i / 3) + 1,
    tri: i % 3,
    depth: -Math.fround(random()),
    colour: [levels[Math.floor(random() * 5)]!, 0.5, levels[Math.floor(random() * 5)]!],
    trans: [0.5, levels[Math.floor(random() * 5)]!, 0.75],
  }))
}

test("the combination inserts a pixel's fragments in key order, whatever order they arrived in, as the reference does", () => {
  const kept: unknown[] = []
  const params = { pitch: 1, samples: 0, threshold: 0.05, pixels: 1, nodes: 0, cursor: 0, low: 0 }
  const view = {
    oit: new Uint32Array(0),
    oitB: new Uint32Array(0),
    oitParams: params,
    oitKept: kept,
    oitRun: [],
  }
  // The scope's buffers are replaced per run: the program reads them by name, so each run gets its own program closure.
  const run = (
    buffers: { head: Uint32Array; pool: Uint32Array },
    samples: number,
    low: number,
    nodes: number,
    arrived: number,
  ) => {
    kept.length = 0
    const w = shaderRun<Walk>(
      walkProgram,
      ['oitWalk', 'oitHeaderAt', 'packWord', 'keptAt', 'keptCount', 'reset'],
      {
        ...view,
        oit: buffers.head,
        oitB: buffers.pool,
        oitParams: { ...params, samples, nodes, low },
      },
    )
    w.reset()
    w.oitWalk(w.oitHeaderAt(0), arrived, samples)
    return Array.from({ length: w.keptCount() }, (_, i) => w.keptAt(i))
  }
  const pack = shaderRun<Walk>(walkProgram, ['packWord'], { ...view }).packWord
  let seed = 12345
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
  const shuffled = (list: readonly KeyedFrag[]) => {
    const arrival = list.slice()
    for (let i = arrival.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[arrival[i], arrival[j]] = [arrival[j]!, arrival[i]!]
    }
    return arrival
  }
  const same = (got: Frag[], expected: Frag[], label: string, tolerance = 1e-5) => {
    assert.equal(got.length, expected.length, label)
    got.forEach((f, i) => {
      const e = expected[i]!
      f.colour.forEach((c, k) =>
        assert.ok(Math.abs(c - e.colour[k]!) < tolerance, `${label} colour ${i}`),
      )
      f.trans.forEach((t, k) =>
        assert.ok(Math.abs(t - e.trans[k]!) < tolerance, `${label} trans ${i}`),
      )
    })
  }
  for (const samples of [1, 2, 4, 9, 16])
    for (const count of [1, 3, 4, 5, 9, 17, 32, 33, 40, 70, 256]) {
      const painted = randomFragments(count, random)
      const expected = mlab(painted, samples, 0.05)
      for (const low of new Set([0, Math.ceil(samples / 2), samples])) {
        const { head, pool, nodes } = collected(shuffled(painted), samples, low, pack)
        const got = run({ head, pool }, samples, low, nodes, count)
        same(got, expected, `${count} fragments, ${samples} samples, ${low} low`)
        got.forEach((f, i) => assert.equal(f.depth, expected[i]!.depth))
      }
    }
  // A pixel past the list's bound lists the first 256 fragments to ARRIVE (the order the GPU's atomic count gives, here a shuffle) and sums the others
  // into the spill, merged behind the last kept sample. What is guaranteed: the listed fragments are walked in key order, so the result is exactly the
  // reference's insertion of the listed ones followed by the merge of the spill, whatever order the listed ones lie in; and the spill is the sum of
  // the others, the same words whatever order those arrive in. Which fragments fall past the bound is the arrival order's: another order lists others.
  for (const samples of [4, 9])
    for (const over of [1, 44, 5000]) {
      // Every fragment past the bound: 256 listed and `over` spilled, not always the same dozen.
      const painted = randomFragments(256 + over, random)
      const keyOrder = (a: KeyedFrag, b: KeyedFrag) => a.key - b.key || (a.tri ?? 0) - (b.tri ?? 0)
      const arrival = shuffled(painted)
      const listed = arrival.slice(0, 256)
      const beyond = arrival.slice(256)
      assert.equal(beyond.length, over)
      const keyed = (list: readonly KeyedFrag[]) =>
        list.map((f) => ({ ...f, key: [f.key, f.tri ?? 0] }))
      const sums = spilled(keyed(beyond))
      // The spill does not depend on the order its fragments arrive in.
      assert.deepEqual(spilled(keyed(beyond).slice().reverse()), sums)
      assert.deepEqual(spilled(keyed(shuffled(beyond))), sums)
      // It is the exact float sums, to a hundredth and a step of the fixed point (the rounding is unbiased).
      const light = spillTwin.oitSpillLightOf(sums.light, sums.flags)
      const through = spillTwin.oitSpillTransOf(sums.trans, sums.flags)
      for (let k = 0; k < 3; k++) {
        const exactLight = beyond.reduce((sum, f) => sum + f.colour[k]!, 0)
        const exactLog = beyond.reduce((sum, f) => sum - Math.log2(f.trans[k]!), 0)
        assert.ok(Math.abs(light[k]! - exactLight) <= 0.01 * exactLight + 1 / 256, `light ${k}`)
        assert.ok(
          Math.abs(sums.trans[k]! / 256 - exactLog) <= 0.01 * exactLog + 1 / 256,
          `trans ${k}`,
        )
      }
      const expected = mlab(listed.slice().sort(keyOrder), samples, 0.05)
      const last = expected[expected.length - 1]!
      expected[expected.length - 1] = {
        ...last,
        colour: last.colour.map((c, k) => c + last.trans[k]! * light[k]!),
        trans: last.trans.map((t, k) => t * through[k]!),
      }
      // The listed fragments in their arrival order, and in another one: the same result.
      const results = [listed, shuffled(listed)].map((order) => {
        const { head, pool, nodes } = collected(order, samples, 1, pack, sums)
        return run({ head, pool }, samples, 1, nodes, 256 + over)
      })
      same(results[0]!, expected, `${samples} samples, ${over} over`, 2e-3)
      same(results[1]!, results[0]!, 'the same again', 1e-12)
    }
  // The pool ran out: a fragment with no node is summed into the spill and merged behind the last, none dropped.
  const two: KeyedFrag[] = [
    { key: 256, depth: -0.5, colour: [0.25, 0.25, 0.25], trans: [0.5, 0.5, 0.5] },
    { key: 512, depth: -0.25, colour: [0.5, 0.5, 0.5], trans: [0.5, 0.5, 0.5] },
  ]
  const { head, pool, nodes } = collected(
    two,
    2,
    2,
    pack,
    spilled([{ colour: [0.125, 0.125, 0.125], trans: [0.5, 0.5, 0.5], key: [9, 0] }]),
  )
  const merged = run({ head, pool }, 2, 2, nodes, 3)
  assert.equal(merged.length, 2)
  assert.ok(Math.abs(merged[1]!.colour[0]! - (0.5 + 0.5 * 0.125)) < 1e-3)
  assert.ok(Math.abs(merged[1]!.trans[0]! - 0.25) < 1e-3)
  assert.equal(merged[0]!.colour[0], 0.25)
  assert.equal(merged[1]!.depth, -0.25)
})

test('the insertion keeps the nearest fragments sorted, merges the ones it pushes out into the last, and drops what lies behind a last that lets nothing through', () => {
  const kept: unknown[] = []
  const w = shaderRun<{
    feed: (depth: number, c: number, t: number, samples: number, threshold: number) => void
    keptAt: (i: number) => Frag
    keptCount: () => number
  }>(
    `${wgslModule(OIT_INSERT_WGSL)}
fn feed(depth:f32,c:f32,t:f32,samples:u32,threshold:f32){var f:OitFrag;f.depth=depth;f.colour=vec3f(c);f.trans=vec3f(t);oitInsert(f,samples,threshold);}
fn keptAt(i:u32)->OitFrag{return oitKept[i];}
fn keptCount()->u32{return oitCount;}
`,
    ['feed', 'keptAt', 'keptCount'],
    { oitKept: kept },
  )
  w.feed(3, 1, 0.5, 2, 0.05)
  w.feed(1, 0.5, 0.5, 2, 0.05)
  assert.deepEqual([w.keptAt(0).depth, w.keptAt(1).depth, w.keptCount()], [1, 3, 2])
  // A nearer third pushes the farthest out, which is merged into the last (itself).
  w.feed(2, 0.25, 0.5, 2, 0.05)
  assert.deepEqual([w.keptAt(0).depth, w.keptAt(1).depth], [1, 2])
  assert.equal(w.keptAt(1).colour[0], 0.25 + 0.5 * 1)
  assert.equal(w.keptAt(1).trans[0], 0.25)
  assert.equal(w.keptCount(), 2)
})

test('the debug figures hold a depth a scene depth can be made of: none is infinite', () => {
  assert.ok(!OIT_COMBINE_WGSL.includes('3.0e38'))
  const projection = new Float64Array(16)
  opticsProjection(projection, 50, 1.5, 0.1, 2000, 1, null)
  assert.ok(Number.isFinite(oitSceneDepth(projection, 1e-30)))
})

test('the debug depth is the distance in centimetres of the normalized depth', () => {
  const projection = new Float64Array(16)
  opticsProjection(projection, 50, 1.5, 0.1, 2000, 1, null)
  // Reversed depth, infinite far plane: a point at 2 metres lies at 0.1 / 2.
  assert.ok(Math.abs(oitSceneDepth(projection, 0.1 / 2) - 200) < 1e-6)
  assert.ok(Math.abs(oitSceneDepth(projection, 0.1 / 40) - 4000) < 1e-6)
})

test('the global node count is tested before it is taken, so it never runs past the pool', () => {
  const sorted = blendShader({}, { oit: true })
  const test = 'if(atomicLoad(&oit[0])>=oitParams.nodes){oitSpill(header,f,key);return;}'
  const take = 'let node=atomicAdd(&oit[0],1u);'
  assert.ok(sorted.includes(test) && sorted.includes(take))
  assert.ok(sorted.indexOf(test) < sorted.indexOf(take))
  // The spill sums wrap-detect: a flag when an add wraps the word.
  assert.ok(sorted.includes('if(old+step<old){atomicOr(&oit[header+8u],1u<<bit);}'))
  // The shipped path run on a pixel with a pool of eight nodes: the count stops at the pool, the fragments past it are all in the spill, none lost.
  const nodes = 8
  const samples = 1
  const arrived = 100
  const head = new Uint32Array(oitHeadWords(1, samples))
  const pool = new Uint32Array(oitPoolWords(1, samples, samples, nodes))
  const w = shaderRun<{ oitAdd: (pixel: number[], f: unknown, key: number[]) => void }>(
    wgslModule(oitCollectWgsl({ entry: '' })),
    ['oitAdd'],
    {
      oit: head,
      oitB: pool,
      oitParams: { pitch: 1, samples, threshold: 0.05, pixels: 1, nodes, cursor: 0, low: samples },
    },
  )
  for (let i = 0; i < arrived; i++)
    w.oitAdd([0, 0], { colour: [0.5, 0.5, 0.5], depth: -0.5, trans: [0.5, 0.5, 0.5] }, [i + 1, 0])
  const header = OIT_GLOBAL_WORDS
  assert.equal(head[0], nodes)
  assert.equal(head[header + 1], arrived)
  // One in a slot, eight in nodes, the others summed: each adds a light of 0.5 (128 units) to the first sum.
  assert.equal(head[header + OIT_HEADER_SPILL_LIGHT], (arrived - samples - nodes) * 128)
})
