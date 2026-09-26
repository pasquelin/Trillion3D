/** Regenerate the original garden scene the tests read and compile its cache using this checkout. */
import { writeGarden } from './docs/garden-source.ts';
import { nativeCompiler } from './native-compiler.ts';
import { COOKED_SCENES, compileCache, sourceOf } from './site-caches.ts';
const scene = COOKED_SCENES['kinetic-garden'];
nativeCompiler();
await writeGarden(sourceOf(scene));
compileCache(scene);
