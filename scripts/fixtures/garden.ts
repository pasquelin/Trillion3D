/** Regenerate the original garden scene the tests read and compile its cache using this checkout. */
import { writeGarden } from './garden-source.ts'
import { nativeCompiler } from '../native-compiler.ts'
import { compileCache, sourceOf, TEST_SCENES } from '../scene-caches.ts'
const scene = TEST_SCENES['kinetic-garden']
nativeCompiler()
await writeGarden(sourceOf(scene))
compileCache(scene)
