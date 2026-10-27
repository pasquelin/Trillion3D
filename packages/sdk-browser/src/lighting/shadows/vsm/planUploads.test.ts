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
// Retaken when the CPU's boxes joined the rows' shadow changes in one stale (`invalidation/castInvalidation.ts`):
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
// no longer written by the CPU (`render/renderViewsWgsl.ts`), the render parameters carrying its bound.
// Retaken when the raster's tiers became three families of four (one-sided, two-sided, voxel rows;
// `VSM_RENDER_TIERS`, `render/renderParamsWgsl.ts`) and its software bin two, a layer each
// (`VSM_RENDER_BINS`): a view pass's counters hold two words a bin (37 words) and its indirect
// arguments four a tier and three a software dispatch (63 words): GPU-written buffers, none hashed
// here; no hashed buffer moved.
// Retaken when a sun's far-shadow distance took a word of its own at the end of the projection record
// (`farShadowEdge`, 304 bytes a map for 288; 0 where a light names none, as every map here): the
// projection buffers are hashed at their new size, each record's other words kept; the render
// parameters' new far drop (`farDrop`) is 0 here, and the draw-distance scale they took beside it
// (`viewDistanceScale`) is 1 where a frame holds no distance: that one word moves the chunk
// parameters; every other buffer kept.
// Retaken when the raster's cull took the lights as groups (`render/renderViewsWgsl.ts`,
// `render/renderCullWgsl.ts`): the render parameters' new `lightCount` (the frame's lights, in the
// word the struct left a pad) moves the chunk parameters, and the table of the lights
// (`vsm.render.lights`: a map's first id and its count a light, `vsmWriteLights`) is a buffer the
// CPU now writes; with that word held at 0 and that table unwritten the digests are the ones
// before, every other buffer kept.
// Retaken when the shadow maps' settings reached the plan (`mapSettings.ts`, `shadowMapOptions.ts`):
// a local light just made reads its moving resolution bias (1, the reference's fourth row, over
// 0 at rest: its records' bias word, hence the finest mip and the page-table blocks it takes) and
// its maps' flags the coarse page of the last mip (marked in mode 1) without the keeps-dynamic bit
// (mode 2 only); the view uniform took one word of rays and steps, not written in this plan.
// A sun's records, its levels, depth range and coarse flags are the defaults': kept.
// Retaken when a clipmap level's offset threshold took the clipmap's whole resolution bias, its
// screen term and mobility included (`wpoThreshold`, byte 292 of a sun's records): only the sun's
// records moved.
// Retaken when the shadow-caster radius cull left (the render parameters lost `radiusThresholdSq`, the
// words after it moved up one): only `vsm.render.params` moved.
// Retaken when the distant lights came (`shadowDistantLightMode`, 1 by default): seed 1's second and
// third frames hold a local light whose map fits one page, its last mip alone and always marked,
// drawn once and kept; with the mode off (0) the three frames read as before, bit for bit — 75eb8b6b,
// d9baa1af, 76220f82 — and so do the three of seed 2, which holds no such light.
// Retaken when a spot's map took the outer cone the lighting lights it by (`spotConesOf`), one cone
// chain for both, without the extra rounding of the angle to an f32 the map alone had: the spot
// records' matrices move by the f32 rounding of that angle in both seeds; no page, offset or other
// buffer moves.
// Retaken when the projection record gained the threshold of the world position offset
// (`wpoThreshold`, a float at byte 292: the square of the distance past which a clipmap level shows no
// motion, zero for a local light's map): the sun's levels write it in both seeds, and in them alone.
// Retaken when the plan stopped making and writing the buffers of the pool's tile depths and of the
// translucent casters' coloured shadow memory, and the uniform block lost the pool's page grid: 128
// bytes for 144, the words from the page table's size on closed up by two; every other word and
// buffer kept.
// Retaken when the raster's chunks gave way to one cull and one raster a view pass, each map's view
// selecting its own level of detail: the render parameters (`vsm.render.params`) lost the chunk
// words and the main view's focal, near, projection kind and first two rotation rows, and took the
// records' capacity; every other buffer written, hashed alone, is the same bit for bit in both seeds
// and all three frames as before the change.
// Retaken when the shadow maps took their occlusion culling: the projection records grew from 304 to
// 400 bytes, the view the occlusion pyramid last held each map by appended (its previous id and table
// origin in the former pad at 296, its clip matrix, depth terms and finest mip after), and the set
// writes its pyramid build's cleared arguments once (`vsm.pyramidArgsInit`). With the record held at
// 304 bytes, those words unwritten and the set made without the occlusion, the digests are the ones
// before, bit for bit, in both seeds and all three frames: no other buffer moved.
// Retaken when the shadow views took the camera's descent of the hierarchy (`traversal/`): the
// render parameters lost the packed pages the casters ran a thread each over (`rowCount`) and took
// the word the descent's listed pages start at (`listedBase`) in the placements' word, and the
// descent's uniform block and indirect arguments (`vsm.descent.*`) are buffers the CPU now writes.
// With those buffers left out of the digest and the two words written as before (5000 pages, one
// placement), the digests are the ones before, bit for bit, in both seeds and all three frames.
// Retaken when the descent's views became a map and a mip of it, as the packed views of the
// reference are: the render parameters took the views the descent lists at most (`viewCap`), the
// word that moves `vsm.render.params`.
// Retaken when the shadow maps' tunables became view settings: the uniform block grew from 128 to 224
// bytes (words 32 to 55: the trace's biases, ray lengths and counts, the page keeping, the slope and
// plane caps, the dither and the one-pass light count, each the former constant or the reference's
// default), the marking parameters from 128 to 240 bytes (page dilation, strides, back-face cull and
// the first-person bias), a cast box took 16 words (its half-axes as a matrix and a view mask), the
// render parameters a slot for each view pass, and the dynamic coarse pages' pixel threshold took the
// reference's clustered-geometry default, 4 for 16 (word 13).
// Retaken when a next-map record took the id-valid bit again (`VSM_NEXT_ID_VALID`, set where the record is
// packed, as the reference sets it): each record of a previous id that has a next one carries bit 1 more in its
// flags word, which only the compute throttle's process kernel reads; the frames' first
// digests, with no previous id, and every other buffer kept.
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { planFrames, randomWorld } from './planFrames.fixture.ts'

const DIGESTS: Record<number, string[]> = {
  1: [
    'd8aa7472f8052b536299d0212809e627a6baddf0b162fbcba28c69f9bf92cc93',
    '322cf6a8568ab8e638994de70cad94f9b35d56171dd2fcba1d871f8d1ddb14d6',
    '3e9f18eea0a258e4b7982b27878a063e932f2c69f8e2a1ff6965045645aef97a',
  ],
  2: [
    '71d2b6cafdcfb5b7febe6d0ca56cf026e74a51741ddd5a0b1f9c8f60a92c4a44',
    'c896575008382c0514d5e116aa1bd93f4c9c32d6245c4422a479be6013710374',
    'de3756905fec9db5679f87860e4c5fdc3b46215bf909f4735fd7f6708e7cd656',
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
