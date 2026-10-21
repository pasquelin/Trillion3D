//! The minimum cut between a source and a sink by growing search trees (augmenting paths found
//! between a source tree and a sink tree, the trees repaired after each augmentation), in single
//! precision.
//!
//! Each node keeps one residual towards the terminals, positive towards the source and negative
//! towards the sink, set from its two terminal capacities as their difference. The links come in
//! pairs, a link and its reverse at consecutive indices.
//!
//! The trees start from every node of non-zero residual, each queued as active in node order.
//! An active node, taken first in first out, scans its links in order: a neighbour of the other
//! tree reached through a residual link closes an augmenting path (the node is queued again); a
//! free one joins the node's tree one level deeper and is queued. The path's bottleneck (its two
//! terminal residuals and every link's residual, the lesser kept on each comparison) flows along
//! it; the ends whose terminal residual reaches zero and the children of every link saturated
//! inside a tree become orphans, which are then adopted or freed (`orphans`). A node ends on the
//! source side when it is in the source tree.
use crate::hlod::flatten::uv::extremes::least;
use std::collections::VecDeque;

mod orphans;

/// No link.
const NO_LINK: u32 = u32::MAX;

/// A node's parent in its tree.
#[derive(Clone, Copy, PartialEq)]
enum Parent {
    None,
    Source,
    Sink,
    Node(u32),
}

/// The tree a node belongs to.
#[derive(Clone, Copy, PartialEq)]
enum Tree {
    Free,
    Source,
    Sink,
}

#[derive(Clone)]
struct Node {
    /// The residual towards the terminals: positive towards the source, negative to the sink.
    residual: f32,
    /// The links leaving it, in the order they were added.
    links: Vec<u32>,
    tree: Tree,
    parent: Parent,
    /// The link from its parent to it, oriented from the source to the sink.
    parent_link: u32,
    depth: u32,
}

struct Link {
    residual: f32,
    to: u32,
    from: u32,
}

pub(super) struct Flow {
    nodes: Vec<Node>,
    links: Vec<Link>,
    active: VecDeque<u32>,
    orphans: VecDeque<u32>,
    /// The links of the augmenting path found last.
    path: Vec<u32>,
    /// The path's ends in the source tree and in the sink tree.
    ends: (u32, u32),
}

impl Flow {
    /// A graph of `count` nodes and no link.
    pub(super) fn new(count: usize) -> Flow {
        let node = Node {
            residual: 0.0,
            links: Vec::new(),
            tree: Tree::Free,
            parent: Parent::None,
            parent_link: NO_LINK,
            depth: 0,
        };
        Flow {
            nodes: vec![node; count],
            links: Vec::new(),
            active: VecDeque::new(),
            orphans: VecDeque::new(),
            path: Vec::new(),
            ends: (0, 0),
        }
    }

    /// A link from node `a` to node `b` of capacity `forward`, and its reverse of `backward`.
    pub(super) fn link(&mut self, a: u32, b: u32, forward: f32, backward: f32) {
        self.nodes[a as usize].links.push(self.links.len() as u32);
        self.links.push(Link {
            residual: forward,
            from: a,
            to: b,
        });
        self.nodes[b as usize].links.push(self.links.len() as u32);
        self.links.push(Link {
            residual: backward,
            from: b,
            to: a,
        });
    }

    /// Node `node` tied to the source with capacity `source` and to the sink with `sink`,
    /// replacing any earlier tie.
    pub(super) fn tie(&mut self, node: u32, source: f32, sink: f32) {
        self.nodes[node as usize].residual = source - sink;
    }

    /// Whether node `node` ended on the source side of the cut.
    pub(super) fn on_source_side(&self, node: u32) -> bool {
        self.nodes[node as usize].tree == Tree::Source
    }

