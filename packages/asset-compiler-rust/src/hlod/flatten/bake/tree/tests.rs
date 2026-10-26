//! The tree's queries against testing every triangle: on soups that hold ties — shared edges,
//! doubled triangles — and on rays that run along an axis.
use super::queries::beats;
use super::Tree;
use trillion3d_math::geometry::triangle::{closest_point, ray_triangle};
use trillion3d_math::sequence::random::xorshift64;
use trillion3d_math::vector::vecn::distance2;

/// A small deterministic generator: no two runs differ.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        (xorshift64(&mut self.0) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn between(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.next()
    }
}

/// `count` small triangles scattered in a box of side 10.
fn scattered(count: usize) -> Vec<f32> {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut soup = Vec::new();
    for _ in 0..count {
        let base = [0, 1, 2].map(|_| rng.between(0.0, 10.0));
        for _ in 0..3 {
            soup.extend(base.map(|c| (c + rng.between(-1.5, 1.5)) as f32));
        }
    }
    soup
}

/// A `side` by `side` grid of unit quads at height 1, two triangles each: every interior edge and
/// vertex is shared by several, so a ray along an axis through a lattice point meets ties.
fn lattice(side: usize) -> Vec<f32> {
    let mut soup = Vec::new();
    for i in 0..side {
        for j in 0..side {
            let (x, y) = (i as f32, j as f32);
            for t in [
                [(0., 0.), (1., 0.), (0., 1.)],
                [(1., 0.), (1., 1.), (0., 1.)],
            ] {
                soup.extend(t.iter().flat_map(|&(dx, dy)| [x + dx, 1.0, y + dy]));
            }
        }
    }
    soup
}

/// `soup` with every triangle twice, one after the other: every hit is a tie of two slots.
fn doubled(soup: &[f32]) -> Vec<f32> {
    soup.chunks(9)
        .flat_map(|t| t.iter().chain(t))
        .copied()
        .collect()
}

/// Rays through the soup's box: random ones, and ones along each axis through lattice points and
/// through their middles.
fn rays(rng: &mut Rng) -> Vec<([f64; 3], [f64; 3])> {
    let mut rays = Vec::new();
    for _ in 0..400 {
        let origin = [0, 1, 2].map(|_| rng.between(-1.0, 11.0));
        let ray = [0, 1, 2].map(|_| rng.between(-12.0, 12.0));
        rays.push((origin, ray));
    }
    for axis in 0..3 {
        for i in 0..12 {
            for j in 0..12 {
                for shift in [0.0, 0.5] {
                    let mut origin = [0.0; 3];
                    origin[axis] = -1.0;
                    origin[(axis + 1) % 3] = f64::from(i) + shift;
                    origin[(axis + 2) % 3] = f64::from(j) + shift;
                    let mut ray = [0.0; 3];
                    ray[axis] = 4.0 * rng.between(0.5, 3.0);
                    rays.push((origin, ray));
                }
            }
        }
    }
    rays
}

fn soups() -> Vec<Vec<f32>> {
    let lattice = lattice(9);
    vec![
        scattered(1),
        scattered(2),
        scattered(300),
        scattered(2_000),
        doubled(&lattice),
        lattice,
    ]
}

/// One cast of the first-hit test: the tree of a soup, a ray, the near end and the triangle skipped.
struct Cast<'a> {
    tree: &'a Tree,
    line: ([f64; 3], [f64; 3]),
    near: f64,
    skip: Option<usize>,
}

/// Every cast the first-hit test makes: the same soups and rays, near ends 0 and one drawn, a
/// triangle skipped half the time.
fn for_each_cast(mut check: impl FnMut(&Cast<'_>)) {
    let mut rng = Rng(7);
    for soup in soups() {
        let tree = Tree::from_soup(soup);
        let slots = tree.order.len();
        for line in rays(&mut rng) {
            let skip = (rng.next() < 0.5).then(|| (rng.next() * slots as f64) as usize % slots);
            for near in [0.0, rng.between(0.0, 0.6)] {
                check(&Cast {
                    tree: &tree,
                    line,
                    near,
                    skip,
                });
            }
        }
    }
}

// Behaviour: the first hit is what testing every triangle gives — the nearest `t`, a tie decided
// by `beats`, the lower slot — whatever the order the boxes are entered in, on rays that run along
// a box's faces too.
#[test]
fn the_first_hit_is_the_one_testing_every_triangle_gives() {
    for_each_cast(|cast| {
        let Cast {
            tree,
            line,
            near,
            skip,
        } = *cast;
        let mut best: Option<(f64, usize)> = None;
        for slot in (0..tree.order.len()).filter(|&s| Some(s) != skip) {
            let met = ray_triangle(line.0, line.1, tree.corners(slot), (near, 1.0));
            if let Some((t, _)) = met {
                if beats(best, (t, slot)) {
                    best = Some((t, slot));
                }
            }
        }
        assert_eq!(best, tree.first_hit_beyond(line, near, skip), "{line:?}");
    });
}

// Behaviour: whether a ray meets any triangle for `t > 0` is what testing every triangle gives.
#[test]
fn blocked_is_whether_any_triangle_is_met() {
    let mut rng = Rng(11);
    for soup in soups() {
        let tree = Tree::from_soup(soup);
        for (origin, ray) in rays(&mut rng) {
            let any = (0..tree.order.len()).any(|slot| {
                ray_triangle(origin, ray, tree.corners(slot), (0.0, f64::INFINITY)).is_some()
            });
            assert_eq!(tree.blocked((origin, ray)), any, "{origin:?} {ray:?}");
        }
    }
}

// Behaviour: the squared distance to the nearest triangle under a limit, its point, and the
// closest point are what measuring every triangle gives.
#[test]
fn the_nearest_point_is_the_one_measuring_every_triangle_gives() {
    let mut rng = Rng(23);
    for soup in soups() {
        let tree = Tree::from_soup(soup);
        for _ in 0..300 {
            let point = [0, 1, 2].map(|_| rng.between(-2.0, 12.0));
            let nearest = |limit2: f64| {
                (0..tree.order.len()).fold((limit2, None), |best, slot| {
                    let [a, b, c] = tree.corners(slot);
                    let p = closest_point(point, a, b, c);
                    let d = distance2(p, point);
                    if d < best.0 {
                        (d, Some(p))
                    } else {
                        best
                    }
                })
            };
            for limit2 in [0.25, 4.0, f64::INFINITY] {
                assert_eq!(
                    tree.nearest(point, limit2).0,
                    nearest(limit2).0,
                    "{point:?} within {limit2}"
                );
            }
            let found = tree.closest(point);
            assert_eq!(distance2(found, point), nearest(f64::INFINITY).0);
        }
    }
}
