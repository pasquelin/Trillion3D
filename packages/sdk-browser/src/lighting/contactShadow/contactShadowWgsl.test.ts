// Where the light term holds the contact shadows' code: the programs that do not say `contactless`, and the translucent ones
// where the scene's surfaces ask (`TranslucentScene`); the reads of the scene are the pass's (`contactSceneDepth`,
// `contactSceneFlags`), run here over a stand-in scene. A hit casts unless its object lets the rays through.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { declaredLightWgsl } from '../direct/lightLoopWgsl.ts'
import { declaredLightingSplitWgsl } from '../direct/declaredLightingWgsl.ts'
import { FULL_CONTRACT } from '../deferred/contractCuts.ts'
import { DEFAULT_TRANSLUCENT_SCENE, blendShader, translucentLitKey } from '../../blend/shader.ts'
import { SET_CONTACT_ASKED } from '../../blend/contactSceneWgsl.ts'
import { TRI_MATERIAL_SHIFT } from '../../blend/vertexReadsWgsl.ts'
import { MATERIAL_FLAG } from '../../materials/table/materialLayout.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import { waterWgsl } from '../../blend/water/waterStageWgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { PIXEL_MODEL, PIXEL_MODEL_SHIFT } from '../../materials/surface/pixelModel.ts'
import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { NO_CONTACT_SHADOW_SURFACE_FLAG } from '../../materials/surface/surfaceModel.ts'
import { LIGHT_SHADOWED } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { contactShadowWgsl, type ContactRays } from './contactShadowWgsl.ts'

test('the light term holds the ray unless its key says contactless, and a translucent term only where its scene says so', () => {
  const holds = (code: string) => code.includes('fn contactShadow(')
  assert.ok(holds(wgslModule(declaredLightWgsl(FULL_CONTRACT))))
  assert.ok(!holds(wgslModule(declaredLightWgsl({ ...FULL_CONTRACT, contactless: true }))))
  // No surface of the translucent programs asks: the text is the one without the code, whatever the frame's key says.
  const scene = { rectLights: true, contact: false }
  const none = translucentLitKey({ ...FULL_CONTRACT, contactless: true }, scene)
  assert.ok(!holds(wgslModule(declaredLightingSplitWgsl(none))))
  assert.ok(!blendShader({}).includes('contactAsked'))
  // A surface asks: the scene keeps the code, though the key says contactless.
  const asking = translucentLitKey(
    { ...FULL_CONTRACT, contactless: true },
    { ...scene, contact: true },
  )
  assert.ok(holds(wgslModule(declaredLightingSplitWgsl(asking))))
})

/** A stand-in scene of one pixel: an orthographic view over 100 by 100 pixels, the surface at the centre (pixel 50) at depth 0.5, and
 *  an occluder just behind its point from the pixel `from` on (depth 0.53, within a ray's margin), `flat` meaning a scene of one depth
 *  (0.53) everywhere. A light along +x with the contact record `record` (its length, the intensities of the shadow at a surface
 *  that casts and at one that does not); `flags`, the flags of the surface a ray hits. */
function shadowOf(
  rays: ContactRays | { code: string },
  {
    bits,
    record,
    from = 56,
    flat = false,
    pixelModel = 0,
    asked = false,
    flags = 0,
    attenuation = 1,
  }: {
    bits: number
    record: number[]
    from?: number
    flat?: boolean
    pixelModel?: number
    asked?: boolean
    flags?: number
    attenuation?: number
  },
) {
  const scope = {
    view: {
      viewProjection: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      viewport: [100, 100, 0, 0],
      jitter: [0, 0, 0, 0],
      contact: [0, 0, -1, 1],
      camera: [0, 0, 0, 0],
    },
    pixelModel,
    contactSceneDepth: (pixel: number[]) => (flat || pixel[0]! >= from ? 0.53 : 0.5),
    contactSceneFlags: () => flags,
    contactAsked: asked,
    contactAttenuation: (occlusion: number) => occlusion * attenuation,
    contactPoint: [0, 0, 0],
    contactStart: [0, 0, 0, 0],
    contactOrigin: [0, 0, 0],
    contactOwn: [0, 0],
    contactDepth: 0,
    contactDither: 0,
    contactScale: 0,
    contactAskedTolerance: 0,
  }
  const { contactShadow } = shaderRun<{
    contactShadow: (light: object, P: number[], L: number[], bits: number) => number
  }>(
    typeof rays === 'string' ? wgslModule(contactShadowWgsl(rays)) : rays.code,
    ['contactShadow'],
    scope,
  )
  return contactShadow({ contactGi: [...record, 1] }, [0, 0, 0.5], [1, 0, 0], bits)
}

const { none, static: staticBits, dynamic } = LIGHT_SHADOWED
// A ray of `length`; the shadow takes 0.7 of the light at a surface that casts, 0.2 at one that does not.
const RAY = (length: number) => [length, 0.7, 0.2]
const CASTS = 1 - 0.7
const OTHER = 1 - 0.2

