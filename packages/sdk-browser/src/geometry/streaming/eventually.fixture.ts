/** Waits, turn after turn, till `done()` holds: the event itself — a request sent, a refusal said,
 *  a page landed —, however slow the machine, never a fixed count of turns. The test's timeout
 *  bounds it. */
export async function eventually(done: () => boolean) {
  while (!done()) await new Promise(setImmediate)
}
