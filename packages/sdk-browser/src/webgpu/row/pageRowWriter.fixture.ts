import { createPageRowWriter } from './pageRowWriter.ts'
import { createMaterialTable } from '../material/materialTable.ts'

type PageRowResources = Parameters<typeof createPageRowWriter>[0]

/** A row writer over `geometryBlocks` and `layers` with no as-is nor emissive-AO view, a fresh
 *  material table, no dirty-row note, each packed rank its own root. */
export const testRowWriter = (
  geometryBlocks: PageRowResources['geometryBlocks'],
  layers: Pick<PageRowResources, 'mapLayer' | 'dataLayer'>,
) =>
  createPageRowWriter(
    {
      geometryBlocks,
      mapLayer: layers.mapLayer,
      dataLayer: layers.dataLayer,
      asIsShown: false,
      emissiveAoShown: false,
      materialTable: createMaterialTable(),
    },
    () => {},
    (packed) => packed,
  )
