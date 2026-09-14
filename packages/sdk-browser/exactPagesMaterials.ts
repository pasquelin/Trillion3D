import { clusterColor } from './backendCommon.ts';
import { projectedPageError, type PageRec } from './pageSelection.ts';
import { screenErrorColor } from './diagnosticColors.ts';
import {
  createTriangleDiagnosticMaterial,
  materialSide,
  triangleGeometry,
  triangleSalt,
} from './triangleDiagnostic.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import * as THREE from 'three';

type MaterialsOptions = {
  blendCopies: THREE.Mesh[];
  viewport: readonly [number, number] | undefined;
  readonly diagnostic: DiagnosticMode;
  readonly lastCamera: THREE.PerspectiveCamera | undefined;
  readonly lastPixelError: number;
};

export function createExactPagesMaterials(options: MaterialsOptions) {
  const diagnosticMaterials = new Map<string, THREE.Material>();
  const materialFor = (rec: PageRec) => {
    if (options.diagnostic === 'beauty') return rec.material;
    const side = Array.isArray(rec.material) ? rec.material[0].side : rec.material.side;
    if (options.diagnostic === 'wireframe') {
      const key = `wireframe:${rec.clusterId}`;
      let material = diagnosticMaterials.get(key);
      if (!material) {
        material = createTriangleDiagnosticMaterial(side);
        diagnosticMaterials.set(key, material);
      }
      return material;
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
      material = new THREE.MeshBasicMaterial({ color, side });
      diagnosticMaterials.set(key, material);
    }
    if (options.diagnostic === 'screen-error' && options.lastCamera) {
      const color = screenErrorColor(
        projectedPageError(rec, options.lastCamera, options.viewport ?? [1, 1]),
        options.lastPixelError,
      );
      (material as THREE.MeshBasicMaterial).color.setRGB(...color);
    }
    return material;
  };
  const paint = (
    mesh: THREE.Mesh,
    sourceGeometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    salt = 0,
  ) => {
    mesh.material = material;
    mesh.geometry =
      options.diagnostic === 'wireframe' ? triangleGeometry(sourceGeometry, salt) : sourceGeometry;
  };
  const paintBlend = () => {
    for (const copy of options.blendCopies) {
      const sourceGeometry = copy.userData.sourceGeometry as THREE.BufferGeometry;
      const sourceMaterial = copy.userData.sourceMaterial as THREE.Material | THREE.Material[];
      if (options.diagnostic === 'wireframe') {
        const key = `blend:${copy.uuid}`;
        let material = diagnosticMaterials.get(key);
        if (!material) {
          material = createTriangleDiagnosticMaterial(materialSide(sourceMaterial));
          diagnosticMaterials.set(key, material);
        }
        paint(copy, sourceGeometry, material, triangleSalt(copy.uuid));
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
