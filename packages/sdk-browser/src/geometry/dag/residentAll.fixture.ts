import { createDagResidencyUpload } from './residencyUpload.ts'
import { pageResidency } from './readiness.fixture.ts'

/** Every page of a cut's tables resident, uploaded as the host does (`residencyUpload.ts`): a cut
 *  that streams nothing draws every page it wants. */
export function residentAll(resources: Parameters<typeof createDagResidencyUpload>[0]) {
  createDagResidencyUpload(resources)(
    pageResidency(new Uint8Array(resources.packed.pageCount).fill(1)),
  )
}
