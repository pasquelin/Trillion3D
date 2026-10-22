//! The roots of a part's primitive as an assembly reads them (`RootCover`): the triangles of its
//! root clusters over the vertices they use, with the attributes its pages carry, the error the
//! roots were made at and the ball they stand in; and what an instance's transform does to them
//! (`RootCover::carried_by`) and to a parent's error and ball (`part_space`).
use crate::compiler::source::node_transform::Mat4;
use crate::dag::{bounds, DagCluster};
use crate::proxy::placement::place;
use trillion3d_math::matrix::linear::{determinant, linear_columns};
use trillion3d_math::matrix::transform_point;
use trillion3d_math::vector::vec3::{cross, unit_or_itself};
use trillion3d_math::vector::vecn::{dot, length};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT};

/// What an assembly takes of an instance's part: the triangles of the roots of its primitive's DAG
/// and the vertices they use, each attribute its pages carry on them, the largest error the roots
/// were made at (`DagCluster::lod_error`) and the ball around their balls
/// (`DagCluster::sphere`): the one cluster the part's DAG ends in, as the reference's instance
/// names it.
#[derive(Clone, Debug)]
pub(crate) struct RootCover {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub indices: Vec<u32>,
    pub lod_error: f64,
    pub sphere: [f64; 4],
}

/// A cover carried by an instance's matrix: its triangles over the arrays below, its error and ball
/// in the assembly's space.
pub(super) struct Carried {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub indices: Vec<u32>,
    pub lod_error: f64,
    pub sphere: [f64; 4],
}

/// The scale `matrix` puts on a length as the cut measures it (`placedScale`): its shortest axis
/// for an error, its longest for a radius.
fn stretch(matrix: &Mat4) -> (f64, f64) {
    let lengths = linear_columns(matrix).map(length);
    let least = lengths.iter().copied().fold(f64::INFINITY, f64::min);
    (least, lengths.iter().copied().fold(0.0, f64::max))
}

/// `layout` sorted and without its colour, and the width of that colour.
fn apart_colour(mut layout: Vec<(u32, usize)>) -> (Vec<(u32, usize)>, Option<usize>) {
    let colour = (layout.iter())
        .find(|(flag, _)| *flag == FLAG_COLOR)
        .map(|&(_, width)| width);
    layout.retain(|(flag, _)| *flag != FLAG_COLOR);
    layout.sort_unstable();
    (layout, colour)
}

impl RootCover {
    /// The cover of the roots of `dag` — the clusters no group replaces —, over the arrays
    /// `positions` and `carried` its clusters index; `None` for a DAG whose roots hold no triangle.
    pub(crate) fn of(
        dag: &[DagCluster],
        positions: &[f32],
        carried: &[&Attribute],
    ) -> Option<Self> {
        let roots: Vec<&DagCluster> = (dag.iter())
            .filter(|cluster| cluster.is_root() && !cluster.indices.is_empty())
            .collect();
        if roots.is_empty() {
            return None;
        }
        let mut seen = vec![u32::MAX; positions.len() / 3];
        let (mut used, mut indices): (Vec<u32>, Vec<u32>) = (Vec::new(), Vec::new());
        for &v in roots.iter().flat_map(|root| &root.indices) {
            let slot = &mut seen[v as usize];
            if *slot == u32::MAX {
                *slot = used.len() as u32;
                used.push(v);
            }
            indices.push(*slot);
        }
        let rows = |values: &[f32], width: usize| -> Vec<f32> {
            (used.iter())
                .flat_map(|&v| values[v as usize * width..][..width].iter().copied())
                .collect()
        };
        let spheres: Vec<[f64; 4]> = roots.iter().map(|root| root.sphere).collect();
        Some(Self {
            positions: rows(positions, 3),
            carried: (carried.iter())
                .map(|a| Attribute {
                    flag: a.flag,
                    width: a.width,
                    values: rows(&a.values, a.width),
                })
                .collect(),
            indices,
            lod_error: roots.iter().map(|root| root.lod_error).fold(0.0, f64::max),
            sphere: bounds::balls_ball(&spheres),
        })
    }

