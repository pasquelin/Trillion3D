//! What a group inherits from its children drawn as voxels: a group whose child is a group of
//! voxels takes its candidate cells from that child's voxels and from the cells it remembers
//! (`Boxes`), not from triangles; only a group none of whose children is voxels — the first voxel
//! level — takes them from its triangles. A child's voxel stands for the cells of the group's own
//! side that its box overlaps, and a cell the child had no voxel in but remembered is tried again.
use super::super::bricks::Brick;
use super::super::raster::{cells, Cell};
use super::super::seed::SeedGroup;
use super::Voxelized;
use crate::trace::tracer::{vertex, World};
use trillion3d_math::vector::vecn::sub;
use trillion3d_page_codec::hash::WordSet;

/// The voxel boxes a group takes from the children of one voxel group: those voxels' cells, and
/// the cells it remembered, on its own grid (`side`). The group's other children after the first
/// of the same voxel group hold none: the voxels of the group are gathered once.
#[derive(Default)]
pub(super) struct Boxes {
    side: f64,
    voxels: Vec<Cell>,
    remembered: Vec<Cell>,
}

/// The parent a brick is replaced with: the group the output of its own group nearest it is a
/// child of, `parents` the outputs' centres and the groups they are children of.
pub(super) fn parent_of(brick: &Brick, side: f64, parents: &[([f64; 3], usize)]) -> Option<usize> {
    let centre = brick.at.map(|c| (f64::from(c) * 4.0 + 2.0) * side);
    let distance = |at: [f64; 3]| {
        let d = sub(at, centre);
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    };
    let nearest = parents
        .iter()
        .min_by(|a, b| distance(a.0).total_cmp(&distance(b.0)));
    nearest.map(|&(_, group)| group)
}

impl Boxes {
    /// What group `owner` takes from `child`, drawn as voxels: the voxels of the bricks replaced
    /// with the outputs `owner` holds, and — carried by the child's first output, as its extra
    /// voxels are — the cells it remembered when that output is `owner`'s.
    pub(super) fn of(child: &Voxelized, parents: &[([f64; 3], usize)], owner: usize) -> Self {
        let held = |brick: &&Brick| parent_of(brick, child.side, parents) == Some(owner);
        let voxels = (child.bricks.iter().filter(held))
            .flat_map(|brick| brick.voxels.iter().map(|&v| child.voxels[v].cell))
            .collect();
        let first = parents.first().is_some_and(|p| p.1 == owner);
        Self {
            side: child.side,
            voxels,
            remembered: if first {
                child.remembered.clone()
            } else {
                Vec::new()
            },
        }
    }

    /// Calls `visit` with each cell of side `side` a box of these voxels overlaps, a voxel's
    /// before the next, the remembered cells' last: the cells from the lowest to the highest the
    /// box reaches on each axis — one it only touches reached too —, `x` the fastest.
    fn cells(&self, side: f64, mut visit: impl FnMut(Cell)) {
        let (half, rcp) = (0.5 * self.side, 1.0 / side);
        for &cell in self.voxels.iter().chain(&self.remembered) {
            let centre = cell.map(|c| (f64::from(c) + 0.5) * self.side);
            let low = centre.map(|c| ((c - half) * rcp).floor() as i32);
            let high = centre.map(|c| ((c + half) * rcp).floor() as i32);
            for z in low[2]..=high[2] {
                for y in low[1]..=high[1] {
                    for x in low[0]..=high[0] {
                        visit([x, y, z]);
                    }
                }
            }
        }
    }
}

