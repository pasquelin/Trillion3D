// The stochastic direct light's programs assemble, and their sample is packed as the reference packs it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  STOCHASTIC_COMPACT_ENTRY,
  STOCHASTIC_GENERATE_ENTRY,
  STOCHASTIC_GENERATE_BINDINGS,
  STOCHASTIC_GENERATE_WGSL,
  STOCHASTIC_SHADE_ENTRY,
  STOCHASTIC_TEMPORAL_ENTRY,
  stochasticTemporalProgramOf,
  stochasticCompactProgramOf,
  stochasticShadeProgramOf,
} from './stochasticWgsl.ts'
const STOCHASTIC_TEMPORAL_WGSL = stochasticTemporalProgramOf(WORD_LIGHT_FORMAT)

test('the four programs assemble, over masks in both formats', () => {
  assertProgramAssembles(STOCHASTIC_GENERATE_WGSL, STOCHASTIC_GENERATE_ENTRY)
  assertProgramAssembles(STOCHASTIC_TEMPORAL_WGSL, STOCHASTIC_TEMPORAL_ENTRY)
  for (const format of ['grey', 'colour'] as const) {
    assertProgramAssembles(stochasticCompactProgramOf(format), STOCHASTIC_COMPACT_ENTRY)
    assertProgramAssembles(
      stochasticShadeProgramOf(format, WORD_LIGHT_FORMAT),
      STOCHASTIC_SHADE_ENTRY,
    )
  }
})

test('a sample packs its light in 12 bits, its flags at 0x8000 and 0x4000 and its weight as a half float over them', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('0xfffu'))
  assert.ok(text.includes('select(0u,0x8000u,visible)|select(0u,0x4000u,completed)'))
  assert.ok(text.includes('pack2x16float(vec2f(weight,0.0))&0xffffu)<<16u'))
})

test('the generation picks as the reservoir does: tau is the running share, the number is rescaled in the half it falls in, and a weight is the sum over the samples times its own', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('let tau=weightSum/(weightSum+picked.weight);'))
  assert.ok(text.includes('random[s]/=tau;'))
  assert.ok(text.includes('random[s]=(random[s]-tau)/(1.0-tau);'))
  assert.ok(text.includes('weightSum/(f32(samples)*weight[s])'))
  assert.ok(text.includes('log2(luminanceOf(pdf)+1.0)'))
})

test('the generation picks the lights of the tile itself, as the reference does: the lights that reach it by a light a lane into a mask of bits, then the candidates walked by rank', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('for(var rank=lane;rank<lightCount;rank+=64u){'))
  assert.ok(
    text.includes(
      'if(tileLightReached(directLights.items[rank],box)){atomicOr(&candidateMask[rank/32u],1u<<(rank%32u));}',
    ),
  )
  assert.ok(text.includes('let box=tileBox(page,coord,vec2f(0.0,1.0));'), 'the card’s whole depth')
  assert.ok(text.includes('let rank=w*32u+firstTrailingBit(bits);'))
  // It reads no list of the tiles' lights: it writes it.
  assert.doesNotMatch(text, /cardTileLights|tileLightWord|tileLightMask|head\.lights/)
})

test('the lights picked are appended as the tile’s light tiles, in order of rank, none left out for a cap of the tile (as many as its texels’ samples can pick), and a sample names its light by its place among them', () => {
  const text = STOCHASTIC_GENERATE_WGSL
  assert.ok(text.includes('for(var w=0u;w<words;w++){'))
  assert.doesNotMatch(
    text,
    /kept<MAX_LIGHTS|bits!=0u&&kept/,
    'the picks are not cut at a number of lights',
  )
  assert.ok(
    text.includes('var<workgroup> tilePicks:array<u32,256>;') ||
      text.includes('const MAX_LIGHTS:u32=256u;'),
    'a tile’s list holds every pick its 64 texels can make with 4 samples',
  )
  assert.ok(
    text.includes(
      'tilePicks[wanted]=(lightKind(directLights.items[rank],standaloneLight(rank))<<14u)|rank;',
    ),
  )
  assert.ok(
    text.includes('pickedCount=appendTileLights(tile,wanted);'),
    'a sample finds its place among the lights the list had room for',
  )
  assert.ok(text.includes('packed=packSample(k,true,!castsShadow(directLights.items[rankOf[s]]),'))
  // The picks are marked before the barrier the leading thread reads them after, and the places are read after the one that follows its append.
  const mark = text.indexOf('atomicOr(&pickedMask[')
  const read = text.indexOf('atomicLoad(&pickedMask[w])')
  const places = text.indexOf('for(var k=0u;k<pickedCount;k++){')
  assert.ok(mark > 0 && mark < text.indexOf('workgroupBarrier();', mark))
  assert.ok(text.indexOf('workgroupBarrier();', mark) < read)
  assert.ok(text.indexOf('workgroupBarrier();', read) < places)
})

test('the generation binds eight storage buffers, the guaranteed limit: the tables, the context, the counters, the culled light tiles, the tiles’ offsets, the lights, the bits of the standalone lights and the samples', () => {
  const B = STOCHASTIC_GENERATE_BINDINGS
  assert.deepEqual(wgslBufferBindings(STOCHASTIC_GENERATE_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.context, type: 'read-only-storage' },
    { binding: B.counts, type: 'storage' },
    { binding: B.culled, type: 'storage' },
    { binding: B.cardTileOffsets, type: 'storage' },
    { binding: B.lights, type: 'read-only-storage' },
    { binding: B.standalone, type: 'read-only-storage' },
    { binding: B.samples, type: 'storage' },
  ])
})
