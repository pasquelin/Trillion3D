import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const example = (id: string) =>
  readFile(new URL(`../site/examples/${id}.html`, import.meta.url), 'utf8');

test('the game on the board replays legally: every move leaves an occupied square for a free one or a capture', async () => {
  const html = await example('a-game-board-seen-from-above');
  const game = /const GAME =([^;]*);/.exec(html)?.[1];
  assert.ok(game);
  const moves = [...game.matchAll(/'([^']*)'/g)]
    .map(([, part]) => part)
    .join('')
    .trim()
    .split(' ');
  // The starting position: white on ranks 1 and 2, the other side on 7 and 8.
  const board = new Map<string, 'white' | 'black'>();
  for (const file of 'abcdefgh')
    for (const [rank, side] of [
      [1, 'white'],
      [2, 'white'],
      [7, 'black'],
      [8, 'black'],
    ] as const)
      board.set(`${file}${rank}`, side);
  assert.equal(board.size, 32);
  moves.forEach((turn, index) => {
    const side = index % 2 ? 'black' : 'white';
    // Castling joins the king's move and the rook's with `+`: two moves of the same side.
    for (const move of turn.split('+')) {
      assert.match(move, /^[a-h][1-8][a-h][1-8]$/, move);
      const from = move.slice(0, 2),
        to = move.slice(2);
      assert.equal(board.get(from), side, `${index + 1}. ${move}: ${side} moves its own piece`);
      assert.notEqual(board.get(to), side, `${index + 1}. ${move}: never onto its own piece`);
      board.delete(from);
      board.set(to, side); // A capture replaces the piece that stood there: one piece a square.
    }
  });
});

test('the clockwork gears mesh at the sum of their radii and never overlap another gear of their plane', async () => {
  const html = await example('orbit-around-a-clockwork');
  const module = Number(/const MODULE = ([\d.]+);/.exec(html)?.[1]);
  const gears = JSON.parse(/const GEARS = (\[[^;]*\]);/.exec(html)?.[1] ?? '[]') as {
    id: string;
    teeth: number;
    plane: number;
    x: number;
    y: number;
    drives?: string;
    axle?: string;
  }[];
  assert.ok(module > 0 && gears.length > 2);
  const radius = (gear: (typeof gears)[number]) => (module * gear.teeth) / 2;
  const byId = new Map(gears.map((gear) => [gear.id, gear]));
  for (const gear of gears) {
    const other = byId.get(gear.drives ?? gear.axle ?? '');
    if (gear.axle) {
      assert.ok(other, gear.id);
      assert.deepEqual([gear.x, gear.y], [other.x, other.y], `${gear.id} shares its axle`);
      assert.notEqual(gear.plane, other.plane, `${gear.id} turns in another plane`);
    }
    if (gear.drives) {
      assert.ok(other, gear.id);
      const distance = Math.hypot(gear.x - other.x, gear.y - other.y);
      assert.ok(Math.abs(distance - radius(gear) - radius(other)) < 1e-3, `${gear.id} meshes`);
      assert.equal(gear.plane, other.plane);
    }
  }
  // Two gears of one plane that do not mesh stay clear of each other's teeth.
  for (const a of gears)
    for (const b of gears) {
      if (a.id >= b.id || a.plane !== b.plane || a.drives === b.id || b.drives === a.id) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance >= radius(a) + radius(b) + 2 * module, `${a.id} and ${b.id} overlap`);
    }
});
