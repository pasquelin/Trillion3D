import { KEY_PAGE_BITS } from '../evict.ts'
import { EVICT_IN_USE, OLD_STEP, POOL_RANKS, POOL_TIERS } from '../../pool/rank.ts'
import { POOL_SORT_WGSL, poolSortWordsWgsl } from '../../pool/sortWgsl.ts'
import { EVICTION_BURST } from '../readoutWords.ts'
import { LEVEL_QUEUES } from './levelWgsl.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * The geometry pool's victim queue behind the drawn list (`evictionWord`, `../layout.ts`): a count,
 * the count of its OLD head, then canonical pages (`../evict.ts`, `listEvictions` its oracle). The
 * pool's sort (`../../pool/sortWgsl.ts`) over the pool's list — its content keys, one per held
 * slot (`../poolList.ts`) —, each key ranked on its group's last use, its level the tier, and
 * written as its canonical page. Every key's group is raised to the frame's uses first, the groups
 * replacing it with it (`dagRaiseParents`). The sort counts in `work` (`dagWorkLayout().poolSort`),
 * its atomic words; its scratch lies past the descent's sections in `flags`, the record table the
 * kernels read and write in place (`../cutTables.ts`), sized for the pool's list and the burst it
 * can take (`evictScratchWords`, `../flagSections.ts`) — never in `work`, whose binding it would
 * bound.
 */
export const DAG_EVICT_WGSL = wgslBlock(
  'DAG_EVICT_WGSL',
  [POOL_SORT_WGSL, poolSortWordsWgsl('work', (i) => `poolSortAt(${i})`)],
  `const KEY_PAGE:u32=${(1 << KEY_PAGE_BITS) - 1}u;
/** Word \`k\` of the eviction queue in \`out.pages\`: 0 its count, 1 its old head's, \`HEAD+j\` its
 *  entry \`j\`. */
fn evictAt(k:u32)->u32{return 2u*views[0u].listCap+HEAD+k;}
/** Content key of the pool list's entry \`j\`. */
fn poolKey(j:u32)->u32{return coldAt(poolBase()+1u+j);}
fn poolSlotCount()->u32{return coldAt(poolBase());}
fn poolSlotAge(j:u32)->u32{return useClock()-atomicLoad(&work[lastUseAt(groupOfKey(poolKey(j)))]);}
fn poolSlotTier(j:u32)->u32{return keyWordOf(poolKey(j))>>${KEY_PAGE_BITS}u;}
fn poolInUse()->u32{return ${EVICT_IN_USE}u;}
/** The burst the pool's list can take: no more than its keys, so the scratch follows the scene;
 *  the queue is the same, every key of a smaller list staged or listed under it. */
fn poolBurst()->u32{return min(${EVICTION_BURST}u,poolListCap());}
/** The sort's words, behind the groups a cut raised (\`dagWorkLayout\`). */
fn poolSortAt(i:u32)->u32{return raisedBase()+1u+raisedCap()+i;}
/** The sort's scratch, behind the flags' last descent queue (\`evictScratchWords\`). */
fn poolScratchLoad(i:u32)->u32{return flagAt(queueBase(${LEVEL_QUEUES}u)+i);}
fn poolScratchStore(i:u32,v:u32){setFlag(queueBase(${LEVEL_QUEUES}u)+i,v);}
/** The queue's count, and its old head's: every key above the first rank of the view ahead's age
 *  step, placed first. */
fn poolPlaced(total:u32){
 out.pages[evictAt(0u)]=min(total,${EVICTION_BURST}u);
 out.pages[evictAt(1u)]=min(poolCountLoad(${POOL_RANKS + OLD_STEP * POOL_TIERS - 1}u),${EVICTION_BURST}u);
}
fn poolEmit(at:u32,j:u32){out.pages[evictAt(HEAD+at)]=keyWordOf(poolKey(j))&KEY_PAGE;}
/** The groups replacing each group the cut raised, raised with it: before the sort reads an age. */
@compute @workgroup_size(SORT_LANES)
fn dagRaiseParents(@builtin(local_invocation_index) lane:u32){raiseParents(lane);}
`,
)
