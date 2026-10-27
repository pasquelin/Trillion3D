// The words that carry an object's lighting channels and marks, each in the bits above the ones below it and none in another's: the
// placement's switches, the page's marks, the surface flags, the translucent items' flags and the triangle word the blend stage hands
// its fragments, and what an item's flags and a triangle word leave for the next fact. One test over all the carriers: a shift moved
// without the others breaks it, naming the carriers that now overlap.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  LIGHTING_CHANNEL_COUNT,
  storedLightingChannels,
} from '../../../sdk-core/src/contracts/lightingChannelsAbi.ts'
import { LIGHTING_CHANNELS_WGSL } from '../lighting/lightingChannelsWgsl.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { lightChannelsOf } from '../lighting/direct/lightReachWgsl.ts'
import { channelsOfFlags } from '../materials/surface/surfaceChannels.ts'
import {
  LIGHT_CHANNELS_SHIFT,
  LIGHT_SHADOWED,
  LIGHT_SHADOWED_SHIFT,
} from '../../../sdk-core/src/scene/light/contracts.ts'
import { kindLane } from '../../../sdk-core/src/scene/light/lanes.fixture.ts'
import {
  PLACEMENT_CHANNELS_MASK,
  PLACEMENT_EVALUATE,
  PLACEMENT_FIRST_PERSON,
  PLACEMENT_HLOD_SHIFT,
  PLACEMENT_HOLDOUT,
  PLACEMENT_NO_CONTACT_SHADOW,
  PLACEMENT_OBJECT_BITS,
  PLACEMENT_PAGE_MARKS,
  PLACEMENT_VELOCITY,
} from '../geometry/dag/info/placementInfoLayout.ts'
import {
  EMISSIVE_AO_SURFACE_FLAG,
  FIRST_PERSON_SURFACE_FLAG,
  FOG_FREE_SURFACE_FLAG,
  HOLDOUT_SURFACE_FLAG,
  NO_CONTACT_SHADOW_SURFACE_FLAG,
} from '../materials/surface/surfaceModel.ts'
import { SURFACE_MODEL_MASK } from '../materials/surface/surfaceModelWord.ts'
import { PIXEL_MODEL_MASK, PIXEL_MODEL_SHIFT } from '../materials/surface/pixelModel.ts'
import { SPECULAR_FLAG_MASK } from '../materials/surface/surfaceSpecular.ts'
import { SUBSURFACE_FLAG } from '../materials/surface/subsurface.ts'
import { PHYSICAL_SURFACE_FLAG } from '../materials/surface/physicalLobes.ts'
import { DISTANCE_FIELD_REPRESENTATION_FLAG } from '../lighting/distanceField/representationWgsl.ts'
import {
  ITEM_CHANNELS_SHIFT,
  ITEM_FLAG_BITS,
  ITEM_HLOD,
  ITEM_HOLDOUT,
  ITEM_RESPONSIVE_SHIFT,
} from '../blend/items.ts'
import {
  TRI_CHANNELS_BITS,
  TRI_CHANNELS_SHIFT,
  TRI_HOLDOUT_SHIFT,
  TRI_LIGHTING_CHANNELS_SHIFT,
  TRI_RESPONSIVE_SHIFT,
} from '../blend/vertexReadsWgsl.ts'
import { RESPONSIVE_BITS } from './types.ts'
import { VIS_TRIANGLE_BITS } from './visWords.ts'

const bits = (count: number, shift: number) => (2 ** count - 1) * 2 ** shift
/** The lighting channels sit right above the contact shadow's bit in the surface flags. */
const LIGHTING_CHANNELS_SURFACE_SHIFT = Math.log2(NO_CONTACT_SHADOW_SURFACE_FLAG) + 1

/** That no two of `fields` (by name, the mask of each) share a bit and each lies in 32 bits. */
function disjoint(carrier: string, fields: Record<string, number>) {
  let taken = 0
  let owner = ''
  for (const [name, mask] of Object.entries(fields)) {
    assert.ok(mask > 0 && mask <= 0xffffffff, `${carrier}: ${name} lies in 32 bits`)
    assert.equal((taken & mask) >>> 0, 0, `${carrier}: ${name} overlaps ${owner}`)
    taken = (taken | mask) >>> 0
    owner += `${owner ? ', ' : ''}${name}`
  }
}