    /// Whether the attributes it carries are those of `layout`, a flag and a width each, whatever
    /// the order, and but for its colour: a build drops a colour white at every vertex
    /// (`dag/input`), so a colour one side lacks is white there (`build_with_instances`), and one
    /// both carry must be as wide. What a primitive an instance joins must carry alike.
    pub(crate) fn joins(&self, layout: &[(u32, usize)]) -> bool {
        let own = (self.carried.iter()).map(|a| (a.flag, a.width)).collect();
        let ((own, own_colour), (other, other_colour)) =
            (apart_colour(own), apart_colour(layout.to_vec()));
        own == other
            && own_colour
                .zip(other_colour)
                .is_none_or(|(own, other)| own == other)
    }

    /// The cover carried by `matrix`: its positions placed, its normals and the directions of its
    /// tangents turned by the axes of the matrix without their scale, and, when the matrix mirrors,
    /// its triangles turned over and its tangents' sign reversed; its error scaled by the shortest
    /// axis, its ball's centre placed and its radius scaled by the longest.
    pub(super) fn carried_by(&self, matrix: &Mat4) -> Carried {
        let axes = linear_columns(matrix).map(unit_or_itself);
        let mirrors = determinant(matrix) < 0.0;
        let turn = |v: [f64; 3]| -> [f64; 3] {
            unit_or_itself(std::array::from_fn(|r| {
                axes[0][r] * v[0] + axes[1][r] * v[1] + axes[2][r] * v[2]
            }))
        };
        let mut positions = Vec::with_capacity(self.positions.len());
        place(&self.positions, matrix, &mut positions);
        let carried = (self.carried.iter())
            .map(|source| {
                let mut values = source.values.clone();
                let directional = matches!(source.flag, FLAG_NORMAL | FLAG_TANGENT);
                for value in values
                    .chunks_exact_mut(source.width)
                    .filter(|_| directional)
                {
                    let turned = turn([0, 1, 2].map(|a| f64::from(value[a])));
                    for (into, v) in value.iter_mut().zip(turned) {
                        *into = v as f32;
                    }
                    if mirrors && source.flag == FLAG_TANGENT {
                        value[3] = -value[3];
                    }
                }
                Attribute {
                    flag: source.flag,
                    width: source.width,
                    values,
                }
            })
            .collect();
        let indices = (self.indices.as_chunks::<3>().0.iter())
            .flat_map(|&[a, b, c]| if mirrors { [a, c, b] } else { [a, b, c] })
            .collect();
        let (least, most) = stretch(matrix);
        let [x, y, z, radius] = self.sphere;
        let [x, y, z] = transform_point(matrix, [x, y, z]);
        Carried {
            positions,
            carried,
            indices,
            lod_error: self.lod_error * least,
            sphere: [x, y, z, radius * most],
        }
    }
}

/// The parent error and ball `error` and `sphere` of the assembly's space, in the space of the
/// part an instance placed by `matrix` draws: the error over the shortest axis, the ball's centre
/// brought back through the matrix, its radius over the longest — what the cut scales them by
/// under the instance's own world (`placedScale`) —; `None` for a matrix that has no inverse.
pub(crate) fn part_space(matrix: &Mat4, error: f64, sphere: [f64; 4]) -> Option<[f64; 5]> {
    let (least, most) = stretch(matrix);
    let [c0, c1, c2] = linear_columns(matrix);
    let det = dot(c0, cross(c1, c2));
    if !(least > 0.0 && most.is_finite() && det.is_finite() && det != 0.0) {
        return None;
    }
    let rows = [cross(c1, c2), cross(c2, c0), cross(c0, c1)].map(|row| row.map(|x| x / det));
    let from = [
        sphere[0] - matrix[12],
        sphere[1] - matrix[13],
        sphere[2] - matrix[14],
    ];
    let [x, y, z] = std::array::from_fn(|r| dot(rows[r], from));
    Some([error / least, x, y, z, sphere[3] / most])
}
