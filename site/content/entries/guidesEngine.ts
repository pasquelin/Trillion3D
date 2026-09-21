/** Engine guides — memory, admission — kept apart so the guide list stays within its line budget. */
import { GUIDE } from './guides.ts';
import type { PortalEntry } from '../model.ts';

export const ENGINE_GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'memory-pools',
    title: 'Memory pools and cut admission',
    description:
      'Two fixed pools set by the host, what a view asks beyond them, and how to read the verdict.',
    html: `<p>The engine holds two fixed pools, in bytes, never read off the machine: <code>geometryPoolBytes</code> for cluster pages (512 MiB by default, <code>floor(bytes / pageBytes)</code> slots) and <code>texturePoolBytes</code> for virtual-texture tiles. A budget that cannot be held as given is brought to what can and the reason is published: <code>geometryPoolClamp</code> reads <code>root-cover</code> (raised to the root cover, which is always resident), <code>scene</code> (the scene is smaller), <code>ceiling</code> (above <code>geometryPoolCeilingBytes</code>, the most a session may grow to), <code>page-cap</code>, <code>device-limit</code> or <code>null</code>.</p>
<h3 class="text-lg font-bold mt-4">What a view asks beyond the pool</h3>
<p>Nothing is refused and nothing stops: the cut is <strong>coarsened, never truncated</strong>. When the pages the cut asks for — root cover included — exceed the slots, the admission doubles the screen error the image was drawn at (1 px at least on a first overflow, then 2, 4…), and relaxes it rung by rung down to 0.125 px once the cut fits with room to spare. Two rules keep it still: a rung moves only on a cut sampled at the rung in force, and a rung whose requested cut overflowed for this view is not asked again until the view or the pool changes. A still camera therefore settles in a few samples and holds its frame.</p>
<h3 class="text-lg font-bold mt-4">Changing a pool mid-session</h3>
<p><code>explorer.setMemoryBudgets({ geometryPoolBytes, texturePoolBytes })</code> resizes without emptying: the root cover keeps its place before any other page, then the pinned pages, then the most recent; only what no longer fits leaves, and the report says how many (<code>evictedPages</code>, <code>evictedTiles</code>, <code>durationMs</code>). Bind groups that named the old pool are rebuilt on the next image by the identity of what they name.</p>
<h3 class="text-lg font-bold mt-4">Reading the verdict</h3>
<p>Per frame, <code>render()</code> returns <code>coverageBudgetLimited</code> (the requested cut does not fit yet) and <code>budgetPixelError</code> (0 while the requested detail fits, else the rung the image is drawn at), plus <code>geometryPoolSaturated</code>. The <code>coverage-budget</code> diagnostic, delivered during <code>flush()</code>, names each change of verdict with the slots asked and held.</p>`,
    example: `const explorer = await createExplorer('viewer', {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  geometryPoolBytes: 64 * 1024 * 1024,        // slots = floor(bytes / pageBytes)
  geometryPoolCeilingBytes: 256 * 1024 * 1024, // the most a slider may ask mid-session
  texturePoolBytes: 256 * 1024 * 1024,
  onDiagnostic: (event) => {
    if (event.phase === 'coverage-budget') console.log(event.context); // limited, requiredSlots, slots, pixelError
  },
});
const frame = explorer.render();
frame.geometryPoolClamp;      // 'root-cover' | 'scene' | 'ceiling' | 'page-cap' | 'device-limit' | null
frame.coverageBudgetLimited;  // true while the requested cut does not fit
frame.budgetPixelError;       // 0, or the coarser threshold the image is drawn at
const pools = await explorer.setMemoryBudgets({ geometryPoolBytes: 32 * 1024 * 1024 });
pools.evictedPages;           // what the smaller pool could not keep`,
  },
];
