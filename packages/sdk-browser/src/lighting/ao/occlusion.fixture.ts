// A runtime of the lit view the occlusion draws in — the screen probes' reduced runtime (`../deferred/screenProbesRuntime.fixture.ts`), a camera, and
// the readings of what the occlusion left: the lighting's mode and share, the programs drawn — for the occlusion's tests.
import { VIEW_LAYOUT } from '../deferred/worldAtWgsl.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { probesRuntime } from '../deferred/screenProbesRuntime.fixture.ts'
import { beginCamera } from '../../frame/backend/state/previousCamera.ts'
import { encodeAmbientOcclusion } from './frame.ts'

/** The frames of a view with no global illumination on (the bounce off) unless `bounce` says so, drawn until the occlusion's
 *  programs have compiled. */
export async function occlusionRuntime(options: Record<string, unknown> = {}, bounce = false) {
  const made = await probesRuntime(options)
  made.rt.bounce.wanted = bounce
  const projection = new Float64Array(16),
    world = new Float64Array(16),
    viewProjection = new Float64Array(16)
  projection[0] = projection[5] = 1.7
  world[0] = world[5] = world[10] = world[15] = 1
  viewProjection.set(world)
  const camera = {
    projection,
    world,
    viewProjection,
    eye: [0, 0, 0],
    near: 0.1,
    far: 1000,
  } as unknown as EngineCamera
  Object.assign(camera, { perspective: 1 })
  /** One image: its number advanced and its camera begun as the frame begins them, then the occlusion encoded until its programs
   *  have compiled and it draws. */
  const encode = async () => {
    made.rt.run.frame++
    beginCamera(made.rt, camera)
    for (let waited = 0; waited < 100; waited++) {
      const before = made.h.draws.length
      encodeAmbientOcclusion(made.rt, made.h.encoder, camera)
      if (made.h.draws.length > before) return made.h
      await new Promise((done) => setImmediate(done))
    }
    throw new Error('the occlusion never drew')
  }
  /** The mode and the share the lighting was last told: the two words of the view uniform's `views`. */
  const applied = () => {
    const last = made.h.writes.filter((w) => w.offset === (VIEW_LAYOUT.at.views + 1) * 4).at(-1)
    return last ? [...new Float32Array(last.data as ArrayLike<number>)] : []
  }
  const labels = () => made.h.draws.map((d) => String(d.pipeline.label).split(' ').at(-1))
  return { ...made, camera, encode, applied, labels }
}
