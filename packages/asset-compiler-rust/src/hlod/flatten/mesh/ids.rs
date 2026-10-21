//! The ids of one kind of a mesh's elements — its vertices, its triangles or its edges —, each
//! counted by what holds it: an id is taken at a count of one, counted up and down as triangles
//! name it, and freed when its count falls to zero. The freed ids are kept in the order freed,
//! the last freed the next taken; a new id past the last is made only when none is free. Counts
//! are sixteen bits wide, their highest value marking a freed id, and wrap as sixteen bits do.

/// The count marking a freed id.
const FREED: u16 = u16::MAX;

/// Every id's count, and the freed ids in the order they were freed.
#[derive(Default)]
pub(super) struct Ids {
    counts: Vec<u16>,
    free: Vec<usize>,
}

impl Ids {
    /// A new id at a count of one: the last freed, else one past the last made.
    pub(super) fn take(&mut self) -> usize {
        match self.free.pop() {
            Some(id) => {
                self.counts[id] = 1;
                id
            }
            None => {
                self.counts.push(1);
                self.counts.len() - 1
            }
        }
    }

    /// How many ids were ever made, the freed among them.
    pub(super) fn made(&self) -> usize {
        self.counts.len()
    }

    /// Whether `id` stands: made, and not freed since it was last taken.
    pub(super) fn holds(&self, id: usize) -> bool {
        self.counts
            .get(id)
            .is_some_and(|&count| count > 0 && count < FREED)
    }

    /// `id`'s count, zero once freed.
    pub(super) fn count(&self, id: usize) -> u16 {
        match self.counts[id] {
            FREED => 0,
            count => count,
        }
    }

    /// Whether `id`'s count lies within three of the freed mark: an edit that would count it up
    /// is refused, room kept for the counts other edits add.
    pub(super) fn crowded(&self, id: usize) -> bool {
        self.counts[id] > FREED - 3
    }

    /// `id` counted up by `by`.
    pub(super) fn count_up(&mut self, id: usize, by: u16) {
        self.counts[id] = self.counts[id].wrapping_add(by);
    }

    /// `id` counted down by `by`, freed when it reaches zero.
    pub(super) fn count_down(&mut self, id: usize, by: u16) {
        self.counts[id] = self.counts[id].wrapping_sub(by);
        if self.counts[id] == 0 {
            self.free.push(id);
            self.counts[id] = FREED;
        }
    }
}
