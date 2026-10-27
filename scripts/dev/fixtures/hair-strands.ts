/** Regenerate the original hair strands scene the tests read and compile its cache using this checkout. */
import { hairStrandsExample } from './hair-strands/model.ts'
import { writeHairStrands } from './hair-strands/write.ts'
import { nativeCompiler } from '../../native/native-compiler.ts'
import { compileCache, sourceOf, TEST_SCENES } from '../../native/scene-caches.ts'
const scene = TEST_SCENES['hair-strands']
nativeCompiler()
await writeHairStrands(sourceOf(scene), hairStrandsExample())
compileCache(scene)