    /// The maximum flow pushed through, which leaves the minimum cut.
    pub(super) fn solve(&mut self) {
        self.active.clear();
        self.orphans.clear();
        for k in 0..self.nodes.len() {
            let node = &mut self.nodes[k];
            if node.residual > 0.0 {
                (node.tree, node.parent, node.depth) = (Tree::Source, Parent::Source, 1);
                node.parent_link = NO_LINK;
                self.active.push_back(k as u32);
            } else if node.residual < 0.0 {
                (node.tree, node.parent, node.depth) = (Tree::Sink, Parent::Sink, 1);
                node.parent_link = NO_LINK;
                self.active.push_back(k as u32);
            } else {
                node.tree = Tree::Free;
                self.orphan_parent(k as u32);
            }
        }
        while self.find_path() {
            self.augment();
            self.adopt_orphans();
        }
    }

    /// Node `n` without a parent.
    fn orphan_parent(&mut self, n: u32) {
        let node = &mut self.nodes[n as usize];
        (node.parent, node.parent_link, node.depth) = (Parent::None, NO_LINK, 0);
    }

    /// Node `n` made an orphan.
    fn mark_orphan(&mut self, n: u32) {
        self.orphan_parent(n);
        self.orphans.push_back(n);
    }

    /// The trees grown until they meet; whether an augmenting path was found.
    fn find_path(&mut self) -> bool {
        while let Some(n) = self.active.pop_front() {
            let tree = self.nodes[n as usize].tree;
            if tree == Tree::Free {
                continue;
            }
            for i in 0..self.nodes[n as usize].links.len() {
                let link = self.nodes[n as usize].links[i];
                let m = self.links[link as usize].to;
                let other = self.nodes[m as usize].tree;
                if other == tree {
                    continue;
                }
                let toward = if tree == Tree::Source { link } else { link ^ 1 };
                let flows = self.links[toward as usize].residual > 0.0;
                if !flows {
                    continue;
                }
                if other != Tree::Free {
                    self.active.push_back(n);
                    let (s, t) = if tree == Tree::Source { (n, m) } else { (m, n) };
                    self.trace_path(s, t, toward);
                    return true;
                }
                self.active.push_back(m);
                let depth = self.nodes[n as usize].depth + 1;
                let joined = &mut self.nodes[m as usize];
                (joined.parent, joined.parent_link) = (Parent::Node(n), toward);
                (joined.depth, joined.tree) = (depth, tree);
            }
        }
        false
    }

    /// The path through link `bridge` from node `s` (source tree) to node `t` (sink tree).
    fn trace_path(&mut self, s: u32, t: u32, bridge: u32) {
        self.path.clear();
        self.path.push(bridge);
        let mut source_end = s;
        while let Parent::Node(parent) = self.nodes[source_end as usize].parent {
            self.path.push(self.nodes[source_end as usize].parent_link);
            source_end = parent;
        }
        let mut sink_end = t;
        while let Parent::Node(parent) = self.nodes[sink_end as usize].parent {
            self.path.push(self.nodes[sink_end as usize].parent_link);
            sink_end = parent;
        }
        self.ends = (source_end, sink_end);
    }

    /// The bottleneck pushed along the path, the saturated parts orphaned.
    fn augment(&mut self) {
        let (s, t) = (self.ends.0 as usize, self.ends.1 as usize);
        let mut bottleneck = least(self.nodes[s].residual, -self.nodes[t].residual);
        for &link in &self.path {
            bottleneck = least(bottleneck, self.links[link as usize].residual);
        }
        self.nodes[s].residual -= bottleneck;
        self.nodes[t].residual += bottleneck;
        if self.nodes[s].residual == 0.0 {
            self.mark_orphan(s as u32);
        }
        if self.nodes[t].residual == 0.0 {
            self.mark_orphan(t as u32);
        }
        for i in 0..self.path.len() {
            let link = self.path[i] as usize;
            self.links[link].residual -= bottleneck;
            self.links[link ^ 1].residual += bottleneck;
            if self.links[link].residual != 0.0 {
                continue;
            }
            let (p, q) = (self.links[link].from, self.links[link].to);
            let (pt, qt) = (self.nodes[p as usize].tree, self.nodes[q as usize].tree);
            if pt == Tree::Source && qt == Tree::Source {
                self.mark_orphan(q);
            } else if pt == Tree::Sink && qt == Tree::Sink {
                self.mark_orphan(p);
            }
        }
    }
}
