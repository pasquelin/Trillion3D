// Une page Chromium locale où WebGPU est disponible, écrite une seule fois pour toutes les
// reproductions « GPU réellement exécuté » : le noyau de sélection du DAG (`noyauSelectionGpu.mjs`),
// la rasterisation (`noyauRasterGpu.mjs`), les normales d'éclairage (`normaleEclairageGpu.mjs`), les
// lots d'adressage (`adressageGpuPage.mjs`) et la caméra parentée (`camera-parentee-gpu.mjs`)
// l'utilisent. Playwright et esbuild sont des dépendances de dev du dépôt : le moteur se prouve
// seul, sans autre projet sur la machine.
import { createServer } from 'node:http';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { ouvrirAppareil } from './appareilWebgpu.mjs';

/**
 * Empaquette un module de page pour le navigateur et rend le texte du paquet : en IIFE sous
 * `nomGlobal` pour `dansPageWebgpu`, ou en module ES (`format: 'esm'`) quand la page le charge par
 * `import()`. Les options de paquetage — cible, plateforme — sont celles de toutes les
 * reproductions : les écrire ici est ce qui empêche deux d'entre elles de compiler pour deux cibles
 * différentes sans que rien ne le dise.
 */
export async function empaquetePage(entree, nomGlobal, { format = 'iife' } = {}) {
  const paquet = await esbuild.build({
    entryPoints: [entree],
    bundle: true,
    write: false,
    format,
    ...(format === 'iife' ? { globalName: nomGlobal } : {}),
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
  });
  return paquet.outputFiles[0].text;
}

/**
 * Sert une page vide sur un port libre, l'ouvre dans Chromium et y évalue `fonction(argument)`.
 * `fonction` s'exécute dans la page : elle ne voit que son argument, sérialisé, et rend du JSON.
 * `globalThis.ouvrirAppareil` y est installé d'avance (`appareilWebgpu.mjs`), puisqu'une fonction
 * sérialisée ne voit pas la portée de son module.
 *
 * Options : `titre` (celui de la page), `script` (un paquet servi sur `/page.js` et chargé par la
 * page, pour les reproductions qui ont besoin des vrais modules du moteur) et `erreursPage` (un
 * tableau que les erreurs non rattrapées de la page viennent remplir).
 */
export async function dansPageWebgpu(fonction, argument, options = {}) {
  const { titre = 'WebGeometry WebGPU', script = null, erreursPage = null } = options;
  const balise = script ? '<script src="/page.js"></script>' : '';
  const html = `<!doctype html><title>${titre}</title>${balise}`;
  const server = createServer((request, response) => {
    const sert = script && request.url === '/page.js';
    response.writeHead(200, { 'content-type': sert ? 'text/javascript' : 'text/html' });
    response.end(sert ? script : html);
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    if (erreursPage) page.on('pageerror', (error) => erreursPage.push(error.message));
    await page.addInitScript({ content: `globalThis.ouvrirAppareil = ${ouvrirAppareil};` });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return await page.evaluate(fonction, argument);
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}
