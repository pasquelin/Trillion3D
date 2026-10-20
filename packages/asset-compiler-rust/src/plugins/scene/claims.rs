//! A mesh split into material parts: each part claims the faces its binding names, and what no
//! part claims goes back to the whole binding. Material resolution stays in each driver.

/// The faces of one mesh that a part has already claimed.
pub(crate) struct Claims {
    taken: Vec<bool>,
    /// A face goes to the first part that names it only (Maya), or to every part that names it
    /// (USD subsets).
    exclusive: bool,
}

impl Claims {
    pub(crate) fn new(faces: usize, exclusive: bool) -> Self {
        Self {
            taken: vec![false; faces],
            exclusive,
        }
    }

    /// The faces of `named` a part carries, in their order: those inside the mesh and, when
    /// exclusive, not claimed yet. Each becomes claimed.
    pub(crate) fn claim(&mut self, mut named: Vec<usize>) -> Vec<usize> {
        named.retain(|face| match self.taken.get_mut(*face) {
            Some(taken) => !std::mem::replace(taken, true) || !self.exclusive,
            None => false,
        });
        named
    }

    /// The faces no part has claimed, in order.
    pub(crate) fn rest(&self) -> Vec<usize> {
        (0..self.taken.len())
            .filter(|face| !self.taken[*face])
            .collect()
    }
}
