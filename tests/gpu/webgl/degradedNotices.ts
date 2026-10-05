// What a WebGL2 proof hears of a surface drawn without a physical feature: the world's own hearer
// (`noticeMaterialDegraded`) on a world's notices, read through the public diagnostic channel a
// page opens (`diagnostic.createChannel`).
import { createWorldNotices } from '../../../packages/sdk-browser/src/world/diagnostic/worldNotices.ts';
import { noticeMaterialDegraded } from '../../../packages/sdk-browser/src/world/diagnostic/materialNotices.ts';
import { diagnostic } from '../../../packages/sdk-browser/src/world/diagnostic/index.ts';

/** One `material-degraded` notice as the page channel delivers it. */
interface DegradedNotice {
  kind: string;
  context: unknown;
}

/** `hear` goes where a session puts the world's hearer; `said` waits for the channel's delivery
 *  and returns every notice, then closes both channels. */
export function listenMaterialDegraded() {
  const notices = createWorldNotices(),
    channel = diagnostic.createChannel(),
    heard: DegradedNotice[] = [];
  // The channel hands the whole notice, its `context` included, typed by its kind and message.
  channel.observe(({ kind, context }: { kind: string; context?: unknown }) => {
    heard.push({ kind, context });
  });
  return {
    hear: noticeMaterialDegraded(notices),
    async said() {
      // Both channels deliver on a microtask; a task later every one has run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      notices.close();
      channel.close();
      return heard;
    },
  };
}
