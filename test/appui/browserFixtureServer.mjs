import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Les modules servis vivent dans ce dossier, à côté du serveur. C'est lui qui le sait : un appelant
// qui recalculait le chemin le gardait faux après le déplacement de `browserFixtures/` vers `appui/`.
const FIXTURES = dirname(fileURLToPath(import.meta.url));

/**
 * L'adresse du serveur du Lab, pour les seules preuves montées sur SES pages (`beaute`, `emeraude`,
 * `presentation`). Le moteur ne connaît aucun chemin vers le Lab : l'adresse est donnée par la
 * commande, `LAB_URL`, ou la preuve refuse de partir. Sans elle, `test:gpu` les écarte à voix haute.
 */
export function adresseDuLab() {
  const url = process.env.LAB_URL;
  if (!url)
    throw new Error(
      'LAB_URL absent : cette preuve tourne sur les pages du Lab, donner son adresse',
    );
  return url.replace(/\/$/, '');
}

/** Serve only the fixture modules owned by this test through the current browser origin. */
export async function routeBrowserFixtures(page, directory = FIXTURES) {
  const root = resolve(directory);
  await page.route('**/__wg-fixture/*.mjs', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (!name || !/^[A-Za-z][\w-]*\.mjs$/.test(name)) {
      await route.abort();
      return;
    }
    const file = resolve(root, name);
    if (!file.startsWith(root + sep)) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: await readFile(file, 'utf8'),
    });
  });
}
