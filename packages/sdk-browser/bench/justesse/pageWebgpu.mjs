// Une page Chromium locale où WebGPU est disponible, écrite une seule fois pour toutes les
// reproductions « GPU réellement exécuté » : le noyau de sélection du DAG (`noyauSelectionGpu.mjs`)
// et les normales d'éclairage (`normaleEclairageGpu.mjs`) l'utilisent. Playwright vient de
// `render-tech-lab`, en lecture seule.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

/**
 * Sert une page vide sur un port libre, l'ouvre dans Chromium et y évalue `fonction(argument)`.
 * `fonction` s'exécute dans la page : elle ne voit que son argument, sérialisé, et rend du JSON.
 */
export async function dansPageWebgpu(fonction, argument) {
  const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
  const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>WebGeometry WebGPU</title>');
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return await page.evaluate(fonction, argument);
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}