/// The candidate cells of `group` at side `side`, each once, in the order they are found: its
/// children's in turn — a child drawn as voxels by its `inherited` boxes, `(child, boxes)` in
/// child order, any other by the cells its triangles overlap, ranks from `start` in `world`.
pub(super) fn candidates(
    world: &World,
    (group, inherited): (&SeedGroup, &[(usize, Boxes)]),
    start: usize,
    side: f64,
) -> Vec<Cell> {
    let (mut found, mut out) = (WordSet::<Cell>::default(), Vec::new());
    let mut add = |c: Cell| {
        if found.insert(c) {
            out.push(c);
        }
    };
    let mut voxels = inherited.iter().peekable();
    for child in 0..group.children.len() {
        if let Some((_, boxes)) = voxels.next_if(|(c, _)| *c == child) {
            boxes.cells(side, &mut add);
            continue;
        }
        for &t in group.child_triangles(child) {
            let corners = [0, 1, 2].map(|k| vertex(world, start + t as usize, k));
            cells(corners, side, &mut add);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::super::sample::{Moments, FACES};
    use super::super::super::solid::Voxel;
    use super::*;

    /// A group of voxels at `cells` of side 1, each in a brick of its own at the brick holding it,
    /// remembering `remembered`.
    fn drawn(cells: &[Cell], remembered: Vec<Cell>) -> Voxelized {
        let voxel = |cell: Cell| Voxel {
            cell,
            coverage: 1.0,
            faces: [Moments::default(); FACES],
            shown: Moments::default(),
            joint: None,
        };
        let brick = |i: usize| Brick {
            at: cells[i].map(|c| c.div_euclid(4)),
            mask: 1,
            voxels: vec![i],
            joint: None,
        };
        Voxelized {
            primitive: Some(0),
            group: 3,
            level: 1,
            triangle_error: 1.0,
            forced: false,
            side: 1.0,
            voxels: cells.iter().map(|&c| voxel(c)).collect(),
            bricks: (0..cells.len()).map(brick).collect(),
            brick_parents: Vec::new(),
            remembered,
        }
    }

    // Behaviour: a group takes the voxels of the bricks replaced with the outputs it holds — the
    // nearest output of the child's group, by its centre — and the cells the child remembered when
    // its first output is the group's: two groups above one child share its voxels, and the
    // remembered cells go to the first output's alone.
    #[test]
    fn a_group_takes_the_voxels_of_the_bricks_its_outputs_replace() {
        let child = drawn(&[[0, 0, 0], [40, 0, 0]], vec![[7, 7, 7]]);
        // Two outputs, each a child of a group: bricks at 2 and 42 sides along x.
        let parents = [([2.0, 2.0, 2.0], 7), ([42.0, 2.0, 2.0], 8)];
        let (first, second) = (
            Boxes::of(&child, &parents, 7),
            Boxes::of(&child, &parents, 8),
        );
        assert_eq!(
            (first.voxels, first.remembered),
            (vec![[0, 0, 0]], vec![[7, 7, 7]])
        );
        assert_eq!(
            (second.voxels, second.remembered),
            (vec![[40, 0, 0]], Vec::new())
        );
    }

    // Behaviour: a voxel of side 1 stands for the cells of side 1/2 its box overlaps or touches —
    // a box from 0 to 1 reaches the cells 0 to 2 —, x the fastest, a voxel's cells before the
    // next's and the remembered cells' last.
    #[test]
    fn a_voxel_box_reaches_the_cells_it_overlaps_and_touches() {
        let boxes = Boxes {
            side: 1.0,
            voxels: vec![[0, 0, 0]],
            remembered: vec![[5, 0, 0]],
        };
        let mut found = Vec::new();
        boxes.cells(0.5, |cell| found.push(cell));
        assert_eq!(found.len(), 54);
        assert_eq!(found[..3], [[0, 0, 0], [1, 0, 0], [2, 0, 0]]);
        assert_eq!(found[3], [0, 1, 0]);
        assert_eq!(found[26], [2, 2, 2]);
        assert_eq!(found[27], [10, 0, 0]);
        // Wider cells of side 2: the first box lies in one, the remembered cell's reaches two.
        let mut wide = Vec::new();
        boxes.cells(2.0, |cell| wide.push(cell));
        assert_eq!(wide, [[0, 0, 0], [2, 0, 0], [3, 0, 0]]);
    }
}