test('a placement’s switches: the object’s bits, then the HLOD index above them', () => {
  disjoint('placement switches', {
    evaluate: PLACEMENT_EVALUATE,
    velocity: PLACEMENT_VELOCITY,
    firstPerson: PLACEMENT_FIRST_PERSON,
    holdout: PLACEMENT_HOLDOUT,
    noContact: PLACEMENT_NO_CONTACT_SHADOW,
    channels: PLACEMENT_CHANNELS_MASK,
    hlod: 0xf * 2 ** PLACEMENT_HLOD_SHIFT,
  })
  assert.equal(PLACEMENT_OBJECT_BITS & (PLACEMENT_EVALUATE | PLACEMENT_VELOCITY), 0)
  assert.equal(
    PLACEMENT_PAGE_MARKS & ~PLACEMENT_OBJECT_BITS,
    0,
    'the page’s marks are the object’s bits',
  )
  assert.equal(
    PLACEMENT_PAGE_MARKS & PLACEMENT_HOLDOUT,
    0,
    'the holdout is a row flag, no page mark',
  )
  assert.ok(PLACEMENT_OBJECT_BITS < 2 ** PLACEMENT_HLOD_SHIFT, 'under the HLOD index')
})

test('the surface flags: the marks of the page sit apart from the model, the specular byte, the pixel model and each other', () => {
  disjoint('surface flags', {
    model: SURFACE_MODEL_MASK,
    emissiveAo: EMISSIVE_AO_SURFACE_FLAG,
    subsurface: SUBSURFACE_FLAG,
    physical: PHYSICAL_SURFACE_FLAG,
    fogFree: FOG_FREE_SURFACE_FLAG,
    distanceField: DISTANCE_FIELD_REPRESENTATION_FLAG,
    specular: SPECULAR_FLAG_MASK,
    noContact: NO_CONTACT_SHADOW_SURFACE_FLAG,
    channels: bits(LIGHTING_CHANNEL_COUNT, LIGHTING_CHANNELS_SURFACE_SHIFT),
    firstPerson: FIRST_PERSON_SURFACE_FLAG,
    pixelModel: PIXEL_MODEL_MASK * 2 ** PIXEL_MODEL_SHIFT,
    holdout: HOLDOUT_SURFACE_FLAG,
  })
})

test('a translucent item’s flags, each above the one below, the HLOD index last', () => {
  disjoint('item flags', {
    row: ITEM_FLAG_BITS,
    responsive: bits(RESPONSIVE_BITS, ITEM_RESPONSIVE_SHIFT),
    holdout: ITEM_HOLDOUT,
    channels: bits(LIGHTING_CHANNEL_COUNT, ITEM_CHANNELS_SHIFT),
    hlod: ITEM_HLOD.mask * 2 ** ITEM_HLOD.shift,
  })
})

test('the triangle word: the rank, the maps’ channels, the lighting channels, the responsiveness, the holdout bit', () => {
  disjoint('triangle word', {
    rank: bits(VIS_TRIANGLE_BITS, 0),
    mapChannels: bits(TRI_CHANNELS_BITS, TRI_CHANNELS_SHIFT),
    lightingChannels: bits(LIGHTING_CHANNEL_COUNT, TRI_LIGHTING_CHANNELS_SHIFT),
    responsive: bits(RESPONSIVE_BITS, TRI_RESPONSIVE_SHIFT),
    holdout: 2 ** TRI_HOLDOUT_SHIFT,
  })
})

test('every carrier decodes its stored bits to the same mask: the one `storedToChannels`, each carrier shifting alone', () => {
  const { storedToChannels } = shaderRun<{ storedToChannels: (stored: number) => number }>(
    wgslModule(LIGHTING_CHANNELS_WGSL),
    ['storedToChannels'],
    {},
  )
  const { channelsOfFlags: ofFlags } = shaderRun<{ channelsOfFlags: (flags: number) => number }>(
    wgslModule(channelsOfFlags),
    ['channelsOfFlags'],
    {},
  )
  const { lightChannelsOf: ofLight } = shaderRun<{ lightChannelsOf: (light: object) => number }>(
    wgslModule(lightChannelsOf),
    ['lightChannelsOf'],
    {},
  )
  for (let mask = 0; mask <= ALL_LIGHTING_CHANNELS_MASK; mask++) {
    const stored = storedLightingChannels(mask)
    assert.equal(storedToChannels(stored), mask, `stored ${stored}`)
    assert.equal(ofFlags(stored * 2 ** LIGHTING_CHANNELS_SURFACE_SHIFT + SURFACE_MODEL_MASK), mask)
    const word = (stored << LIGHT_CHANNELS_SHIFT) + (LIGHT_SHADOWED.dynamic << LIGHT_SHADOWED_SHIFT)
    assert.equal(ofLight({ params: [kindLane(word), 0, 0, 0] }), mask)
  }
})
