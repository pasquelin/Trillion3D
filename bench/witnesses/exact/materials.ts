import type { EngineCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import type {
  HostDiagnosticMaterial,
  HostMaterials,
} from '../../../packages/sdk-browser/src/host/resources.ts';
import type { GraphMesh } from '../../../packages/sdk-browser/src/host/graph/mesh.ts';
import { GraphSurface } from '../../../packages/sdk-browser/src/host/graph/surface.ts';
import { Color } from '../../../packages/sdk-core/src/world/math/color.ts';
import { pageDiagnostics } from '../../../packages/sdk-browser/src/host/pageDiagnostics.ts';
import { clusterColor } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import { hashId, screenErrorColor } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import {
  projectedPageError,
  type PageRec,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { triangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import { materialSide } from '../../../packages/sdk-browser/src/scene/materialSide.ts';
import type { DiagnosticMode } from '../../../packages/sdk-core/src/index.ts';
import type { Geometry } from '../../../packages/sdk-core/src/world/geometry/geometry.ts';

type MaterialsOptions = {
  blendCopies: GraphMesh[];
  viewport: readonly [number, number] | undefined;
  readonly diagnostic: DiagnosticMode;
  /** Engine camera of the last frame, absent as long as no frame has been rendered. */
  readonly cam: EngineCamera | undefined;
  readonly lastPixelError: number;
};

export function createExactPagesMaterials(options: MaterialsOptions) {
  const diagnosticMaterials = new Map<string, HostDiagnosticMaterial>();
  const materialFor = (rec: PageRec): HostMaterials => {
    if (options.diagnostic === 'beauty') return rec.declaration;
    const side = materialSide(rec.declaration);
    if (options.diagnostic === 'wireframe') {
      const key = `wireframe:${rec.clusterId}`;
      let material = diagnosticMaterials.get(key);
      if (!material) {
        material = pageDiagnostics.triangleMaterial(side);
        diagnosticMaterials.set(key, material);
      }
      return material as GraphSurface;
    }
    const key =
      options.diagnostic === 'pages'
        ? rec.array
          ? 'resident'
          : 'loading'
        : options.diagnostic === 'lod'
          ? rec.role === 'coarse'
            ? 'coarse'
            : 'exact'
          : options.diagnostic === 'visibility'
            ? 'visible'
            : options.diagnostic === 'screen-error'
              ? `error:${rec.clusterId}`
              : rec.clusterId;
    let material = diagnosticMaterials.get(key);
    if (!material) {
      const color =
        options.diagnostic === 'pages'
          ? rec.array
            ? 0x34d399
            : 0xfbbf24
          : options.diagnostic === 'lod'
            ? rec.role === 'coarse'
              ? 0xf59e0b
              : 0x38bdf8
            : options.diagnostic === 'visibility'
              ? 0x34d399
              : options.diagnostic === 'screen-error'
                ? 0x00ff1f
                : clusterColor(key, 0.75);
      material = new GraphSurface('basic', {
        color: typeof color === 'number' ? new Color(color) : color,
        side,
      });
      diagnosticMaterials.set(key, material);
    }
    if (options.diagnostic === 'screen-error' && options.cam) {
      const color = screenErrorColor(
        projectedPageError(rec, options.cam, options.viewport ?? [1, 1]),
        options.lastPixelError,
      );
      ((material as GraphSurface).color as Color).setRGB(...color);
    }
    return material as GraphSurface;
  };
  const paint = (mesh: GraphMesh, sourceGeometry: Geometry, material: HostMaterials, salt = 0) => {
    mesh.material = material;
    mesh.geometry =
      options.diagnostic === 'wireframe'
        ? (triangleGeometry(sourceGeometry, pageDiagnostics, salt) as Geometry)
        : sourceGeometry;
  };
  const paintBlend = () => {
    for (const copy of options.blendCopies) {
      // What the copy wore before any view, kept by the batches (`clusterBatches.ts`).
      const sourceGeometry = copy.userData.sourceGeometry as Geometry;
      const sourceMaterial = copy.userData.sourceMaterial as HostMaterials;
      if (options.diagnostic === 'wireframe') {
        // A copy is told apart by its node number: a graph mesh carries no library `uuid`.
        const key = `blend:${copy.id}`;
        let material = diagnosticMaterials.get(key);
        if (!material) {
          material = pageDiagnostics.triangleMaterial(materialSide(sourceMaterial));
          diagnosticMaterials.set(key, material);
        }
        paint(copy, sourceGeometry, material as GraphSurface, hashId(String(copy.id)));
      } else paint(copy, sourceGeometry, sourceMaterial);
    }
  };
  return {
    materialFor,
    paint,
    paintBlend,
    disposeMaterials: () => diagnosticMaterials.forEach((material) => material.dispose()),
  };
}
