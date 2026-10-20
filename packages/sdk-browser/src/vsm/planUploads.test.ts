// What the shadow maps' CPU plan and its passes leave in the GPU's buffers, over three frames of
// random suns, spots and point lights that move under a moving eye (`planFrames.fixture.ts`): the
// same bytes, frame by frame, as the plan built before its scratch was kept (S20). The digests were
// taken on that plan; a change of what the GPU reads changes them. Retaken when the uniform block,
// then the projection record, lost the fields no shader read, when the record's flags took the bits
// in a row, and when the invalidation lost its primitive words (an instance's word 15 a pad, 0),
// and when the invalidation's payload became the map id alone (it was the id shifted above eight
// flag bits) and the next-data flags lost the id-valid bit no shader read (an old frame's digest,
// those words read back as they are now, is the digest below), and when the vertex-displacement
// fields no host set left the record (its dither scale and mip level a word lower, two pad words
// after), the uniform block (word 14 a pad, 0) and the instance flags (the cached-as-dynamic bit
// from 6 to 1): every other buffer, every word a shader reads, every flag, kept.
// Retaken when the world-to-light rotation was built from the direction's axes rather than angles
// in degrees (an image change, class 2): the suns' and spots' matrices and the suns' level centres
// move by under 1e-7 of their scale, nearer the exact rotation; no page, offset or other buffer
// moves. Retaken when a spot's outer cone was clamped in radians rather than through degrees and an
// f32 pi (class 2): ten spot records' matrices move by under 1.4e-7 of their scale.
// Retaken when a record's level and level count took a word each (they shared one, the level offset
// by a constant): a sun's level and count read as before, a local light's count too, its level 0
// where no shader reads it; every other word kept.
// Retaken when the record's fields took another order, the words a light keeps first: each record's
// words the same, permuted field by field; every other buffer kept.
// Retaken when the pool's buffers took their names here (the digest hashes each label): the same
// bytes in every buffer.
// Retaken when the uniform block took its words by role, 208 bytes for 224: the same words
// permuted, its pads gone; every other buffer kept.
// Retaken when the next-map table was compared on the records its ids dropped or took alone: a
// record dropped past the frame's count is zeroed that frame, where it was left until the count
// reached it again — seed 1's third frame, records 8234 to 8238 of a count of 8234, words no shader
// reads (`prevHandle.id < nextMapCount`); every word read, and every other buffer, kept.
// Retaken when the invalidation read its rows' width off `num_workgroups` (`flatIndex`): its
// params' third word, the width it carried, a pad, 0 — seed 2's third frame; every other word kept.
// Retaken when the per-page thread-per-id bin read its rows' width off `num_workgroups` too: its
// params' third word, the row pitch it carried, a pad, 0; every other word and buffer kept.
// Retaken when the uniform block took 192 bytes for 208, the blended surfaces' one read leaving no
// word for a read setting or the view's half-field tangent: the pressure bias in word 3, the words
// past its old place closed up, their pads gone; every other buffer kept.
// Retaken when the trace tunables left the uniform block for constants of the shader (144 bytes for
// 192): the mip offsets moved up twelve words; every other buffer kept.
// Retaken when the CPU's boxes joined the rows' shadow changes in one stale (`castInvalidation.ts`):
// only each seed's third frame moves, the first that invalidates (the cache accepts from it). The
// box pass's buffers (`vsm.invalidation.params0`, `.instances`, `.items`) are no longer written;
// the stale's are, in their place: `vsm.invalidateCastPages.params` (the maps' count, the boxes'),
// `.maps` (each map's word, `vsmCastMaps`) and `.boxes` (a box's centre rounded to an f32 and its
// moving sign, then its half extent per axis, each axis's rounding added, rounded up, and a pad
// word, 0). The raster's lists grow by the engine's one rule (`sizedBuffer`: the size asked, then
// twice the held one), where they took a power of two of 256 bytes at least: the parameters' and
// the views' buffers hashed at their own size, every word written the same; the chunks'
// parameters leave their unread pad word at 0 (it was written 1). Every other buffer kept.
// Retaken when the maps became one kind, each its page-table blocks by its finest mip, and the
// raster's views were listed on the GPU: every map's id from 0, none past 8192 for a single-page
// map — the per-page ids, the next-map table, the marking's bins and the cast stale's maps naming
// them so —; each record at its new id, its kind in the lights' one numbering (`LIGHT_KIND`, a sun
// 2 where it was 0) and its table's origin in its last word (`tableOrigin`), its other words kept;
// the uniform block one map count (no single-page count) and none of the page-table row words no
// shader read, the cover size at word 12, two pad words before the mip offsets; `vsm.render.views`
// no longer written by the CPU (`renderViewsWgsl.ts`), the render parameters carrying its bound.
import { mulberry32 } from '../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { planFrames, randomWorld } from './planFrames.fixture.ts'

const DIGESTS: Record<number, string[]> = {
  1: [
    '3f8e6326efce79e9aec068fb2003abf164249c181a560f70f79cb5c52c403cad',
    '292e35ab022be2de2ebcb48913e115429a837ff380a4fd69a1a1d32bb56c6740',
    '256a3224d671b8a4b157424ab16a2b2905c39289ca9740b1ff2451bdeee44056',
  ],
  2: [
    'fbed468038d7cfeb71c59edfee8fb420715004886a6c597e83ee292b6b2e879d',
    '54122da0c7c4cbbfed02d3d21d9059b46ffb7f147c01cef7a7f7c084d03d7cd7',
    '8ee3dd4d5b922aec186ea1853a10408636c54e52f7aa13339407cdf213ff11bf',
  ],
}

for (const seed of [1, 2])
  test(`seed ${seed}: three frames leave the same bytes in every buffer they write`, () => {
    const random = mulberry32(seed)
    const run = planFrames()
    const eye: [number, number, number] = [0, 2, 0]
    const digests: string[] = []
    let world = randomWorld(random, eye)
    for (let f = 0; f < 3; f++) {
      // Each frame the eye walks and some lights keep their last pose: cached and invalidated maps.
      const next = randomWorld(random, [eye[0] + f * 3, eye[1], eye[2] - f * 2])
      world = {
        ...next,
        lights: next.lights.map((light, k) => (random() < 0.4 ? world.lights[k] : light)),
      }
      run.frame(world)
      digests.push(run.digest())
    }
    assert.deepEqual(digests, DIGESTS[seed])
  })
