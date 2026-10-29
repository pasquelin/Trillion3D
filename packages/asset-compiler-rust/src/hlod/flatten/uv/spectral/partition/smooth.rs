//! A face labelling smoothed along the labels' borders, then made valid.
//!
//! The labels are visited from the one with fewest faces (a heap on the negated face counts),
//! each label's faces in face order. A face whose neighbours across two or three of its edges
//! carry another label takes the label two of them share; when none is shared, the label across
//! its longest edge (the first among equals). A boundary edge counts as the face's own label.
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::ranked::Ranked;

impl<'a> Chart<'a> {
    /// The labels `face_charts` among `count` smoothed and made valid; whether they are valid.
    pub(crate) fn smooth_partition(
        &mut self,
        count: usize,
        face_charts: &mut [u32],
    ) -> crate::Result<bool> {
        let mut sizes = vec![0i32; count];
        for &label in &face_charts[..self.faces.len()] {
            sizes[label as usize] -= 1;
        }
        let mut heap = Ranked::<i32>::new(count);
        for (label, &size) in sizes.iter().enumerate() {
            heap.insert(label as u32, size);
        }
        let mut groups: Vec<Vec<u32>> = vec![Vec::new(); count];
        for (f, &label) in face_charts[..self.faces.len()].iter().enumerate() {
            groups[label as usize].push(f as u32);
        }
        while let Some(label) = heap.pop() {
            for &f in &groups[label as usize] {
                self.smooth_face(f, face_charts);
            }
        }
        self.make_partition_valid(count, face_charts)
    }

    /// Face `f` relabelled when most of its neighbours carry another label.
    fn smooth_face(&self, f: u32, face_charts: &mut [u32]) {
        let face = &self.faces[f as usize];
        let own = face_charts[f as usize];
        let mut around = [own; 3];
        let mut others = 0;
        for (k, charted) in around.iter_mut().enumerate() {
            let edge = &self.edges[face.edges[k] as usize];
            if edge.boundary {
                continue;
            }
            let across = edge.other_face(face.id);
            *charted = face_charts[across as usize];
            if *charted != own {
                others += 1;
            }
        }
        if others < 2 {
            return;
        }
        let shared = (0..3).find(|&k| {
            (others == 3 || around[k] != own)
                && (around[k] == around[(k + 1) % 3] || around[k] == around[(k + 2) % 3])
        });
        face_charts[f as usize] = match shared {
            Some(k) => around[k],
            None => {
                let mut longest = 0;
                for k in 1..3 {
                    if self.edges[face.edges[longest] as usize].length
                        < self.edges[face.edges[k] as usize].length
                    {
                        longest = k;
                    }
                }
                around[longest]
            }
        };
    }
}
