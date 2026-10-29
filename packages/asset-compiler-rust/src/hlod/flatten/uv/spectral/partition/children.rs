//! A chart's children from a labelling of its faces.
//!
//! The faces are grouped by label in face order. When one label holds every face, or fewer than
//! two labels are possible, no child is made. Otherwise each non-empty group, in label order,
//! becomes a child of its faces and their vertices in vertex order, rebuilt; a child that is not
//! a manifold drops every child.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

impl<'a> Chart<'a> {
    /// The faces of each of `count` labels of `face_charts`, in face order.
    pub(super) fn faces_by_label(&self, face_charts: &[u32], count: usize) -> Vec<Vec<u32>> {
        let mut groups: Vec<Vec<u32>> = vec![Vec::new(); count];
        for (f, &label) in face_charts[..self.faces.len()].iter().enumerate() {
            groups[label as usize].push(f as u32);
        }
        groups
    }

    /// The children of the face labels `face_charts` among `count` labels; whether every child
    /// is a manifold.
    pub(crate) fn build_sub_charts(
        &mut self,
        face_charts: &[u32],
        count: usize,
    ) -> crate::Result<bool> {
        if count < 2 {
            return Ok(true);
        }
        self.children.clear();
        let groups = self.faces_by_label(face_charts, count);
        if groups.iter().any(|g| g.len() == self.faces.len()) {
            return Ok(true);
        }
        for group in &groups {
            if group.is_empty() {
                continue;
            }
            if !self.build_sub_chart(group)? {
                self.children.clear();
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// The child of faces `faces`, rebuilt and added; whether it is a manifold.
    pub(crate) fn build_sub_chart(&mut self, faces: &[u32]) -> crate::Result<bool> {
        let mut used = vec![false; self.verts.len()];
        for &f in faces {
            for v in self.faces[f as usize].verts {
                used[v as usize] = true;
            }
        }
        let verts: Vec<u32> = (0..self.verts.len() as u32)
            .filter(|&v| used[v as usize])
            .collect();
        let mut child = self.sub_chart(&verts, faces, true);
        if !child.connect()? {
            return Ok(false);
        }
        child.area_3d = child.area_3d_sum();
        child.base_l2 = child.base_l2_stretch();
        self.children.push(child);
        Ok(true)
    }
}
