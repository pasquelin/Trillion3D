//! Coarse levels keep their shape and their normals (#484): a slab keeps the normal of each of its
//! faces, a thin part keeps its silhouette or leaves under its error, and the cook refuses a DAG
//! whose error drops or whose normals turn their back on their faces.
use super::*;
use crate::geometry_page::{Attribute, FLAG_NORMAL};

/// A mesh with one normal per vertex.
pub(super) struct Shaded {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
}
impl Shaded {
    /// One grid of `nu` by `nv` quads from `origin` along `u` then `v`, wound so that its face
    /// normal is `u × v`, every vertex carrying `normal`.
    fn face(&mut self, origin: [f32; 3], u: [f32; 3], v: [f32; 3], (nu, nv): (usize, usize)) {
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        let first = (self.positions.len() / 3) as u32;
        for j in 0..=nv {
            for i in 0..=nu {
                let (a, b) = (i as f32 / nu as f32, j as f32 / nv as f32);
                for k in 0..3 {
                    self.positions.push(origin[k] + a * u[k] + b * v[k]);
                    self.normals.push(n[k] / length);
                }
            }
        }
        let w = nu + 1;
        self.indices
            .extend(crate::tests::fixtures::grid_indices(nu, nv, |x, y| {
                first + (y * w + x) as u32
            }));
    }
    /// The DAG the compiler builds of this mesh, its normals carried.
    pub fn build(&self) -> (Vec<DagCluster>, Vec<GroupTally>) {
        let normals = Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: self.normals.clone(),
        };
        let carried = [&normals];
        let attributes = DagAttributes { carried: &carried };
        let (dag, _, tallies, _) = build_dag_tallied(
            &self.positions,
            attributes,
            &self.indices,
            DagStrategy::QemEndpoints,
            &|| Ok(()),
        )
        .expect("dag");
        (dag, tallies)
    }
}

impl Shaded {
    /// A `side` by `side` slab `thickness` thick at `at` on the floor, flat shaded: each of its
    /// six faces owns its vertices and its normal, `n` quads along a long edge.
    pub(super) fn slab(&mut self, at: [f32; 2], (side, thickness): (f32, f32), n: usize) {
        let (l, h) = (side, thickness);
        let o = |x: f32, y: f32, z: f32| [at[0] + x, at[1] + y, z];
        self.face(o(0., 0., h), [l, 0., 0.], [0., l, 0.], (n, n));
        self.face(o(0., 0., 0.), [0., l, 0.], [l, 0., 0.], (n, n));
        self.face(o(0., 0., 0.), [l, 0., 0.], [0., 0., h], (n, 1));
        self.face(o(0., l, 0.), [0., 0., h], [l, 0., 0.], (1, n));
        self.face(o(0., 0., 0.), [0., 0., h], [0., l, 0.], (1, n));
        self.face(o(l, 0., 0.), [0., l, 0.], [0., 0., h], (n, 1));
    }
}

/// A tiled floor: `count` by `count` slabs side by side, touching along their edges without
/// sharing a vertex — the floor slabs that turned black under the sun.
pub(super) fn floor(count: usize) -> Shaded {
    let mut floor = Shaded {
        positions: Vec::new(),
        normals: Vec::new(),
        indices: Vec::new(),
    };
    for j in 0..count {
        for i in 0..count {
            floor.slab([i as f32 * 2.0, j as f32 * 2.0], (2.0, 0.2), 8);
        }
    }
    floor
}

/// The face normals of a slab: its six axis directions.
fn is_axis(n: [f64; 3]) -> bool {
    let largest = n.iter().fold(0.0_f64, |m, c| m.max(c.abs()));
    (largest - 1.0).abs() < 1e-6
}

// Behaviour: every level of a floor of flat-shaded slabs shades each face it keeps wider than its
// error with a normal of the slabs' own faces, on the side the face points to — never the
// underside on the top or on a side, which turned floor slabs black under the sun.
#[test]
fn a_slab_keeps_its_face_normals_at_every_level() {
    let slab = floor(4);
    let (dag, _) = slab.build();
    assert!(dag.iter().any(|c| c.level > 1), "the slab climbs");
    for cluster in dag.iter().filter(|c| c.level > 0) {
        for tri in cluster.indices.as_chunks::<3>().0 {
            let Some((face, width)) = quality::face_normal(&slab.positions, tri) else {
                continue;
            };
            if width <= cluster.lod_error {
                continue;
            }
            for &corner in tri {
                let normal = quality::unit_normal(&slab.normals, corner).expect("normal");
                assert!(
                    is_axis(normal),
                    "a corner carries one of the slab's normals"
                );
                assert!(
                    crate::shared_math::dot(face, normal) > 0.0,
                    "level {}: a face {face:?} shaded from behind by {normal:?}",
                    cluster.level
                );
            }
        }
    }
    quality::check(&dag, &slab.positions, Some(&slab.normals)).expect("the cook accepts the slab");
}
