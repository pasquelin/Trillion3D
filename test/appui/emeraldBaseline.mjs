// The "avant" side of an Emerald-proof A/B comparison: two sources from a reference dist,
// transpiled on the fly and served to the page in place of the current dist's.
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

/** Replaces, in `page`, `webgpuPages` and `visibilityBuffer` with those from `baselineDir`, and
 *  records their footprints in `provenance.baselineOverrides` and their sources under `out`. */
export async function routeBaseline(page, out, provenance, baselineDir) {
  const ts = (await import('typescript')).default;
  for (const file of ['webgpuPages', 'visibilityBuffer']) {
    const source = await readFile(resolve(baselineDir, file + '.ts'), 'utf8');
    provenance.baselineOverrides.push({
      file,
      sha256: createHash('sha256').update(source).digest('hex'),
    });
    await writeFile(resolve(out, file + '.baseline.ts'), source);
    const js = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replaceAll(".ts'", ".js'")
      .replaceAll("from 'three'", "from '/.vite/deps/three.js'");
    await page.route('**/dist/sdk-browser/' + file + '.js*', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: js }),
    );
  }
}
