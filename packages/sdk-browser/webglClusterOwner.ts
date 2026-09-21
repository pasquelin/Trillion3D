import type { ClusterDrawMesh, WholeMesh } from './clusterBatchMesh.ts';
import { WebglClusterRenderer } from './webglClusterRenderer.ts';
import type { WebglClusterScene } from './webglClusterLights.ts';
import type { SceneCopy } from './webglClusterCopyCulling.ts';
import type { HostDrawCamera } from './cameraWorld.ts';

/** The one draw owner of a session's paged clusters, diagnostic pages and scene copies. */
export class WebglClusterOwner {
  private renderer: WebglClusterRenderer;
  private context: WebGL2RenderingContext;
  private restored = () => {
    this.renderer.dispose();
    this.renderer = new WebglClusterRenderer(this.context);
  };
  constructor(context: WebGL2RenderingContext) {
    this.context = context;
    this.renderer = new WebglClusterRenderer(context);
    context.canvas.addEventListener('webglcontextrestored', this.restored);
  }
  get backdropBytes() {
    return this.renderer.backdropBytes;
  }
  get copySubmissions() {
    return this.renderer.copySubmissions;
  }
  get backdropPasses() {
    return this.renderer.backdropPasses;
  }
  get backdropSubmissions() {
    return this.renderer.backdropSubmissions;
  }
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly WholeMesh[] = [],
    copies: readonly SceneCopy[] = [],
  ) {
    return this.renderer.draw(
      meshes,
      scene,
      camera,
      toneMapped,
      srgbDestination,
      diagnosticMeshes,
      copies,
    );
  }
  dispose() {
    this.context.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.renderer.dispose();
  }
}
