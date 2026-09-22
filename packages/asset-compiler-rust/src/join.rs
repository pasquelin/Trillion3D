//! Union-find over dense `u32` ids: the fans of a mesh's corners when normals are smoothed, the
//! texture islands of a mesh in the corpus. Nothing here is specific to either.

pub(crate) struct Join {
    parent: Vec<u32>,
}

impl Join {
    pub(crate) fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
        }
    }
    /// Representative of this id's group, with the path shortened along the way.
    pub(crate) fn root(&mut self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            let up = self.parent[node as usize];
            self.parent[node as usize] = self.parent[up as usize];
            node = self.parent[node as usize];
        }
        node
    }
    /// Unites two groups under the smaller of their representatives.
    pub(crate) fn unite(&mut self, left: u32, right: u32) {
        let (left, right) = (self.root(left), self.root(right));
        if left != right {
            self.parent[left.max(right) as usize] = left.min(right);
        }
    }
}
