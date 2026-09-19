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

test('lireScenes orders Emerald then Whisperwind under a campaign folder', () => {
  const root = join(tmpdir(), `wg-scenes-${Date.now()}`);
  campagneVide(root, 'whisperwind-village', 'mobile');
  campagneVide(root, 'emerald-square', 'mobile');
  try {
    const scenes = lireScenes(root, [['mobile', 'reference', []]]);
    assert.deepEqual(
      scenes.map((s) => s.name),
      ['emerald-square', 'whisperwind-village'],
    );
    assert.match(scenes[1].note, /Megascans/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lireScenes reads the old flat layout as a single scene', () => {
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
    assert.equal(scenes[0].name, 'emerald-square');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lireScenes keeps flat Emerald next to a Whisperwind folder', () => {
  const root = join(tmpdir(), `wg-mixte-${Date.now()}`);
  mkdirSync(join(root, 'mobile'), { recursive: true });
  writeFileSync(
    join(root, 'mobile', 'mesure.json'),
    JSON.stringify({ scene: 'emerald-square', series: [], errors: [], head: 'abc' }),
  );
  campagneVide(root, 'whisperwind-village', 'mobile');
  try {
    const scenes = lireScenes(root, [['mobile', 'reference', []]]);
    assert.deepEqual(
      scenes.map((s) => s.name),
      ['emerald-square', 'whisperwind-village'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('colonnesSimple places one column per scene', () => {
  const html = colonnesSimple(
    [
      { name: 'emerald-square', note: '', executions: [], dossier: 'a' },
      { name: 'whisperwind-village', note: 'Megascans', executions: [], dossier: 'b' },
    ],
    () => '<p>barres</p>',
  );
  assert.match(html, /scenes-cols/);
  assert.match(html, /whisperwind-village/);
  assert.match(html, /Megascans/);
});
