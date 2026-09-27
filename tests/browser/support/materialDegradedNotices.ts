// What the WebGL2 proofs hear of a surface drawn without a physical feature (#772): the world's
// own hearer (`noticeMaterialDegraded`) on a world's notices, read through the public diagnostic
// channel a page opens (`diagnostic.createChannel`).
import {
  createWorldNotices,
  noticeMaterialDegraded,
} from '../../../packages/sdk-browser/src/world/diagnostic/worldNotices.ts';
import { diagnostic } from '../../../packages/sdk-browser/src/world/diagnostic/index.ts';

/** One `material-degraded` notice as the page channel delivers it. */
export interface DegradedNotice {
  kind: string;
  context: unknown;
}

/** `hear` goes where the session puts the world's hearer; `said` waits for the channel's
 *  delivery and returns every notice, then closes both channels. */
export function listenMaterialDegraded() {
  const notices = createWorldNotices(),
    channel = diagnostic.createChannel(),
    heard: DegradedNotice[] = [];
  channel.observe((notice) => {
    const { kind, context } = notice as DegradedNotice;
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
