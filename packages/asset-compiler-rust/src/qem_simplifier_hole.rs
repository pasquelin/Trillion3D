//! The hole one collapse opens (`ghosts.rs`): the cubes a class reads around the gathered
//! triangles, and what each ghost there is left from the live surface once the collapse is made.
use super::super::live::{distance_to, Corners, Live, Surface, W};
use super::{cube, cube_side};
use super::{Alt, Class, Ghost, Hit, NONE, P};
use crate::join::Join;

/// The squared distance from `p` to the box `low..high`.
fn box_distance2(p: P, low: P, high: P) -> f32 {
    (0..3)
        .map(|a| (low[a] - p[a]).max(0.0).max(p[a] - high[a]).powi(2))
        .sum()
}

/// The triangle of `tris` nearest to `p`, and its squared distance.
pub(super) fn nearest_of(p: W, tris: impl Iterator<Item = (u32, Corners)>) -> (f64, u32) {
    tris.map(|(tri, corners)| (distance_to(p, corners), tri))
        .fold((f64::INFINITY, NONE), |a, b| if b.0 < a.0 { b } else { a })
}

/// The cubes of `class` within its largest size of the box `low..high`, into `keys`: by the box,
/// or by the class's occupied cubes when they are fewer.
pub(super) fn class_keys(class: &Class, (low, high): (P, P), keys: &mut Vec<[u32; 4]>) {
    keys.clear();
    let reach = 2f32.powi(class.class + 1);
    let side = cube_side(class.class);
    let lo = cube(class.class, low.map(|x| x - reach), side);
    let hi = cube(class.class, high.map(|x| x + reach), side);
    let axis = |a: usize| lo[a] as i32..=hi[a] as i32;
    let span = (1..4).fold(1u64, |n, a| {
        n.saturating_mul(u64::from((hi[a] as i32).abs_diff(lo[a] as i32)) + 1)
    });
    if span as usize > class.cubes.len() {
        let inside = |k: &&[u32; 4]| (1..4).all(|a| axis(a).contains(&(k[a] as i32)));
        keys.extend(class.cubes.iter().filter(inside));
        return;
    }
    for x in axis(1) {
        for y in axis(2) {
            keys.extend(axis(3).map(|z| [lo[0], x as u32, y as u32, z as u32]));
        }
    }
}

/// The collapse a hole is measured for: its gathered triangles, their piece and box, its two
/// ends and where they go, and whether it is made.
pub(super) struct Collapse<'s, 'a> {
    pub surface: &'s Surface<'a>,
    pub piece: &'s [usize],
    pub own: u32,
    pub bounds: (P, P),
    pub ends: [P; 2],
    pub to: P,
    pub made: bool,
}

impl Collapse<'_, '_> {
    /// The squared distance from `p` to the gathered triangles as the collapse leaves them, the
    /// flattened ones gone; `after` lists them the first time.
    pub fn after(&self, p: W, after: &mut Vec<Corners>, listed: &mut bool) -> f64 {
        if !*listed {
            *listed = true;
            after.clear();
            for &tri in self.piece {
                let [a, b, c] = (self.surface.corners(tri)).map(|p| {
                    if self.ends.contains(&p) {
                        self.to
                    } else {
                        p
                    }
                });
                if a != b && b != c && c != a {
                    after.push([a, b, c].map(|p| p.map(f64::from)));
                }
            }
        }
        nearest_of(p, after.iter().map(|&c| (NONE, c))).0
    }
}

/// The squared distance ghost `g` is left from the live surface once `collapse` is made, when it
/// is above `worst` and the collapse opens it; `before` holds the gathered triangles, `after`
/// measures them as the collapse leaves them.
pub(super) fn ghost_hole(
    g: &mut Ghost,
    collapse: &Collapse,
    worst: f64,
    (live, join): (&Live, &mut Join),
    before: &[(u32, Corners)],
    after: &mut impl FnMut(W) -> f64,
) -> Option<f64> {
    let surface = collapse.surface;
    if g.owner != NONE && join.root(g.owner) == collapse.own {
        return None;
    }
    let size2 = g.size * g.size;
    if f64::from(4.0 * size2) <= worst
        || box_distance2(g.p, collapse.bounds.0, collapse.bounds.1) > size2
    {
        return None;
    }
    let (size2, cap2) = (f64::from(size2), 4.0 * f64::from(size2));
    let held = g.witness.filter(|h| live.current(surface, h.tri, h.stamp));
    // The distance to a live triangle outside the gathered ones, as last found.
    let outside =
        (held.filter(|h| !surface.gathered(h.tri as usize))).map_or(f64::INFINITY, |h| h.d2);
    if outside <= worst {
        return None;
    }
    let p = g.p.map(f64::from);
    let (d2, tri) = nearest_of(p, before.iter().copied());
    if d2 > size2 {
        return None;
    }
    if held.is_none_or(|h| d2 < h.d2) {
        let stamp = live.stamps[tri as usize];
        g.witness = Some(Hit { tri, stamp, d2 });
    }
    let settled = worst.max(d2);
    let after = if outside <= settled {
        0.0
    } else {
        after(p).min(cap2)
    };
    if after <= settled {
        return None;
    }
    let own = collapse.own;
    let exact = |generation: u32| !collapse.made || generation == live.generation;
    let kept = match g.alt {
        Alt::Empty {
            root,
            d2,
            generation,
        } if root == own && d2 >= after && exact(generation) => Some(after),
        Alt::Hit {
            hit,
            root,
            generation,
            full,
        } => {
            let stands =
                live.current(surface, hit.tri, hit.stamp) && !surface.gathered(hit.tri as usize);
            let settles = hit.d2 <= settled || (full && root == own && exact(generation));
            (stands && (!collapse.made || settles)).then_some(hit.d2.min(outside).min(after))
        }
        _ => None,
    };
    let found = kept.unwrap_or_else(|| {
        let keep = |t: usize| !surface.gathered(t);
        let (d2, tri) = live.nearest(surface, g.p, settled, after, keep);
        let generation = live.generation;
        g.alt = match tri {
            NONE => Alt::Empty {
                root: own,
                d2: after,
                generation,
            },
            tri => {
                let hit = Hit {
                    tri,
                    stamp: live.stamps[tri as usize],
                    d2,
                };
                Alt::Hit {
                    hit,
                    root: own,
                    generation,
                    full: d2 > settled,
                }
            }
        };
        d2
    });
    (found > settled).then_some(found)
}
