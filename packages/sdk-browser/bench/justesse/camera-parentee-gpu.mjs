// Justesse d'une caméra parentée, côté GPU réellement exécuté.
//
// La page `cameraParenteeGpuPage.mjs` est empaquetée par esbuild (celui de Vite, pris dans
// `render-tech-lab` en lecture seule, sans rien y écrire), servie sur une origine locale et lancée
// dans Chromium avec Playwright. Image après image, la sélection WebGPU du moteur est calculée pour
// la caméra enfant d'un parent d'hôte déplacé puis tourné, puis pour la caméra sans parent de même
// pose monde. Les pages sélectionnées doivent être identiques ; sinon le script échoue.
//
//   node packages/sdk-browser/bench/justesse/camera-parentee-gpu.mjs
//   (LAB_ROOT désigne `render-tech-lab` si le dépôt n'est pas son voisin.)
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
const depuisLab = createRequire(resolve(labRoot, 'package.json'));
const { chromium } = depuisLab('playwright');
const esbuild = createRequire(depuisLab.resolve('vite'))('esbuild');

const paquet = await esbuild.build({
  entryPoints: [resolve(ici, 'cameraParenteeGpuPage.mjs')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'cameraParentee',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
});
const code = paquet.outputFiles[0].text;

const server = createServer((request, response) => {
  const script = request.url === '/page.js';
  response.writeHead(200, { 'content-type': script ? 'text/javascript' : 'text/html' });
  response.end(
    script ? code : '<!doctype html><title>Caméra parentée</title><script src="/page.js"></script>',
  );
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let resultat;
try {
  const page = await browser.newPage();
  const erreursPage = [];
  page.on('pageerror', (error) => erreursPage.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  resultat = await page.evaluate(
    (pixelErrors) => globalThis.cameraParentee.executer(pixelErrors),
    [0, 3.5],
  );
  resultat.erreurs = [...(resultat.erreurs ?? []), ...erreursPage];
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

if (resultat.indisponible) throw new Error(resultat.indisponible);
console.log(`adaptateur : ${resultat.adaptateur}`);
let ecarts = 0;
for (const { pixelError, avecParent, sansParent } of resultat.cas) {
  for (let i = 0; i < avecParent.length; i++) {
    const rig = JSON.stringify(avecParent[i]),
      plate = JSON.stringify(sansParent[i]);
    const egal = rig === plate;
    if (!egal) ecarts++;
    console.log(
      `pixelError ${pixelError} image ${i} : ${egal ? 'identique' : 'ÉCART'}  rig ${rig}` +
        (egal ? '' : `  sans parent ${plate}`),
    );
  }
}
if (resultat.erreurs.length) console.log(`erreurs WebGPU : ${resultat.erreurs.join(' | ')}`);
console.log(`${ecarts} image(s) GPU en écart`);
if (ecarts || resultat.erreurs.length) process.exitCode = 1;
