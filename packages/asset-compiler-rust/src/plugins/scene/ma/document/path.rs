//! Identity of a scene node: its path, and the node a written name refers to.
//!
//! Maya names nodes by their full path — `|A|M` — and requires uniqueness of the short name only
//! under the same parent: two `transform` nodes named `M`, one under `A` and one under `B`, are
//! two nodes. A file refers to them by the short name while there is only one, and by the path as
//! soon as there are two; mixing them up would let the second overwrite the first.
use super::*;

/// Full path of a node of this name under this parent, as Maya writes it.
pub(super) fn under(document: &Document, parent: Option<usize>, name: &str) -> String {
    let head = parent.map_or("", |parent| document.nodes[parent].path.as_str());
    format!("{head}|{}", leaf(name))
}

impl Document {
    /// The node a written name refers to, and whether it referred to several. A name that carries
    /// a `|` is a path: only nodes whose path ends with it match. A short name keeps every
    /// namesake, and it is then the first written that matches.
    fn named(&self, written: &str) -> (Option<usize>, bool) {
        let ranks = self
            .by_name
            .get(leaf(written))
            .map_or(&[][..], Vec::as_slice);
        let tail = format!("|{}", written.trim_start_matches('|'));
        let mut found = ranks
            .iter()
            .filter(|rank| !written.contains('|') || self.nodes[**rank].path.ends_with(&tail));
        let first = found.next().copied();
        (first, found.next().is_some())
    }

    /// The node a written name refers to, with ambiguity counted when several match: the file
    /// should have written a path, and picking one of the two at random would change the scene.
    pub(in super::super) fn find(&mut self, written: &str) -> Option<usize> {
        let (found, ambiguous) = self.named(written);
        if ambiguous {
            self.report.add(report::NAME_AMBIGUOUS);
        }
        found
    }

    /// Records a new node under its short name: namesakes follow one another in file order.
    pub(super) fn remember(&mut self, name: &str, rank: usize) {
        self.by_name
            .entry(leaf(name).to_string())
            .or_default()
            .push(rank);
    }
}
