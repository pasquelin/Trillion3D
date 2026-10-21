//! Union-find over dense `u32` ids, the one every stage joins with: the fans of a mesh's corners,
//! the plane buckets of the coplanar stage, the wedges and pieces of the DAG's simplifier, the
//! islands of the codec's partition.
//!
//! A group is named by its least id (`LeastRoot`) or its greatest (`GreatestRoot`), whatever the
//! order the ids were joined in: the name is a property of the group, so the path compression a
//! query makes never changes what a caller reads.
use std::marker::PhantomData;

/// Which id names a group.
pub trait Root {
    /// The root two roots `a` and `b` are joined under.
    fn keeps(a: u32, b: u32) -> u32;
}

pub struct LeastRoot;
impl Root for LeastRoot {
    fn keeps(a: u32, b: u32) -> u32 {
        a.min(b)
    }
}

pub struct GreatestRoot;
impl Root for GreatestRoot {
    fn keeps(a: u32, b: u32) -> u32 {
        a.max(b)
    }
}

pub struct Join<R: Root> {
    parent: Vec<u32>,
    rule: PhantomData<R>,
}

impl<R: Root> Default for Join<R> {
    fn default() -> Self {
        Self::new(0)
    }
}

impl<R: Root> Join<R> {
    /// `count` ids, each a group of its own.
    pub fn new(count: usize) -> Self {
        Self {
            parent: (0..count as u32).collect(),
            rule: PhantomData,
        }
    }

    /// No id left.
    pub fn clear(&mut self) {
        self.parent.clear();
    }

    /// A new id, a group of its own; returned.
    pub fn push(&mut self) -> u32 {
        let id = self.parent.len() as u32;
        self.parent.push(id);
        id
    }

    pub fn len(&self) -> usize {
        self.parent.len()
    }

    pub fn is_empty(&self) -> bool {
        self.parent.is_empty()
    }

    /// The id naming `id`'s group, every id on the way pointed at it.
    pub fn root(&mut self, id: u32) -> u32 {
        let mut root = id;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut at = id;
        while self.parent[at as usize] != root {
            let next = self.parent[at as usize];
            self.parent[at as usize] = root;
            at = next;
        }
        root
    }

    /// The groups of `a` and `b` joined, named by the root `Root::keeps` picks.
    pub fn unite(&mut self, a: u32, b: u32) {
        let (ra, rb) = (self.root(a), self.root(b));
        if ra != rb {
            let kept = R::keeps(ra, rb);
            let joined = if kept == ra { rb } else { ra };
            self.parent[joined as usize] = kept;
        }
    }

    /// Every id in its group: the groups in the order of their least id, each one's ids
    /// ascending — whatever names them.
    pub fn groups(&mut self) -> Vec<Vec<u32>> {
        let mut rank_of_root = vec![u32::MAX; self.parent.len()];
        let mut groups: Vec<Vec<u32>> = Vec::new();
        for id in 0..self.parent.len() as u32 {
            let root = self.root(id) as usize;
            if rank_of_root[root] == u32::MAX {
                rank_of_root[root] = groups.len() as u32;
                groups.push(Vec::new());
            }
            groups[rank_of_root[root] as usize].push(id);
        }
        groups
    }
}
