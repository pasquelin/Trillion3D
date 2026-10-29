//! A face labelling made valid: no false edge between two labels, and every label a manifold.
//!
//! False edges: the faces joined by false edges form groups, found breadth first in face order;
//! each group takes its most frequent label (the first among equals in order of appearance). When
//! that leaves a single label over the whole chart, the first group takes another label, unless
//! it covers the chart: the chart then cannot be cut, an error for a partition, a refusal for a
//! border's graph cut.
//!
//! Manifolds: every vertex is checked in turn (`vertex`) until a pass changes nothing or more
//! passes than labels have run. The two rules are applied in turn until they agree; past as many
//! rounds as labels, the labelling is kept as is and the children are cleaned when built.
use crate::hlod::flatten::uv::spectral::fail::{failed, invalid_data};
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::util::push_unique;

impl<'a> Chart<'a> {
    /// The labels `face_charts` among `count` made valid; whether they are. A chart that cannot be
    /// cut without breaking a false edge is an error.
    pub(crate) fn make_partition_valid(
        &mut self,
        count: usize,
        face_charts: &mut [u32],
    ) -> crate::Result<bool> {
        self.try_make_partition_valid(count, face_charts)?
            .ok_or_else(|| invalid_data("the chart cannot be cut without breaking a false edge"))
    }

    /// `make_partition_valid`, `None` when the chart cannot be cut without breaking a false edge.
    pub(crate) fn try_make_partition_valid(
        &mut self,
        count: usize,
        face_charts: &mut [u32],
    ) -> crate::Result<Option<bool>> {
        let mut manifold = false;
        let mut rounds = 0;
        loop {
            let mut modified_for_manifold = false;
            let Some((has_false_edge, modified_for_rule)) =
                self.keep_false_edges_inside(face_charts)?
            else {
                return Ok(None);
            };
            if rounds + 1 >= count {
                return Ok(Some(true));
            }
            if modified_for_rule || !manifold {
                (modified_for_manifold, manifold) = self.satisfy_manifold(count, face_charts);
            }
            if manifold && (!modified_for_manifold || !has_false_edge) {
                self.needs_clean = false;
                return Ok(Some(manifold));
            }
            self.needs_clean = true;
            rounds += 1;
            if !(modified_for_manifold && rounds < count) {
                break;
            }
        }
        Ok(Some(true))
    }

    /// Every group of faces joined by false edges given one label; whether false edges exist and
    /// whether a label changed, `None` when the chart cannot be cut without breaking one.
    fn keep_false_edges_inside(
        &self,
        face_charts: &mut [u32],
    ) -> crate::Result<Option<(bool, bool)>> {
        if self.source.false_edges.is_none() {
            return Ok(Some((false, false)));
        }
        let Some((faces, lengths)) = self.false_edge_groups()? else {
            return Ok(Some((false, false)));
        };
        let mut modified = false;
        let mut begin = 0;
        for &length in &lengths {
            modified |= unify(face_charts, &faces[begin..begin + length]);
            begin += length;
        }
        let first = face_charts[0];
        if face_charts[1..self.faces.len()].iter().any(|&c| c != first) {
            return Ok(Some((true, modified)));
        }
        if lengths.is_empty() || lengths[0] == self.faces.len() {
            return Ok(None);
        }
        let target = if first == 0 { 1 } else { 0 };
        for &f in &faces[..lengths[0]] {
            face_charts[f as usize] = target;
        }
        Ok(Some((true, modified)))
    }

    /// The groups of faces joined by false edges, laid one after another, and each group's
    /// length; `None` when the chart has no false edge.
    fn false_edge_groups(&self) -> crate::Result<Option<(Vec<u32>, Vec<usize>)>> {
        let mut on_false_edge = vec![false; self.faces.len()];
        let mut any = false;
        for edge in self.edges.iter().filter(|e| !e.splittable) {
            if edge.faces[0] == NONE || edge.faces[1] == NONE {
                return Err(failed("a false edge lies on a boundary"));
            }
            on_false_edge[edge.faces[0] as usize] = true;
            on_false_edge[edge.faces[1] as usize] = true;
            any = true;
        }
        if !any {
            return Ok(None);
        }
        let mut reached = vec![false; self.faces.len()];
        let mut faces = Vec::new();
        let mut lengths = Vec::new();
        for start in 0..self.faces.len() {
            if !on_false_edge[start] || reached[start] {
                continue;
            }
            let begin = faces.len();
            faces.push(start as u32);
            reached[start] = true;
            let mut at = begin;
            while at < faces.len() {
                let current = faces[at];
                for &e in &self.faces[current as usize].edges {
                    let edge = &self.edges[e as usize];
                    if edge.splittable {
                        continue;
                    }
                    let other = edge.other_face(current);
                    if other == NONE || reached[other as usize] {
                        continue;
                    }
                    faces.push(other);
                    reached[other as usize] = true;
                }
                at += 1;
            }
            lengths.push(at - begin);
        }
        Ok(Some((faces, lengths)))
    }

    /// Every vertex checked and fixed in passes; whether a label changed, and whether the
    /// labelling converged within as many passes as labels.
    fn satisfy_manifold(&self, count: usize, face_charts: &mut [u32]) -> (bool, bool) {
        let mut modified = false;
        let mut passes = 0;
        loop {
            let mut modified_pass = false;
            for v in 0..self.verts.len() as u32 {
                modified_pass |= self.validate_around(v, face_charts, true);
            }
            passes += 1;
            modified |= modified_pass;
            if !(modified_pass && passes <= count) {
                break;
            }
        }
        (modified, passes <= count)
    }
}

/// The faces `group` given their most frequent label; whether they had several.
fn unify(face_charts: &mut [u32], group: &[u32]) -> bool {
    let mut labels: Vec<u32> = Vec::new();
    for &f in group {
        push_unique(&mut labels, face_charts[f as usize]);
    }
    if labels.len() <= 1 {
        return false;
    }
    let mut counts = vec![0u32; labels.len()];
    for &f in group {
        if let Some(j) = labels.iter().position(|&l| l == face_charts[f as usize]) {
            counts[j] += 1;
        }
    }
    for i in 0..counts.len() - 1 {
        for j in i + 1..counts.len() {
            if counts[i] < counts[j] {
                counts.swap(i, j);
                labels.swap(i, j);
            }
        }
    }
    for &f in group {
        face_charts[f as usize] = labels[0];
    }
    true
}
