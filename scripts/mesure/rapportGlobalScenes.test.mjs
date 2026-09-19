import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { colonnesSimple, lireScenes } from './rapportGlobalScenes.mjs';

function campagneVide(root, scene, run) {
  const dir = join(root, scene, run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'mesure.json'),
    JSON.stringify({ scene, series: [], errors: [], head: 'abc', startedAt: 't', finishedAt: 't' }),
  );
}

test('lireScenes range Emerald puis Whisperwind sous un dossier de campagne', () => {
  const root = join(tmpdir(), `wg-scenes-${Date.now()}`);
  campagneVide(root, 'whisperwind-village', 'mobile');
  campagneVide(root, 'emerald-square', 'mobile');
  try {
    const scenes = lireScenes(root, [['mobile', 'référence', []]]);
    assert.deepEqual(
      scenes.map((s) => s.nom),
      ['emerald-square', 'whisperwind-village'],
    );
    assert.match(scenes[1].note, /Megascans/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lireScenes lit l’ancien plat comme une seule scène', () => {
  const root = join(tmpdir(), `wg-plat-${Date.now()}`);
  mkdirSync(join(root, 'mobile'), { recursive: true });
  writeFileSync(
    join(root, 'mobile', 'mesure.json'),
    JSON.stringify({
      scene: 'emerald-square',
      series: [],
      errors: [],
      head: 'abc',
    }),
  );
  try {
    const scenes = lireScenes(root, null);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].nom, 'emerald-square');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lireScenes garde l’Emerald plat à côté d’un dossier Whisperwind', () => {
  const root = join(tmpdir(), `wg-mixte-${Date.now()}`);
  mkdirSync(join(root, 'mobile'), { recursive: true });
  writeFileSync(
    join(root, 'mobile', 'mesure.json'),
    JSON.stringify({ scene: 'emerald-square', series: [], errors: [], head: 'abc' }),
  );
  campagneVide(root, 'whisperwind-village', 'mobile');
  try {
    const scenes = lireScenes(root, [['mobile', 'référence', []]]);
    assert.deepEqual(
      scenes.map((s) => s.nom),
      ['emerald-square', 'whisperwind-village'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('colonnesSimple pose une colonne par scène', () => {
  const html = colonnesSimple(
    [
      { nom: 'emerald-square', note: '', executions: [], dossier: 'a' },
      { nom: 'whisperwind-village', note: 'Megascans', executions: [], dossier: 'b' },
    ],
    () => '<p>barres</p>',
  );
  assert.match(html, /scenes-cols/);
  assert.match(html, /whisperwind-village/);
  assert.match(html, /Megascans/);
});
