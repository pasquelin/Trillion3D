// The marking pixel pass: the translucent front layer, the unlit pixels, the water and the previous image front.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VSM_FRONT_DEPTH_BINDING,
  VSM_WATER_DEPTH_BINDING,
  vsmPixelPageMarkingWgsl,
} from './markingWgsl.ts'
import { frontStamp } from '../../reflections/frontLayer.ts'
import { markingFrontLayer, newFrontSeen, newMarkingFront } from './frame/vsmFrontLayer.ts'
import { beginCamera } from '../../../frame/backend/state/previousCamera.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { vsmLayout } from './layout.ts'
import { AS_IS_FLAG, UNLIT_FLAG } from '../../../materials/surface/surfaceModelWord.ts'

test('the pixel pass marks the translucent front layer in a program of its own, before an unlit pixel leaves', () => {
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
  const plain = vsmPixelPageMarkingWgsl(layout),
    front = vsmPixelPageMarkingWgsl(layout, true)
  for (const name of ['frontDepth', 'vsmMarkTranslucent', 'clipToFramebuffer'])
    assert.ok(!plain.includes(name), `the plain program has no ${name}`)
  assert.ok(
    front.includes(
      `@group(1) @binding(${VSM_FRONT_DEPTH_BINDING}) var frontDepth:texture_2d_array<f32>;`,
    ),
  )
  const kernel = front.slice(front.indexOf('fn vsmMarkPagesFromPixels'))
  const marks = kernel.indexOf('vsmMarkTranslucent(svPosition,shiftedPosition,marginSide);')
  assert.ok(marks > 0 && kernel.indexOf('if(!lit){return;}') > marks, 'the surface first')
  assert.ok(kernel.indexOf('textureLoad(normalRough') < kernel.indexOf('if(!lit){return;}'))
  // Every sun's clipmap, the pixel's page dilation, no bias, a point behind the old camera or out of its layer skipped.
  const suns = front.slice(
    front.indexOf('fn vsmMarkSunsAt'),
    front.indexOf('fn vsmMarkTranslucent'),
  )
  assert.ok(
    suns.includes(
      'vsmMarkPageDirectional(vsmHandleFromId(vsmDirectionalLightIds[index]),position,hasMargin,marginOffset,0.0,-10000);',
    ),
  )
  const mark = front.slice(front.indexOf('fn vsmMarkTranslucent'), front.indexOf('@compute'))
  assert.ok(mark.includes('vsmMarkSunsAt('))
  assert.ok(mark.includes('if(!(previous.w>0.0)){return;}'))
  assert.ok(mark.includes('if(!(frontZ>0.0)){return;}'))
})

test('an unlit or as-is pixel marks no page, as the deferred format leaves unlit pixels out', () => {
  // The reference's deferred format: `bIsValid = ShadingModelID != SHADINGMODELID_UNLIT`, the sky dome among them.
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
  const plain = vsmPixelPageMarkingWgsl(layout)
  const kernel = plain.slice(plain.indexOf('fn vsmMarkPagesFromPixels'))
  const skip = `if(surfaceModel<=1u||surfaceModel==${AS_IS_FLAG}u){return;}`
  assert.ok(UNLIT_FLAG <= 1, 'the unlit model is under the skip')
  assert.ok(kernel.includes(skip))
  assert.ok(
    kernel.indexOf('textureLoad(normalRough') < kernel.indexOf(skip),
    'after the depth and the normal are read',
  )
  // The programs with a front layer or water mark those surfaces first, then leave the same pixels.
  const both = vsmPixelPageMarkingWgsl(layout, true, true)
  assert.ok(both.includes(`let lit=surfaceModel>1u&&surfaceModel!=${AS_IS_FLAG}u;`))
})

test("the front layer is read at the pixel's texel where it is the image's own, reprojected where it is the image before's", () => {
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
  const front = vsmPixelPageMarkingWgsl(layout, true)
  const mark = front.slice(front.indexOf('fn vsmMarkTranslucent'), front.indexOf('@compute'))
  // The pixel's texel first; the reprojection and its bounds only while the flag is 0.
  const texel = mark.indexOf('var texel=vec2i(svPosition);')
  const history = mark.indexOf('if(vsmMarking.frontSameImage==0u){')
  const read = mark.indexOf('textureLoad(frontDepth,texel,')
  assert.ok(texel >= 0 && history > texel && read > history, 'the flag selects the history')
  const reprojected = mark.slice(history, read)
  assert.ok(reprojected.includes('vsmMarking.previousViewProjection'))
  assert.ok(reprojected.includes('texel=vec2i(there);'))
  assert.ok(front.includes(' frontSameImage:u32,'), 'the flag is a word of the marking parameters')
})

