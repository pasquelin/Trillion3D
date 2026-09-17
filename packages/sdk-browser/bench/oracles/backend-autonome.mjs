import * as THREE from 'three';

/**
 * `autonomousGeometry.ts` avant le lot G : `attach` et `detach` ne tenaient aucun ensemble, et
 * `sync` balayait `allPages` en entier — tout le DAG — pour trouver les quelques pages que la
 * nouvelle coupe laisse tomber. Les trois fonctions sont recopiées telles quelles : c'est l'oracle.
 */
export function referenceAutonomousSync({ scene, allPages, shown }) {
  const state = { submittedTriangles: 0 };
  const affichees = new Set();
  const detach = (rec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      rec.attached = false;
    }
  };
  const attach = (rec) => {
    if (!rec.geometry) return;
    if (!rec.mesh) {
      const mesh = new THREE.Mesh(rec.geometry, rec.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = rec.renderOrder;
      rec.mesh = mesh;
    }
    rec.mesh.matrix.copy(rec.matrix);
    if (!rec.attached) {
      scene.add(rec.mesh);
      rec.attached = true;
    }
  };
  const sync = () => {
    const display = shown;
    affichees.clear();
    for (const rec of display) affichees.add(rec);
    for (const rec of allPages) if (rec.attached && !affichees.has(rec)) detach(rec);
    state.submittedTriangles = 0;
    for (const rec of display) {
      if (!rec.array) throw new Error('AUTONOMOUS_COVERAGE_MISSING');
      attach(rec);
      state.submittedTriangles += rec.triangles;
    }
  };
  return { state, sync };
}
