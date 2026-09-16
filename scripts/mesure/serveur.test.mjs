// L'isolement entre origines du serveur du harnais : c'est lui, et lui seul, qui décide si le SDK
// prendra son chemin de mémoire partagée. Défaut fermé : une campagne de référence ne change pas de
// chemin sans qu'on l'écrive. Le Lab, qui a son propre serveur, n'est pas concerné.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './serveur.mjs';
import { readOptions } from './options.mjs';

/** L'en-tête `nom` rendu par un serveur du harnais lancé avec ces options, puis refermé. */
async function entete(options, nom) {
  const server = await startServer({ port: 0, mounts: [], captures: new Map(), ...options });
  try {
    const reponse = await fetch(`http://127.0.0.1:${server.address().port}/`);
    await reponse.arrayBuffer();
    return reponse.headers.get(nom);
  } finally {
    server.close();
  }
}

test('sans isolement — le défaut — aucune en-tête COOP/COEP ne sort du serveur', async () => {
  assert.equal(await entete({}, 'cross-origin-opener-policy'), null);
  assert.equal(await entete({ isolation: false }, 'cross-origin-embedder-policy'), null);
});

test('avec isolement, COOP et COEP sortent sur chaque réponse', async () => {
  assert.equal(await entete({ isolation: true }, 'cross-origin-opener-policy'), 'same-origin');
  assert.equal(await entete({ isolation: true }, 'cross-origin-embedder-policy'), 'require-corp');
});

test('--isolation ne vaut que on ou off, et vaut off quand on ne dit rien', () => {
  assert.equal(readOptions([], process.cwd()).settings.isolation, false);
  assert.equal(readOptions(['--isolation', 'on'], process.cwd()).settings.isolation, true);
  assert.equal(readOptions(['--isolation', 'off'], process.cwd()).settings.isolation, false);
  assert.throws(() => readOptions(['--isolation', 'oui'], process.cwd()), /--isolation/);
});