test("the pixel pass marks the water's surface in a program of its own, the suns alone, before an unlit pixel leaves", () => {
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
  const plain = vsmPixelPageMarkingWgsl(layout),
    water = vsmPixelPageMarkingWgsl(layout, false, true),
    both = vsmPixelPageMarkingWgsl(layout, true, true)
  for (const name of ['waterDepth', 'vsmMarkWater', 'vsmMarkSunsAt'])
    assert.ok(!plain.includes(name), `the plain program has no ${name}`)
  assert.ok(!water.includes('frontDepth'), 'the water program reads no front layer')
  assert.ok(
    water.includes(
      `@group(1) @binding(${VSM_WATER_DEPTH_BINDING}) var waterDepth:texture_depth_2d;`,
    ),
  )
  assert.notEqual(VSM_WATER_DEPTH_BINDING, VSM_FRONT_DEPTH_BINDING)
  // The depth the water drew against the scene's: the water's position where they differ, marked in every sun's clipmap.
  const mark = water.slice(water.indexOf('fn vsmMarkWater'), water.indexOf('@compute'))
  assert.ok(mark.includes('let waterZ=textureLoad(waterDepth,coord,0);'))
  assert.ok(mark.includes('if(waterZ==deviceZ){return;}'))
  assert.ok(mark.includes('vsmMarkSunsAt((worldAt(svPosition,waterZ)'))
  assert.ok(
    !mark.includes('vsmMarkPageLocal'),
    'the suns alone: no local light is marked for the water',
  )
  // Before an unlit pixel leaves, after the front layer's marks: whether or not the pixel is lit.
  const kernel = both.slice(both.indexOf('fn vsmMarkPagesFromPixels'))
  const marks = kernel.indexOf('vsmMarkWater(coord,svPosition,deviceZ,marginSide);')
  assert.ok(marks > kernel.indexOf('let deviceZ='), 'the pixel depth is read first')
  assert.ok(kernel.indexOf('vsmMarkTranslucent(') < marks, 'the front layer first')
  assert.ok(kernel.indexOf('if(!lit){return;}') > marks, 'the surfaces first')
  assert.ok(kernel.indexOf('textureLoad(normalRough') < kernel.indexOf('if(!lit){return;}'))
})

test('the marking reads the front layer of the image drawn just before it, and only that', () => {
  const view = {} as GPUTextureView
  const rt = {
    gpu: { targetSize: [64, 32], reflection: { front: { drawn: 0 } } },
    views: { active: {} },
    vis: { gpuHiz: { depth: () => ({ resources: [view] }) } },
    run: { frame: 0 },
    setup: { translucentShadow: { quality: 1 } },
  } as unknown as WebgpuPagesRuntime
  const seen = newFrontSeen(),
    held = newMarkingFront()
  const camera = (x: number) =>
    ({
      viewProjection: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]),
      eye: Float64Array.from([10, 0, 0]),
    }) as unknown as EngineCamera
  /** One image drawn: its camera begun, the marking run for it unless `skipped`. */
  const image = (frame: number, x: number, skipped = false) => {
    ;(rt.run as { frame: number }).frame = frame
    const cam = camera(x)
    beginCamera(rt, cam)
    return skipped ? undefined : markingFrontLayer(rt, cam, seen, held)
  }
  const frontPass = (frame: number) =>
    void ((rt.gpu.reflection!.front as { drawn: number }).drawn = frontStamp(frame))
  // The first image has no image before it; its front pass draws.
  assert.equal(image(5, 1), undefined)
  frontPass(5)
  // The next one reads that layer, with the camera of the image that drew it, at that eye.
  assert.equal(image(6, 2), held)
  assert.equal(held.depth, view)
  assert.deepEqual([...held.size], [64, 32])
  assert.equal(held.previousViewProjection[12], 10 + 1)
  // An image that drew no front pass leaves the layer stale: the next reads nothing.
  assert.equal(image(7, 3), undefined)
  // An image drawn between, with no marking, breaks the chain.
  frontPass(7)
  image(8, 4, true)
  assert.equal(image(9, 5), undefined)
  // A front pass drawn before the marking of its own image is read as it stands, at the pixel.
  frontPass(10)
  assert.equal(image(10, 6), held)
  assert.equal(held.sameImage, true)
  assert.equal(held.depth, view)
  // So is the first image's, which has no image before it.
  const first = newFrontSeen()
  ;(rt.run as { frame: number }).frame = 11
  frontPass(11)
  assert.equal(markingFrontLayer(rt, camera(7), first, held), held)
  assert.equal(held.sameImage, true)
  // The pass drawn at 11 is not that of image 10, the marking's last: the image after reads none.
  assert.equal(image(12, 8), undefined)
  // The image after one whose pass comes after its marking reads that layer, reprojected.
  frontPass(12)
  assert.equal(image(13, 9), held)
  assert.equal(held.sameImage, false)
  // The project switch at 0 reads none.
  frontPass(13)
  ;(rt.setup as { translucentShadow: { quality: number } }).translucentShadow.quality = 0
  assert.equal(image(14, 10), undefined)
})
