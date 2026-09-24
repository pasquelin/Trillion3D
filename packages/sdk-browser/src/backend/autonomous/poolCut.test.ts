import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE } from './pool.fixture.ts';
import { mount } from './poolCut.fixture.ts';

test('after a smaller budget no image holds more than it: the cut fits it in the image drawn', () => {
  const { pool, state, diagnostics, image, drawn } = mount(1000 * PAGE);
  for (let frame = 0; frame < 12; frame++) image(1);
  const fine = drawn();
  assert.ok(state.allocationBytes > 40 * PAGE, `a fine cut to shrink: ${fine} pages`);
  assert.equal(pool.budgetPixelError, 0, 'a cut the budget did not limit');
  pool.resize(20 * PAGE);
  for (let frame = 0; frame < 12; frame++) {
    const most = image(1);
    assert.ok(most <= 20 * PAGE, `image ${frame}: ${most / PAGE} pages for 20 slots`);
    if (frame === 0)
      assert.equal(
        pool.coverageBudgetLimited,
        true,
        'the verdict moves in the image that tried it',
      );
  }
  assert.ok(pool.budgetPixelError > 1, 'the cut is drawn coarser');
  assert.equal(pool.coverageBudgetLimited, true);
  assert.equal(pool.settling, false, 'the search settled on the finest step that fits');
  assert.equal(
    diagnostics.filter(({ phase }) => phase === 'coverage-budget').length,
    0,
    'the verdict waits for the flush',
  );
  pool.flush();
  pool.flush();
  const published = diagnostics.filter(({ phase }) => phase === 'coverage-budget');
  assert.equal(published.length, 1, 'the verdict is published once, when it changes');
  assert.equal(published[0].context?.limited, true);
  assert.equal(published[0].context?.pixelError, 1);
  assert.equal(published[0].context?.requiredSlots, null, 'not known from a stopped pass');
  // A larger budget, still short of the scene, brings the detail back one step of √2 an image,
  // asking for each image.
  pool.resize(400 * PAGE);
  assert.equal(pool.settling, true, 'a larger pool owes an image');
  let images = 0;
  do image(1);
  while (pool.settling && ++images < 40);
  assert.ok(images > 1 && images < 40, `${images} images to settle`);
  assert.ok(state.allocationBytes <= 400 * PAGE);
  assert.equal(pool.budgetPixelError, 0);
  assert.equal(pool.coverageBudgetLimited, false);
  for (let frame = 0; frame < 12; frame++) image(1);
  assert.equal(drawn(), fine, 'the same cut as before the budget changed');
  pool.flush();
  const back = diagnostics.filter(({ phase }) => phase === 'coverage-budget');
  assert.equal(back.length, 2);
  assert.equal(back[1].context?.limited, false);
  assert.ok((back[1].context?.requiredSlots as number) > 20, 'the cut the host asked for, counted');
});
