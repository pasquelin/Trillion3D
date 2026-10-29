// The sky light's capture marches its sky through the clouds' shade of the image — their shadow on the
// air's lights and the sky occlusion on the first light's multiple scattering —, the stand-in that
// shades nothing where the scene has no clouds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { AIR_BINDING } from '../../../lighting/atmosphere/binding.ts'
import { FRAME_FLOATS } from '../../../lighting/atmosphere/frame.ts'
import { cloudShadowStandIn } from '../../../lighting/atmosphere/cloudShadowStandIn.ts'
import { DEFAULT_AIR_SHAPE } from '../../../lighting/atmosphere/shape.ts'
import { groupsFor, type FaceHolds } from './captureGroups.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { BLOCK_STRIDE } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'

/** The capture's groups over the kit's device, for a sky shaded (or not) by the opaque scene. */
function setUp(shadowFromOpaque: boolean) {
  const kit = fakeDevice()
  const { device } = kit
  const made = createSkyLightPipelines(device, () => {}, DEFAULT_AIR_SHAPE)
  const texture = () =>
    device
      .createTexture({
        size: { width: 4, height: 4 },
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView()
  const buffer = (usage: number) => device.createBuffer({ size: BLOCK_STRIDE * 6, usage })
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const targets = {
    blocks: { face: buffer(UNIFORM), skyFrame: buffer(UNIFORM) },
    skyViewView: device
      .createTexture({
        size: { width: 4, height: 4 },
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      })
      .createView(),
  } as unknown as SkyLightTargets
  const air = {
    buffer: buffer(STORAGE),
    transmittance: texture(),
    multiScatter: texture(),
    sampler: device.createSampler(),
    maps: {
      pageTable: buffer(STORAGE),
      projectionData: buffer(STORAGE),
      uniforms: buffer(UNIFORM),
      pool: buffer(STORAGE),
      view: buffer(UNIFORM),
    },
  }
  const input = (shade?: ReturnType<typeof cloudShadowStandIn>) =>
    ({
      part: { quality: { skyLightShadowFromOpaque: shadowFromOpaque } },
      atmosphere: true,
      fogShown: false,
      air,
      clouds: shade && { cloudShadow: shade },
    }) as unknown as SkyLightInputs
  const holds: FaceHolds = { traceGroups: [] }
  const groups = (shade?: ReturnType<typeof cloudShadowStandIn>) =>
    groupsFor(device, made, holds, targets, input(shade))
  return { kit, holds, groups, texture, targets }
}

const entryAt = (group: GPUBindGroup | undefined, binding: number) =>
  [...(group as unknown as GPUBindGroupDescriptor).entries].find((e) => e.binding === binding)

test('the sky of a face binds the clouds’ shade of the image, the sky occlusion map among it', () => {
  const { kit, holds, groups, texture } = setUp(false)
  const stand = cloudShadowStandIn(kit.device)
  // A scene with no clouds: the stand-in that shades nothing.
  groups()
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.cloudSkyAO)?.resource, stand.ao)
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.cloudShadowMap0)?.resource, stand.maps[0])
  // The maps of the image: the group is made again over them, once.
  const shade = { ...stand, ao: texture(), maps: [texture(), texture()] as const }
  groups(shade)
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.cloudSkyAO)?.resource, shade.ao)
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.cloudShadowMap1)?.resource, shade.maps[1])
  assert.equal(
    entryAt(holds.skyGroup, AIR_BINDING.cloudShadow)?.resource &&
      (entryAt(holds.skyGroup, AIR_BINDING.cloudShadow)!.resource as GPUBufferBinding).buffer,
    shade.block,
  )
  const made = kit.bindGroups.length
  groups(shade)
  assert.equal(kit.bindGroups.length, made, 'the same maps: the same group')
  // A new sky occlusion map alone is a new group.
  groups({ ...shade, ao: texture() })
  assert.ok(kit.bindGroups.length > made)
})

test('the sky shaded by the opaque scene binds the same shade', () => {
  const { kit, holds, groups, texture } = setUp(true)
  const shade = { ...cloudShadowStandIn(kit.device), ao: texture() }
  groups(shade)
  assert.equal(entryAt(holds.shadowedGroup, AIR_BINDING.cloudSkyAO)?.resource, shade.ao)
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.cloudSkyAO)?.resource, shade.ao)
  const made = kit.bindGroups.length
  groups({ ...shade, ao: texture() })
  assert.equal(
    kit.bindGroups.length - made,
    3,
    'the sky table’s group and both sky groups are made again over the new map',
  )
})

test('the sky table is built and read in the capture’s one frame', () => {
  const { holds, groups, targets } = setUp(false)
  groups()
  const frame = { buffer: targets.blocks.skyFrame, size: FRAME_FLOATS * 4 }
  assert.deepEqual(entryAt(holds.skyViewGroup, AIR_BINDING.frame)?.resource, frame)
  assert.deepEqual(entryAt(holds.skyGroup, AIR_BINDING.frame)?.resource, frame)
  // The builder writes the table the faces sample.
  assert.equal(entryAt(holds.skyViewGroup, AIR_BINDING.table)?.resource, targets.skyViewView)
  assert.equal(entryAt(holds.skyGroup, AIR_BINDING.skyView)?.resource, targets.skyViewView)
})
