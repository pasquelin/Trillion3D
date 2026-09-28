/** A world's link, for a test, that counts the content changes it hears. */
import type { SceneLink } from './sceneLink.ts';

export function countingLink() {
  const heard: object[] = [];
  const link = { content: (node: object) => heard.push(node), pose() {}, structure() {} };
  return { link: link as unknown as SceneLink, heard };
}
