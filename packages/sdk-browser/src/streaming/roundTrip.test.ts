import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoundTrip } from './roundTrip.ts';
import { createPageStreamer } from './pageStreamer.ts';
import { servedPages } from './servedPages.fixture.ts';

test('the round trip takes its first measure, then an eighth of each lateness', () => {
  const trip = createRoundTrip();
  assert.equal(trip.ms, 0, 'nothing measured yet');
  for (const none of [NaN, -1, -Infinity, Infinity]) trip.note(none);
  assert.equal(trip.ms, 0, 'what is not a duration is not a measure');
  trip.note(40);
  assert.equal(trip.ms, 40, 'the first measure is taken as it is');
  trip.note(80);
  assert.equal(trip.ms, 45, 'the second moves it by an eighth of its lateness');
  trip.note(Infinity);
  assert.equal(trip.ms, 45);
  const local = createRoundTrip();
  local.note(-0);
  local.note(80);
  assert.equal(local.ms, 10, 'a zero is a measure');
});

test('a streamer measures its reads up to their headers, and a cached page adds nothing', async () => {
  const { pages } = await servedPages(['a.bin', 'b.bin']);
  const served = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return served(url, init);
  };
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 });
  assert.equal(streamer.roundTripMs(), 0);
  await streamer.readBytes('a.bin');
  const first = streamer.roundTripMs();
  assert.ok(first >= 25 && first < 5000, String(first));
  await streamer.readBytes('a.bin');
  assert.equal(streamer.roundTripMs(), first, 'a page held is not read again');
  streamer.dispose();
});
