// Le côté « avant » d'une comparaison A/B de la preuve Emerald : deux sources d'un dist de
// référence, transpilées à la volée et servies à la page à la place de celles du dist courant.
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

/** Remplace, dans `page`, `webgpuPages` et `visibilityBuffer` par ceux de `baselineDir`, et
 *  consigne leurs empreintes dans `provenance.baselineOverrides` et leurs sources sous `out`. */
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
