// The radiance pyramid lies in the mips of the HDR target it filters (`hdrTargetDescriptor`): the
// build reads each level of the frame's target and writes the two after it in that very texture,
// and the reflection group binds the pyramid as one texture, no level texture beside it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakePyramid, recordedBuild } from './radianceKernels.fixture.ts'
import { reflectionBindingsWgsl } from './viewLayout.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

test("the build reads and writes the levels of the frame's HDR target, mip by mip", () => {
  const views: { texture: string; level: number }[] = []
  const hdr = {
    mipLevelCount: 5,
    createView: ({ baseMipLevel }: GPUTextureViewDescriptor) => {
      const view = { texture: 'frame', level: baseMipLevel ?? 0 }
      views.push(view)
      return view
    },
  }
  const { groups } = recordedBuild(fakePyramid(5, 64, 64), hdr)([64, 64])
  const levelsOf = (entries: GPUBindGroupEntry[]) =>
    entries.slice(0, 3).map(({ resource }) => (resource as unknown as { level: number }).level)
  // The first dispatch: level 0, the lit image, read; levels 1 and 2 written. Then 2 → 3, 4.
  assert.deepEqual(levelsOf(groups[0]), [0, 1, 2])
  assert.deepEqual(levelsOf(groups[1]), [2, 3, 4])
  assert.ok(views.every(({ texture }) => texture === 'frame'))
})

test('the reflection group declares the pyramid as one texture', () => {
  const code = wgslModule(reflectionBindingsWgsl(1))
  assert.match(code, /var reflectionImage:texture_2d<f32>;/)
})
