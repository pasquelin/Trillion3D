import * as THREE from 'three';
import { PAGE } from './pool.fixture.ts';
import { mount } from './poolCut.fixture.ts';
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import type { DagPage } from '../../../../../bench/perf/browser/support/dagCut.ts';
import type { HostCamera } from '../../camera/world.ts';

/** Down the strip from its near end, as the cut rule's tests see it: every leaf in view. */
export function wholeStrip() {
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 4000);
  cam.position.set(-6, 4, 0);
  cam.lookAt(128, 0, 0);
  cam.updateMatrixWorld();
  return cam as unknown as HostCamera;
}

/** The rule DAG as the WebGL2 path collects it — one primitive, its group links, only its roots
 *  resident — under a pool of `budgetPages` pages. */
export function strip(budgetPages: number, camera: HostCamera, gl?: WebGL2RenderingContext) {
  const dag = ruleDag(256);
  const pages = dag.pages.map((page) => ({ ...page, array: undefined })) as unknown as DagPage[];
  const mounted = mount(budgetPages * PAGE, { pages, structures: [dag.structure], camera, gl });
  const index = new Map(pages.map((page, i) => [page, i]));
  const drawnIds = () => mounted.cut().shown.map((page) => index.get(page as DagPage)!);
  return { ...mounted, dag, pages, drawnIds };
}

/** Clusters nothing replaces in the rule DAG: its root cover. */
export function dag0Roots() {
  return ruleDag(256).pages.filter((page) => page.parentError === null).length;
}

/** The DAG level drawing each leaf unit of the rule DAG. */
export function levels(dag: ReturnType<typeof ruleDag>, drawn: number[]) {
  const at = new Int32Array(dag.leaves);
  for (const id of drawn) {
    const [a, b] = dag.pages[id].units;
    at.fill(dag.pages[id].level, a, b);
  }
  return at;
}
