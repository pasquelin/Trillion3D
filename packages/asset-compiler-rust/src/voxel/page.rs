//! An HLOD cell's voxel levels as world pages and the DAG over them: the pages the runtime reads
//! as it reads a primitive's voxel pages, written by the page codec's one encoder
//! (`trillion3d_page_codec::voxel`, the same words as `sdk-core/src/page/voxelPage.ts`), and the
//! groups the one cut swaps them by.
//!
//! The DAG, from the coarsest level down: its pages, as many bricks to a page as it holds, are
//! roots; each page of a level below it is made of the bricks under one page above — a brick under
//! the page holding the brick a level up that holds it, or the nearest brick there when that one
//! kept no voxel (`nearest_page`) —, and the pages under one page above are that page's group's
//! children, the page its one output. Each page is drawn at its voxels' error and replaced at the
//! level above's, through its group's ball, the ball of its children's and its own box.
use super::levels::{LevelBrick, VoxelLevel};
use super::ERROR_PER_SIZE;
use crate::dag::{DagCluster, DagGroup};
use std::collections::{BTreeMap, HashMap};
use trillion3d_math::geometry::sphere::merge_spheres;
use trillion3d_page_codec::hash::WordMap;
use trillion3d_page_codec::voxel::{encode_voxel_page, VoxelBrick, VoxelPage, VOXEL_PAGE_BRICKS};

/// The page of `bricks` of a level of voxels `side` wide.
fn encode(bricks: &[&LevelBrick], side: f64) -> VoxelPage {
    let bricks: Vec<VoxelBrick<'_>> = (bricks.iter())
        .map(|b| VoxelBrick {
            at: b.at,
            mask: b.mask,
            joint: b.joint,
            records: b.records.as_flattened(),
        })
        .collect();
    encode_voxel_page(&bricks, side)
}

