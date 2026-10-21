//! Where a chart goes in the atlas: the place, upright or turned, that overlaps nothing and keeps
//! the atlas smallest — the metric is the square of the larger side of the extent used with the
//! chart, plus that extent's area.
//!
//! While the extent used holds at most 4096 texels every place up to one texel past it is tried,
//! upright then turned, row by row; a place of equal metric wins only nearer the origin (by the
//! larger coordinate), and a place inside the extent used ends the search. Past that, 4096 places
//! are drawn from Marsaglia's KISS generator (its standard seeds, set once per packing): turned or
//! not, then a column and a row up to one past the extent used; a place of equal metric wins
//! unless farther from the origin by the smaller coordinate, and a place inside the extent ends the
//! search. No place found leaves the chart at the origin with no size.
use super::super::raster::Bits;
use trillion3d_math::sequence::random::xorshift32;

/// How many texels the extent used may hold for every place to be tried, and how many places are
/// drawn past that.
const ATTEMPTS: i32 = 4096;

/// Marsaglia's KISS generator: a congruential, a xorshift and a multiply-with-carry part.
pub(super) struct Kiss {
    x: u32,
    y: u32,
    z: u32,
    c: u32,
}

impl Kiss {
    pub(super) fn new() -> Kiss {
        Kiss {
            x: 123456789,
            y: 362436000,
            z: 521288629,
            c: 7654321,
        }
    }

    /// A draw in `[0, range]`; zero, drawing nothing, when `range` is zero.
    fn range(&mut self, range: u32) -> u32 {
        if range == 0 {
            return 0;
        }
        self.x = self.x.wrapping_mul(69069).wrapping_add(12345);
        xorshift32(&mut self.y);
        let t = 698769069u64 * u64::from(self.z) + u64::from(self.c);
        self.c = (t >> 32) as u32;
        self.z = t as u32;
        self.x.wrapping_add(self.y).wrapping_add(self.z) % range.wrapping_add(1)
    }
}

/// A chart's place: its corner, its size there, and whether it is turned.
#[derive(Clone, Copy, Default)]
pub(super) struct Place {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) w: i32,
    pub(super) h: i32,
    pub(super) turned: bool,
}

/// The place of the chart `image` (and `turned`, its axes swapped) in `atlas`, whose extent used
/// is `used`.
pub(super) fn find_place(
    atlas: &Bits,
    image: &Bits,
    turned: &Bits,
    used: [i32; 2],
    draws: &mut Kiss,
) -> Place {
    let [w, h] = used;
    let mut best = Place::default();
    let mut best_metric = i32::MAX;
    // The place `(x, y)`, upright or turned, kept when its metric beats the best's (`tie_loses`
    // deciding an equal one against it) and it fits; `true` when it lies inside the extent used,
    // which ends the search.
    let mut consider = |x: i32, y: i32, turn: bool, tie_loses: fn(&Place, i32, i32) -> bool| {
        let stamp = if turn { turned } else { image };
        let (cw, ch) = (stamp.width as i32, stamp.height as i32);
        let (extent_x, extent_y) = (w.max(x + cw), h.max(y + ch));
        let area = extent_x * extent_y;
        let side = extent_x.max(extent_y);
        let metric = side * side + area;
        if metric > best_metric
            || (metric == best_metric && tie_loses(&best, x, y))
            || !atlas.fits_at(stamp, x as u32, y as u32)
        {
            return false;
        }
        best_metric = metric;
        best = Place {
            x,
            y,
            w: cw,
            h: ch,
            turned: turn,
        };
        area == w * h
    };
    if ATTEMPTS >= w * h {
        let not_nearer = |best: &Place, x: i32, y: i32| x.max(y) >= best.x.max(best.y);
        'search: for turn in [false, true] {
            for y in 0..=h + 1 {
                for x in 0..=w + 1 {
                    if consider(x, y, turn, not_nearer) {
                        break 'search;
                    }
                }
            }
        }
    } else {
        let farther = |best: &Place, x: i32, y: i32| x.min(y) > best.x.min(best.y);
        for _ in 0..ATTEMPTS {
            let turn = draws.range(1) == 1;
            let x = draws.range((w + 1) as u32) as i32;
            let y = draws.range((h + 1) as u32) as i32;
            if consider(x, y, turn, farther) {
                break;
            }
        }
    }
    best
}
