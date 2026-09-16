//! L'union-recherche des coins d'un maillage : deux coins réunis sont du même éventail, donc de
//! même normale. Rien de propre au lissage ici, seulement la structure qui le porte.

pub(super) struct Join {
    parent: Vec<u32>,
}

impl Join {
    pub(super) fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
        }
    }
    /// Le représentant du groupe de ce coin, le chemin étant raccourci au passage.
    pub(super) fn root(&mut self, mut node: u32) -> u32 {
        while self.parent[node as usize] != node {
            let up = self.parent[node as usize];
            self.parent[node as usize] = self.parent[up as usize];
            node = self.parent[node as usize];
        }
        node
    }
    /// Réunit deux groupes sous le plus petit de leurs représentants.
    pub(super) fn unite(&mut self, left: u32, right: u32) {
        let (left, right) = (self.root(left), self.root(right));
        if left != right {
            self.parent[left.max(right) as usize] = left.min(right);
        }
    }
}
