//! The corners lying at one place (`Neighbours`), found by a sweep over their ranks: the corners
//! are sorted by a rank that bounds how far apart two corners at one place may rank, each is
//! compared with those after it until one ranks past the window, and two the caller's test calls
//! near are put in one list.
//!
//! A list is made when a corner first meets another, holding both; a corner met later joins the
//! list of the corner it was compared from, and then names that list as its own — the list it was
//! in before still holds it. So a chain of corners, each near the next but the first not near the
//! last, ends up in the first's list. Each list is read sorted, without repeats, and holds the
//! corner it is the list of.

/// No list.
const NONE: u32 = u32::MAX;

/// Which list each corner names as its own, and the lists, sorted without repeats.
pub(crate) struct Neighbours {
    belongs: Vec<u32>,
    lists: Vec<Vec<u32>>,
}

impl Neighbours {
    /// The lists of `count` corners swept in the order of `ranked`, each corner with its rank, the
    /// ranks ascending: a corner is compared with the following ones while their rank is no more
    /// than `window` past its own, `near` telling whether two are at one place.
    pub(crate) fn sweep(
        count: usize,
        ranked: &[(f32, u32)],
        window: f32,
        near: impl Fn(u32, u32) -> bool,
    ) -> Self {
        let mut found = Self {
            belongs: vec![NONE; count],
            lists: Vec::new(),
        };
        for (i, &(rank, first)) in ranked.iter().enumerate() {
            for &(other, second) in &ranked[i + 1..] {
                if (other - rank).abs() > window {
                    break;
                }
                if near(first, second) {
                    found.join(first, second);
                }
            }
        }
        for list in &mut found.lists {
            list.sort_unstable();
            list.dedup();
        }
        found
    }

    /// `second` put in `first`'s list, one made with both when `first` has none.
    fn join(&mut self, first: u32, second: u32) {
        match self.belongs[first as usize] {
            NONE => {
                self.belongs[first as usize] = self.lists.len() as u32;
                self.belongs[second as usize] = self.lists.len() as u32;
                self.lists.push(vec![first, second]);
            }
            list => {
                self.belongs[second as usize] = list;
                self.lists[list as usize].push(second);
            }
        }
    }

    /// The sorted corners of `corner`'s list, itself among them; none where it has no neighbour.
    pub(crate) fn of(&self, corner: usize) -> &[u32] {
        match self.belongs[corner] {
            NONE => &[],
            list => &self.lists[list as usize],
        }
    }
}
