import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts';
import { worldRootsPageSource } from './worldRootsPage.ts';

/** The cook's world binary, served as the runtime's ranged reader serves it. */
export function worldRootsPageFixtureSource() {
  const { table, bin } = worldRootsFixture();
  return worldRootsPageSource(table, async (from, length) => bin.slice(from, from + length));
}
