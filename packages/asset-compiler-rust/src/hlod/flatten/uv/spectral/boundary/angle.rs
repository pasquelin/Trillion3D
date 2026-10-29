//! The borders cut by the dihedral angle alone.
//!
//! Twice: each child's neighbours are found from the current labels, then every pair of
//! neighbouring children (the lower label first, in label order and each child's neighbour order)
//! has its fuzzy faces relabelled by a minimum cut whose links weigh `1 / (1 + d / mean d)`.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

/// How many times every border is cut.
const ROUNDS: usize = 2;

impl<'a> Chart<'a> {
    /// The fuzzy faces `fuzzy` relabelled along every border by the dihedral angles `angles` of
    /// mean `mean`.
    pub(super) fn cut_by_angle(
        &mut self,
        face_charts: &mut [u32],
        fuzzy: &[bool],
        angles: &[f32],
        mean: f32,
    ) {
        for _ in 0..ROUNDS {
            self.find_neighbour_children(face_charts);
            for border in self.borders() {
                let Some(nodes) = self.border_nodes(border, face_charts, fuzzy) else {
                    continue;
                };
                self.cut_nodes(border, &nodes, face_charts, fuzzy, |edge, _, _| {
                    1.0 / (1.0 + angles[edge.id as usize] / mean)
                });
            }
        }
    }
}