test('a light casts its own ray only with the dynamic bit, and a ray of length 0 casts none', () => {
  assert.equal(
    shadowOf('models', { bits: dynamic, record: RAY(0.4) }),
    CASTS,
    'a long ray reaches the occluder',
  )
  assert.equal(shadowOf('models', { bits: dynamic, record: RAY(0.02) }), 1, 'a short one does not')
  assert.equal(shadowOf('models', { bits: dynamic, record: RAY(0) }), 1, 'a length of 0 is no ray')
  for (const bits of [none, staticBits])
    assert.equal(
      shadowOf('models', { bits, record: RAY(0.4) }),
      1,
      `bits ${bits}: no ray of the light's own`,
    )
  assert.equal(shadowOf('lights', { bits: staticBits, record: RAY(0.4) }), 1)
})

test('a hit surface that does not cast takes the other intensity', () => {
  const long = { bits: dynamic, record: RAY(0.4) }
  assert.equal(shadowOf('models', { ...long, flags: NO_CONTACT_SHADOW_SURFACE_FLAG }), OTHER)
})

test('a hair casts its short ray under a light without the dynamic bit alone, and passes what shares its depth under a light with no bit', () => {
  const { hair } = PIXEL_MODEL
  const strands = { pixelModel: hair, record: RAY(0) }
  assert.equal(shadowOf('models', { ...strands, bits: staticBits }), CASTS)
  assert.equal(shadowOf('models', { ...strands, bits: none }), CASTS)
  assert.equal(
    shadowOf('models', { ...strands, bits: dynamic }),
    1,
    'a light with a dynamic shadow casts its own ray, which is none here',
  )
  // A scene of one depth: only a hair under a light with no bit at all hits what shares its depth.
  assert.equal(shadowOf('models', { ...strands, bits: none, flat: true }), CASTS)
  assert.equal(shadowOf('models', { ...strands, bits: staticBits, flat: true }), 1)
  assert.equal(
    shadowOf('lights', { ...strands, bits: none }),
    1,
    'a program without the models casts no hair ray',
  )
})

test('a program that casts the asked ray alone casts it whatever the light’s own length, and none where nothing asks', () => {
  // The occluder is far: the light's own long ray reaches it, the short ray of the ask does not.
  const far = { from: 75, bits: dynamic, record: RAY(0.8) }
  assert.equal(shadowOf('lights', far), CASTS)
  assert.equal(shadowOf('asked', { ...far, asked: true }), 1, 'the ask overrides the length')
  assert.equal(shadowOf('asked', far), 1, 'no ask, no ray: not the light’s own either')
  // Near, the ask casts the short ray under a light that casts none of its own, even with a length of 0.
  const near = { bits: none, record: RAY(0) }
  assert.equal(shadowOf('lights', near), 1)
  assert.equal(shadowOf('asked', near), 1)
  assert.equal(shadowOf('asked', { ...near, asked: true }), CASTS)
  // The ray of a hair pixel that passes what shares its depth under a light with no bit is the asked ray's too.
  const strands = { ...near, asked: true, pixelModel: PIXEL_MODEL.hair, flat: true }
  assert.equal(shadowOf('asked', strands), CASTS)
  assert.equal(shadowOf('asked', { ...strands, bits: staticBits }), 1)
})

test('the attenuation weighs a hit’s occlusion in the programs that hold it: the models’, and the asked ray’s for a thin sheet', () => {
  const long = { bits: dynamic, record: RAY(0.4), attenuation: 0.5 }
  assert.equal(shadowOf('models', long), 1 - 0.7 * 0.5)
  assert.equal(shadowOf('lights', long), CASTS)
  assert.equal(shadowOf('asked', { ...long, asked: true }), 1 - 0.7 * 0.5)
})

test('the asked ray’s hit keeps the share a thin sheet’s opacity lets through, and a surface that is no sheet keeps all of it', () => {
  const attenuation = (thin: number[]) =>
    shaderRun<{ contactAttenuation: (occlusion: number, distance: number) => number }>(
      blendShader({}, { scene: { ...DEFAULT_TRANSLUCENT_SCENE, contact: true } }),
      ['contactAttenuation'],
      // The opacity is the model word's of the material the fragment's ask names (`contactMaterial`), read at the hit alone.
      {
        thinSubsurface: thin,
        contactMaterial: 7,
        contactOpacity: (m: number) => (m === 7 ? 0.5 : 1),
      },
    ).contactAttenuation
  const sheet = attenuation([1, 0.5, 0.2]),
    solid = attenuation([0, 0, 0])
  assert.equal(solid(0.7, 0.05), 0.7, 'no thin sheet: the occlusion stands')
  assert.equal(sheet(0, 0.05), 0, 'nothing to attenuate')
  const near = sheet(0.7, 0.002),
    far = sheet(0.7, 0.05)
  assert.ok(
    near > 0 && near < far && far < 0.7,
    `a thicker path keeps more of the shadow: ${near}, ${far}`,
  )
})

