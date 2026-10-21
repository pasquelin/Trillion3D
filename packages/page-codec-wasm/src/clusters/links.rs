//! The links between the edges of a triangle list that run one another back between the same two
//! positions, as the partition reads them (`Links::each`): an edge's one direct link first, then
//! its further links, the last made first. An edge whose two ends lie on one position is an edge
//! too: it runs itself back.
//!
//! **Making a link** (`Links::link`). Two edges both without a direct link take each other as
//! theirs; otherwise each is given the other as a further link, unless it already has it.
//!
//! **The two ways of linking** (`Linking`):
//! - a source: an edge run back by exactly one edge, itself perhaps, takes it as its direct link at
//!   once; then each edge run back by several, in edge order, while it still has no direct link,
//!   links every one of them, in edge order. An edge can so hold the same edge as its direct link
//!   and as a further one: the partition then reads it twice.
//! - a re-split: each edge, in edge order, links the edges before it that run it back, the latest
//!   first.
use crate::edges::DirectedEdges;
use crate::hash::{word_map, WordMap};

/// How a triangle list's edges are linked (the module's two ways).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Linking {
    Source,
    Resplit,
}

/// No direct link yet.
const UNLINKED: u32 = u32::MAX;
/// Several edges run it back: its direct link waits for its own turn.
const SEVERAL: u32 = u32::MAX - 1;

/// Each edge's direct link and its further links, in the order made.
pub struct Links {
    direct: Vec<u32>,
    further: WordMap<u32, Vec<u32>>,
}

impl Links {
    /// The links of the `corners` edges of a triangle list, edge `e` (from corner `e` to the next
    /// of its triangle) running between the two positions `ends(e)` names, the way `linking`
    /// names.
    pub fn of_ends(corners: usize, ends: impl Fn(usize) -> (u32, u32), linking: Linking) -> Self {
        let edges = (0..corners).map(|e| {
            let (a, b) = ends(e);
            (a, b, e as u32)
        });
        let edges = DirectedEdges::of(edges.collect(), |edges| edges.sort_unstable());
        Self::of(&edges, corners, linking)
    }

    /// The links of the `corners` edges of `edges`, tagged by edge, the way `linking` names.
    fn of(edges: &DirectedEdges, corners: usize, linking: Linking) -> Self {
        // Each edge's run going the other way, `u32::MAX` for none.
        let mut back_run = vec![u32::MAX; corners];
        for run in 0..edges.runs() {
            let back = edges.back(run).map_or(u32::MAX, |back| back as u32);
            edges
                .run(run)
                .iter()
                .for_each(|&(_, _, e)| back_run[e as usize] = back);
        }
        let back = |e: usize| match back_run[e] {
            u32::MAX => &[][..],
            run => edges.run(run as usize),
        };
        let mut links = Self {
            direct: vec![UNLINKED; corners],
            further: word_map(0),
        };
        match linking {
            Linking::Source => {
                for e in 0..corners {
                    links.direct[e] = match back(e) {
                        [] => UNLINKED,
                        [(_, _, only)] => *only,
                        _ => SEVERAL,
                    };
                }
                for e in 0..corners {
                    if links.direct[e] == SEVERAL {
                        back(e)
                            .iter()
                            .for_each(|&(_, _, o)| links.link(e as u32, o));
                    }
                }
            }
            Linking::Resplit => {
                for e in 0..corners {
                    let back = back(e);
                    let before = back.partition_point(|&(_, _, o)| (o as usize) < e);
                    (back[..before].iter().rev()).for_each(|&(_, _, o)| links.link(e as u32, o));
                }
            }
        }
        links
    }

    /// Whether edge `e` has no direct link: none yet, or waiting for its turn.
    fn free(&self, e: u32) -> bool {
        self.direct[e as usize] >= SEVERAL
    }

    /// Links edges `a` and `b` (the module's rule).
    fn link(&mut self, a: u32, b: u32) {
        if self.free(a) && self.free(b) {
            self.direct[a as usize] = b;
            self.direct[b as usize] = a;
            return;
        }
        for (from, to) in [(a, b), (b, a)] {
            let list = self.further.entry(from).or_default();
            if !list.contains(&to) {
                list.push(to);
            }
        }
    }

    /// Calls `f` on each edge linked to edge `e`: its direct link, then its further links, the
    /// last made first.
    pub fn each(&self, e: usize, mut f: impl FnMut(u32)) {
        if !self.free(e as u32) {
            f(self.direct[e]);
        }
        if let Some(list) = self.further.get(&(e as u32)) {
            list.iter().rev().for_each(|&o| f(o));
        }
    }
}