/// The page among `page_of` — by the corner of each brick of the level above, all within
/// `bounds` — holding the brick nearest `parent`, ties to the least page: searched shell by shell
/// around it, each shell a step wider, and past the first holding one only as far as a nearer
/// brick may still lie, never over every page.
fn nearest_page(
    page_of: &WordMap<[i32; 3], usize>,
    (low, high): ([i32; 3], [i32; 3]),
    parent: [i32; 3],
) -> Option<usize> {
    let span = (0..3)
        .map(|k| (parent[k] - low[k]).abs().max((high[k] - parent[k]).abs()))
        .max()
        .unwrap_or(0);
    let mut best: Option<(i64, usize)> = None;
    for r in 1..=span {
        // A brick on shell `r` lies at least `r` away: none past `r` can beat one found nearer.
        if best.is_some_and(|(d, _)| d < i64::from(r).pow(2)) {
            break;
        }
        for dz in -r..=r {
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs().max(dy.abs()).max(dz.abs()) != r {
                        continue;
                    }
                    let at = [parent[0] + dx, parent[1] + dy, parent[2] + dz];
                    let Some(&p) = page_of.get(&at) else {
                        continue;
                    };
                    let d = [dx, dy, dz]
                        .iter()
                        .map(|&c| i64::from(c).pow(2))
                        .sum::<i64>();
                    if best.is_none_or(|b| (d, p) < b) {
                        best = Some((d, p));
                    }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// `bricks` of a level in pages, in their order, each holding at most `VOXEL_PAGE_BRICKS` bricks,
/// a `u16` apart.
fn chunks(level: &VoxelLevel, bricks: &[usize]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    let (mut low, mut high) = ([i32::MAX; 3], [i32::MIN; 3]);
    for &b in bricks {
        let brick = &level.bricks[b];
        let (l, h): ([i32; 3], [i32; 3]) = (
            std::array::from_fn(|k| low[k].min(brick.at[k])),
            std::array::from_fn(|k| high[k].max(brick.at[k])),
        );
        let wide = (0..3).any(|k| h[k] - l[k] > i32::from(u16::MAX));
        let full = out
            .last()
            .is_none_or(|page| page.len() == VOXEL_PAGE_BRICKS);
        if full || wide {
            out.push(Vec::new());
            (low, high) = (brick.at, brick.at);
        } else {
            (low, high) = (l, h);
        }
        out.last_mut().expect("a page was pushed").push(b);
    }
    out
}

/// A page of the DAG while it is laid out: its level, its bricks and the page above it.
struct Node {
    level: usize,
    bricks: Vec<usize>,
    above: Option<usize>,
}

/// The DAG of `levels`, finest first: its clusters — each a page, its two box corners the vertices
/// its one triangle names, for the bounds the culling reads —, its groups, those vertices and each
/// cluster's page, in the clusters' order.
pub(crate) struct VoxelDag {
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub positions: Vec<f32>,
    pub pages: Vec<VoxelPage>,
}

/// The DAG over `levels` (above).
pub(crate) fn voxel_dag(levels: &[VoxelLevel]) -> VoxelDag {
    let mut nodes: Vec<Node> = Vec::new();
    let Some(top) = levels.len().checked_sub(1) else {
        return VoxelDag {
            clusters: Vec::new(),
            groups: Vec::new(),
            positions: Vec::new(),
            pages: Vec::new(),
        };
    };
    let all: Vec<usize> = (0..levels[top].bricks.len()).collect();
    for bricks in chunks(&levels[top], &all) {
        nodes.push(Node {
            level: top,
            bricks,
            above: None,
        });
    }
    for k in (0..top).rev() {
        let (level, up) = (&levels[k], &levels[k + 1]);
        let page_of: WordMap<[i32; 3], usize> = (nodes.iter().enumerate())
            .filter(|(_, n)| n.level == k + 1)
            .flat_map(|(p, n)| n.bricks.iter().map(move |&b| (up.bricks[b].at, p)))
            .collect();
        let bounds = (page_of.keys()).fold(([i32::MAX; 3], [i32::MIN; 3]), |(l, h), at| {
            (
                std::array::from_fn(|k| l[k].min(at[k])),
                std::array::from_fn(|k| h[k].max(at[k])),
            )
        });
        let mut under: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (b, brick) in level.bricks.iter().enumerate() {
            let parent = brick.at.map(|c| c.div_euclid(2));
            let page =
                (page_of.get(&parent).copied()).or_else(|| nearest_page(&page_of, bounds, parent));
            under
                .entry(page.expect("a level above holds a brick"))
                .or_default()
                .push(b);
        }
        for (above, bricks) in under {
            for chunk in chunks(level, &bricks) {
                nodes.push(Node {
                    level: k,
                    bricks: chunk,
                    above: Some(above),
                });
            }
        }
    }
    let pages: Vec<VoxelPage> = (nodes.iter())
        .map(|n| {
            let level = &levels[n.level];
            let bricks: Vec<&LevelBrick> = n.bricks.iter().map(|&b| &level.bricks[b]).collect();
            encode(&bricks, level.side)
        })
        .collect();
    let error = |level: usize| levels[level].side * ERROR_PER_SIZE;
    let ball = |p: &VoxelPage| {
        let centre: [f64; 3] = std::array::from_fn(|k| 0.5 * (p.low[k] + p.high[k]));
        let half: f64 = (0..3)
            .map(|k| (0.5 * (p.high[k] - p.low[k])).powi(2))
            .sum::<f64>()
            .sqrt();
        [centre[0], centre[1], centre[2], half]
    };
    // Balls from the finest level up: a page with children takes its group's.
    let mut spheres: Vec<[f64; 4]> = pages.iter().map(ball).collect();
    let mut group_of: HashMap<usize, usize> = HashMap::new();
    let mut groups: Vec<DagGroup> = Vec::new();
    for k in 0..top {
        let children: Vec<usize> = (0..nodes.len()).filter(|&n| nodes[n].level == k).collect();
        let mut by_above: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for n in children {
            let above = nodes[n].above.expect("a page under the top");
            by_above.entry(above).or_default().push(n);
        }
        for (above, children) in by_above {
            let sphere = (children.iter().map(|&c| spheres[c])).fold(spheres[above], merge_spheres);
            spheres[above] = sphere;
            group_of.insert(above, groups.len());
            groups.push(DagGroup {
                level: k + 1,
                error: error(k + 1),
                sphere,
                children,
                outputs: vec![above],
            });
        }
    }
    let mut positions = Vec::with_capacity(pages.len() * 6);
    let clusters = (nodes.iter().enumerate())
        .map(|(n, node)| {
            let v = (positions.len() / 3) as u32;
            positions.extend(pages[n].low.iter().chain(&pages[n].high).map(|&c| c as f32));
            let parent = node.above.map(|a| group_of[&a]);
            DagCluster {
                indices: vec![v, v + 1, v + 1],
                level: node.level,
                lod_error: error(node.level),
                parent_error: parent.map_or(f64::INFINITY, |_| error(node.level + 1)),
                sphere: spheres[n],
                whole_box: None,
                parent_sphere: parent.map_or(spheres[n], |g| groups[g].sphere),
                source_rank: 0,
                group: parent,
                source: group_of.get(&n).copied(),
            }
        })
        .collect();
    VoxelDag {
        clusters,
        groups,
        positions,
        pages,
    }
}
