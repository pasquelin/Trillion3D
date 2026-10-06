/** A world's link, for a test, that records the content changes and the poses it hears. */
import type { SceneLink } from './sceneLink.ts'

export function countingLink() {
  const heard: object[] = [],
    posed: object[] = []
  const link = {
    content: (node: object) => heard.push(node),
    pose: (node: object) => posed.push(node),
    structure() {},
  }
  return { link: link as unknown as SceneLink, heard, posed }
}
