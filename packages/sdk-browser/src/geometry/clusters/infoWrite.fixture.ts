import { createMaterialTable } from '../../materials/table/materialTable.ts'
import { createInfoWriter, type InfoResources } from './infoWrite.ts'

/** A cluster record writer over `geometryBlocks` and `layers` with no as-is nor emissive-AO view and
 *  a fresh material table. */
export const testInfoWriter = (
  geometryBlocks: InfoResources['geometryBlocks'],
  layers: Pick<InfoResources, 'mapLayer' | 'dataLayer'>,
) =>
  createInfoWriter({
    geometryBlocks,
    mapLayer: layers.mapLayer,
    dataLayer: layers.dataLayer,
    asIsShown: false,
    emissiveAoShown: false,
    materialTable: createMaterialTable(),
  })
