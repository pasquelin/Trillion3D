//! A new window cut into its edge against every window already there.
//!
//! The new window is tested against each window on its edge in turn (`intersect`): either may
//! shrink or vanish, and a window that lay across the other's interval leaves its uncovered start
//! as a piece of its own. A changed existing window is taken out of the heap and put back changed,
//! or dropped from the edge when nothing is left; a piece of the new window is cut in after it, in
//! the same way; a piece of an existing window (the last one met) is added as is. A new window
//! left with some width is then added, held in the heap, and each window added lowers the distance
//! of an edge end it reaches within 0.01.
use super::intersect::Outcome;
use super::{Link, Listed, Window, Windows};

/// How near an edge end a window must reach to set that end's distance.
const REACH: f64 = 0.01;

impl Windows {
    /// `window` and its pieces cut into its edge.
    pub(super) fn insert_window(&mut self, window: Window) {
        let mut pending = vec![window];
        let mut j = 0;
        while j < pending.len() {
            let mut fresh = pending[j];
            let edge = fresh.edge as usize;
            let mut leftover = Window::default();
            let mut fresh_gone = false;
            for i in 0..self.edges[edge].windows.len() {
                let mut existing = self.edges[edge].windows[i].window;
                let outcome: Outcome = self.intersect(&mut existing, &mut fresh);
                if outcome.existing_piece.b1 - outcome.existing_piece.b0 > 0.0 {
                    leftover = outcome.existing_piece;
                }
                if outcome.fresh_piece.b1 - outcome.fresh_piece.b0 > 0.0 {
                    pending.push(outcome.fresh_piece);
                }
                if outcome.existing_changed {
                    let listed = &mut self.edges[edge].windows[i];
                    if let Link::Held(id) = listed.link {
                        self.release(id);
                        if outcome.existing_gone {
                            self.edges[edge].windows[i].link = Link::Dropped;
                        } else {
                            self.edges[edge].windows[i].window = existing;
                            let id = self.hold(existing);
                            self.edges[edge].windows[i].link = Link::Held(id);
                        }
                    } else if outcome.existing_gone {
                        listed.link = Link::Dropped;
                    } else {
                        listed.window = existing;
                    }
                }
                if outcome.fresh_gone {
                    fresh_gone = true;
                    break;
                }
            }
            self.edges[edge].windows.retain(|l| l.link != Link::Dropped);
            if leftover.b1 - leftover.b0 > 0.0 {
                self.place(leftover);
            }
            if !fresh_gone {
                self.place(fresh);
            }
            j += 1;
        }
    }

    /// `window` held and listed on its edge, the edge ends it reaches lowered.
    fn place(&mut self, window: Window) {
        let id = self.hold(window);
        let edge = &mut self.edges[window.edge as usize];
        edge.windows.push(Listed {
            link: Link::Held(id),
            window,
        });
        let (length, other) = (edge.length, edge.other_end(window.mark));
        let reached = window.pseudo_distance;
        if window.b0 < REACH {
            let mark = &mut self.verts[window.mark as usize];
            if window.d0 + reached < mark.distance {
                mark.distance = window.d0 + reached;
                mark.window_gap = window.b0;
            }
        }
        if window.b1 > length - REACH {
            let end = &mut self.verts[other as usize];
            if window.d1 + reached < end.distance {
                end.distance = window.d1 + reached;
                end.window_gap = length - window.b1;
            }
        }
    }
}
