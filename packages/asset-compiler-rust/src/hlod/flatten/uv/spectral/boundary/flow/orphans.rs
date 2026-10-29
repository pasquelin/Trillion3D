//! The search trees repaired after an augmentation.
//!
//! Each orphan, first in first out, takes the shallowest neighbour of its own tree that still
//! flows to it and still reaches a terminal through its parents (the first among equals). An
//! orphan that finds none frees itself: its children in the tree become orphans and its
//! neighbours of the tree that flow to it are queued as active again.
use super::{Flow, Parent, Tree};

impl Flow {
    /// Whether node `q` reaches a terminal through its parents.
    fn reaches_terminal(&self, mut q: u32) -> bool {
        if self.nodes[q as usize].tree == Tree::Free {
            return false;
        }
        loop {
            match self.nodes[q as usize].parent {
                Parent::None => return false,
                Parent::Source | Parent::Sink => return true,
                Parent::Node(p) => q = p,
            }
        }
    }

    /// The `k`th link of node `p` and the node it leads to, when that node is in `tree`, not free.
    fn kin(&self, p: u32, k: usize, tree: Tree) -> Option<(u32, u32)> {
        let link = self.nodes[p as usize].links[k];
        let q = self.links[link as usize].to;
        (tree != Tree::Free && self.nodes[q as usize].tree == tree).then_some((link, q))
    }

    /// Every orphan given a new parent in its tree, or freed.
    pub(super) fn adopt_orphans(&mut self) {
        while let Some(p) = self.orphans.pop_front() {
            let tree = self.nodes[p as usize].tree;
            let mut adopted: Option<(u32, u32)> = None;
            let mut best_depth = 0;
            for k in 0..self.nodes[p as usize].links.len() {
                let Some((link, q)) = self.kin(p, k, tree) else {
                    continue;
                };
                let toward_p = if tree == Tree::Source { link ^ 1 } else { link };
                if self.links[toward_p as usize].residual == 0.0 {
                    continue;
                }
                if self.reaches_terminal(q) {
                    let depth = self.nodes[q as usize].depth;
                    if best_depth == 0 || best_depth > depth {
                        adopted = Some((q, toward_p));
                        best_depth = depth;
                    }
                }
            }
            if let Some((q, link)) = adopted {
                let depth = self.nodes[q as usize].depth + 1;
                let node = &mut self.nodes[p as usize];
                (node.parent, node.parent_link, node.depth) = (Parent::Node(q), link, depth);
                continue;
            }
            for k in 0..self.nodes[p as usize].links.len() {
                let Some((link, q)) = self.kin(p, k, tree) else {
                    continue;
                };
                if self.nodes[q as usize].parent == Parent::Node(p) {
                    self.mark_orphan(q);
                }
                if self.links[(link ^ 1) as usize].residual > 0.0 {
                    self.active.push_back(q);
                }
            }
            self.nodes[p as usize].tree = Tree::Free;
        }
    }
}