test('a hit casts a contact shadow unless its object lets the rays through or it is of the eye model', () => {
  // The share of the light a ray that hits a surface of flags `flags` takes: the cast one's, else the other's.
  const takes = (flags: number) =>
    shadowOf('models', { bits: dynamic, record: RAY(0.4), flags: flags >>> 0 })
  const lit: number = MODEL_FLAG.physical
  const wearing = (model: number) => (model << PIXEL_MODEL_SHIFT) | lit
  assert.equal(takes(0), CASTS, 'the sky, a default object: no mark')
  assert.equal(takes(lit), CASTS, 'a lit physical surface')
  assert.equal(
    takes(NO_CONTACT_SHADOW_SURFACE_FLAG | lit),
    OTHER,
    'its object lets the rays through',
  )
  assert.equal(takes(wearing(PIXEL_MODEL.eye)), OTHER, 'an eye never casts')
  assert.equal(takes(wearing(PIXEL_MODEL.hair)), CASTS, 'a hair does')
  assert.equal(takes(wearing(PIXEL_MODEL.eye) | NO_CONTACT_SHADOW_SURFACE_FLAG), OTHER)
})

test('the blend module holds the contact shadows only where a surface of the scene asks, and its fragments read the ask from the material flags of the triangle word', () => {
  const plain = blendShader({})
  for (const left of ['fn contactShadow(', 'contactAsked', 'contactFlags', 'contactSceneDepth'])
    assert.ok(!plain.includes(left), `without a surface that asks: ${left}`)
  const asking = blendShader({}, { scene: { ...DEFAULT_TRANSLUCENT_SCENE, contact: true } })
  assert.ok(asking.includes(SET_CONTACT_ASKED), 'the fragment sets it before it lights')
  // The translucent programs cast only where the material asks: the module’s ray is the asked ray alone.
  const stand = { bits: dynamic, record: RAY(0.4) }
  assert.equal(shadowOf({ code: asking }, stand), 1, 'a light’s own ray is none there')
  assert.equal(shadowOf({ code: asking }, { ...stand, asked: true }), CASTS)
  assert.equal(
    shadowOf({ code: asking }, { ...stand, asked: true, attenuation: 0.5 }),
    1 - 0.7 * 0.5,
    'a thin sheet keeps its share of the hit',
  )
  // The flags are those the vertex stage put in the triangle word (`words.x`, above `TRI_MATERIAL_SHIFT`), from the item's material record.
  const triangles = [MATERIAL_FLAG.contactShadows, MATERIAL_FLAG.fogPerPixel, 0].map(
    (flag) => flag << TRI_MATERIAL_SHIFT,
  )
  const { contactShadowsAsked } = shaderRun<{ contactShadowsAsked: (input: object) => boolean }>(
    asking,
    ['contactShadowsAsked'],
    {},
  )
  const fragment = (rank: number) => ({ words: [triangles[rank], 0, 0] })
  assert.equal(contactShadowsAsked(fragment(0)), true)
  assert.equal(contactShadowsAsked(fragment(1)), false, 'another flag of the record')
  assert.equal(contactShadowsAsked(fragment(2)), false)
})

test('the transmissive stages set the ask before they light, the single-layer water never does', () => {
  const scene = (contact: boolean) => ({ ...DEFAULT_TRANSLUCENT_SCENE, contact })
  const stage = (contact: boolean) =>
    wgslModule(transmitWgsl({}, false, undefined, undefined, false, scene(contact)))
  assert.ok(stage(true).includes(SET_CONTACT_ASKED))
  assert.ok(!stage(false).includes(SET_CONTACT_ASKED))
  // The water asks nothing: in a scene of no contact shadows its lights hold no march.
  const water = wgslModule(waterWgsl({}, undefined, undefined, false, false, scene(false)))
  assert.ok(!water.includes('fn contactShadow('))
  assert.ok(!water.includes('contactAsked='))
  // In a scene of contact shadows its light block is the transmissive stage’s (one text of the split term’s functions in a
  // module that holds both), whose asked ray never marches for the water: it sets no ask.
  const beside = wgslModule(waterWgsl({}, undefined, undefined, false, false, scene(true)))
  assert.ok(beside.includes('fn contactShadow('))
  assert.ok(!beside.includes('contactAsked='))
})

test('a light finds its layer of the screen-space march by its rank', () => {
  const bend = { array: 77, ranks: 78 }
  const code = wgslModule(declaredLightWgsl(FULL_CONTRACT, { bend }))
  assert.ok(code.includes('@group(0) @binding(77) var contactBend'))
  assert.ok(code.includes('@group(0) @binding(78) var<uniform> contactBendRanks'))
  assert.ok(code.includes('contactBendSet(rank);'))
  assert.ok(code.includes('return contactBendRead(contactOwn);'))
  // Without the bindings the light casts its own ray, whatever the pass.
  const without = wgslModule(declaredLightWgsl(FULL_CONTRACT))
  assert.ok(!without.includes('contactBendSet'))
})
