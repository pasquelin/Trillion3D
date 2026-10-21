//! A child's fuzzy region and local landmarks.
//!
//! The seeds: the child's boundary vertices inside its parent, or on the parent's boundary while
//! their first or last ring neighbour is inside it (always, for a vertex of one neighbour or
//! none). The rings: the seeds first, then each new layer of vertices next to the last, in order.
//! With `L` rings, the rings past ring `m = min(⌊0.3·L + 0.5⌋, L − 1)` stay fixed: the faces around
//! their vertices keep their labels, every other face of the child is fuzzy.
//!
//! For the stretch, `m` is lowered while fewer than 25 vertices would lie past ring `m` (none is
//! fuzzy when even ring 0 leaves too few); the vertices outside the fuzzy rings are the child's
//! landmarks, thinned to the most important when there are more than 25, and the child's fuzzy
//! level is `m − 1` (0 when `m` is 0, no face then being fuzzy).
use crate::hlod::flatten::uv::spectral::mesh::{Chart, KEEP, MIN_LANDMARKS};

/// The share of a child's rings whose faces the cut may relabel.
const FUZZY_SHARE: f32 = 0.30;

/// A child's rings from its border seeds.
struct Rings {
    /// The seeds, then each ring's vertices in order.
    verts: Vec<u32>,
    /// Where each ring ends in `verts`.
    ends: Vec<usize>,
}

impl Rings {
    /// The last fuzzy ring.
    fn last_fuzzy(&self) -> usize {
        let levels = self.ends.len();
        (((levels as f32) * FUZZY_SHARE + 0.5) as usize).min(levels - 1)
    }
}

impl<'a> Chart<'a> {
    /// The rings of this child of `father`, `fuzzy` marking their vertices; `None` without a seed.
    fn rings(&self, father: &Chart, fuzzy: &mut [bool]) -> Option<Rings> {
        let inside = |v: u32| !father.verts[self.verts[v as usize].parent as usize].boundary;
        let mut verts = Vec::new();
        for (i, v) in self.verts.iter().enumerate() {
            if !v.boundary {
                continue;
            }
            if !inside(i as u32)
                && v.verts.len() > 1
                && !inside(v.verts[0])
                && !inside(v.verts[v.verts.len() - 1])
            {
                continue;
            }
            fuzzy[i] = true;
            verts.push(v.id);
        }
        if verts.is_empty() {
            return None;
        }
        let mut ends = Vec::new();
        let (mut head, mut end) = (0, verts.len());
        loop {
            ends.push(end);
            for at in head..end {
                let v = verts[at] as usize;
                for &n in &self.verts[v].verts {
                    if !fuzzy[n as usize] {
                        verts.push(n);
                        fuzzy[n as usize] = true;
                    }
                }
            }
            (head, end) = (end, verts.len());
            if head == end {
                break;
            }
        }
        Some(Rings { verts, ends })
    }

    /// Every face of the child set in `fuzzy_faces` but those around the vertices of `rings`
    /// past ring `last`.
    fn mark_fuzzy_faces(&self, rings: &Rings, last: usize, fuzzy_faces: &mut [bool]) {
        for face in &self.faces {
            fuzzy_faces[face.parent as usize] = true;
        }
        for &v in &rings.verts[rings.ends[last]..] {
            for &f in &self.verts[v as usize].faces {
                fuzzy_faces[self.faces[f as usize].parent as usize] = false;
            }
        }
    }

    /// The child's fuzzy faces marked in `fuzzy_faces`, indexed by its father's faces.
    pub(super) fn fuzzy_region(&self, father: &Chart, fuzzy_faces: &mut [bool]) {
        let mut fuzzy = vec![false; self.verts.len()];
        match self.rings(father, &mut fuzzy) {
            None => {
                for face in &self.faces {
                    fuzzy_faces[face.parent as usize] = false;
                }
            }
            Some(rings) => self.mark_fuzzy_faces(&rings, rings.last_fuzzy(), fuzzy_faces),
        }
    }

    /// The child's fuzzy faces marked and its local landmarks chosen; its fuzzy level.
    pub(super) fn landmarks_and_fuzzy_region(
        &mut self,
        father: &Chart,
        fuzzy_faces: &mut [bool],
    ) -> u32 {
        let count = self.verts.len();
        let mut fuzzy = vec![false; count];
        let Some(rings) = self.rings(father, &mut fuzzy) else {
            for face in &self.faces {
                fuzzy_faces[face.parent as usize] = false;
            }
            self.landmarks = (0..count as u32).collect();
            return 0;
        };
        let mut level = rings.last_fuzzy() + 1;
        let mut enough = false;
        loop {
            level -= 1;
            if count - rings.ends[level] >= MIN_LANDMARKS {
                enough = true;
            }
            if level == 0 || enough {
                break;
            }
        }
        if enough {
            for &v in &rings.verts[rings.ends[level]..] {
                fuzzy[v as usize] = false;
            }
        } else {
            fuzzy.fill(false);
        }
        self.landmarks = (0..count as u32).filter(|&v| !fuzzy[v as usize]).collect();
        self.thin_landmarks();
        if level >= 1 {
            self.mark_fuzzy_faces(&rings, level, fuzzy_faces);
            (level - 1) as u32
        } else {
            for face in &self.faces {
                fuzzy_faces[face.parent as usize] = false;
            }
            0
        }
    }

    /// More than 25 landmarks thinned to the most important: each place in turn takes the most
    /// important of those after it (a vertex that must stay ending the search), until 25 places
    /// are taken, the last landmark is removable and the last two places differ in importance.
    fn thin_landmarks(&mut self) {
        let count = self.landmarks.len();
        if count <= MIN_LANDMARKS {
            return;
        }
        let (verts, marks) = (&self.verts, &mut self.landmarks);
        let importance = |marks: &[u32], at: usize| verts[marks[at] as usize].importance;
        let mut taken = 0;
        for i in 0..count - 1 {
            if importance(marks, i) != KEEP {
                let mut current = importance(marks, i);
                for j in i + 1..count {
                    let other = importance(marks, j);
                    if other == KEEP || current < other {
                        current = other;
                        marks.swap(i, j);
                    }
                    if other == KEEP {
                        break;
                    }
                }
            }
            taken += 1;
            if importance(marks, count - 1) > 0
                && taken >= MIN_LANDMARKS
                && taken > 2
                && importance(marks, taken - 1) != importance(marks, taken - 2)
            {
                break;
            }
        }
        marks.truncate(taken);
    }
}
