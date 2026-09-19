//! Union-find of a mesh's corners: two united corners belong to the same fan, and therefore share
//! a normal. Nothing here is specific to smoothing, only the structure that carries it.

pub(super) struct Join {
    parent: Vec<u32>,
}

impl Join {
    pub(super) fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
        }
    }
    /// Representative of this corner's group, with the path shortened along the way.
    pub(super) fn root(&mut self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            let up = self.parent[node as usize];
            self.parent[node as usize] = self.parent[up as usize];
            node = self.parent[node as usize];
        }
        node
    }
    /// Unites two groups under the smaller of their representatives.
    pub(super) fn unite(&mut self, left: u32, right: u32) {
        let (left, right) = (self.root(left), self.root(right));
        if left != right {
            self.parent[left.max(right) as usize] = left.min(right);
        }
    }
}
