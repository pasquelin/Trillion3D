//! Every cooked page of a primitive decoded back and held against the source it was cooked from.
//!
//! A page names no source index: each decoded corner is matched to a source vertex. A coarse
//! corner that decodes bit for bit onto a corner of its group's children takes that child corner's
//! vertex — a position the simplification kept —; every other corner takes the source vertex
//! nearest its position, the nearest normal among equally near ones (`Source::nearest`). A page
//! passes when it decodes, when every corner lies in the page's published bounds, when each
//! corner of an exact page lies within half the diagonal of a cell of the page's position grid of
//! its vertex — an encode or decode that moves a vertex fails there —, and,
//! for a coarse page, when every point of its triangles lies near its group's children: within
//! their longest edge plus the group error.
pub(in crate::tests) use super::cooked_page_defects::cooked_page_defects;
use super::cooked_scene::CookedScene;
use super::silhouette::Mesh;
use super::*;
use std::collections::HashMap;
use trillion3d_math::vector::vec3::point_checked;
use trillion3d_page_codec::bits::grid::PageGrid;

pub(super) type Point = [f64; 3];

/// Euclidean distance, on the crate's own vector helpers.
pub(super) fn distance(a: Point, b: Point) -> f64 {
    trillion3d_math::vector::vecn::length(trillion3d_math::vector::vecn::sub(a, b))
}

/// One decoded page: per corner, the source vertex it was matched to, the decoded position and,
/// when the page carries them, the decoded normal.
pub(in crate::tests) struct PageCorners {
    pub source: Vec<u32>,
    pub corners: Vec<Point>,
    pub normals: Option<Vec<Point>>,
    /// The most a corner moves: half the diagonal of a cell of the page's position grid.
    pub error: f64,
    /// The grid the page was quantized on.
    pub grid: PageGrid,
}

/// A primitive's source vertices, bucketed on a grid so a corner finds its nearest in a few cells.
pub(in crate::tests) struct Source<'a> {
    positions: &'a [f32],
    normals: Option<&'a [f32]>,
    cell: f64,
    cells: HashMap<[i64; 3], Vec<u32>>,
}

impl<'a> Source<'a> {
    /// The source of flat `positions` and, when it has them, `normals`.
    pub fn new(positions: &'a [f32], normals: Option<&'a [f32]>) -> Self {
        let points = positions.as_chunks::<3>().0;
        let (low, high) =
            trillion3d_math::geometry::aabb::aabb_of(points.iter().map(|p| p.map(f64::from)));
        let diagonal = trillion3d_math::geometry::aabb::diagonal(low, high);
        // About one vertex a cell over the box's volume.
        let cell = (diagonal / (points.len() as f64).cbrt().max(1.0)).max(1e-9);
        let mut cells: HashMap<[i64; 3], Vec<u32>> = HashMap::new();
        for (index, p) in points.iter().enumerate() {
            let key = p.map(|v| (f64::from(v) / cell).floor() as i64);
            cells.entry(key).or_default().push(index as u32);
        }
        Self {
            positions,
            normals,
            cell,
            cells,
        }
    }

    /// The source vertex nearest `p` and its distance; among those as near, the one whose normal
    /// lies nearest `n`.
    fn nearest(&self, p: Point, n: Option<Point>) -> (u32, f64) {
        let score = |index: u32| {
            let at = point_checked(self.positions, index).expect("a source vertex");
            let turn = match (
                n,
                self.normals
                    .and_then(|normals| point_checked(normals, index)),
            ) {
                (Some(n), Some(own)) => distance(n, own),
                _ => 0.0,
            };
            (distance(p, at), turn)
        };
        let better = |a: (f64, f64), b: (f64, f64)| {
            let tie = 1e-6 * p.iter().map(|v| v.abs()).fold(1.0, f64::max);
            if (a.0 - b.0).abs() <= tie {
                a.1 < b.1
            } else {
                a.0 < b.0
            }
        };
        let key = p.map(|v| (v / self.cell).floor() as i64);
        let mut best: Option<(u32, (f64, f64))> = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    let cell = [key[0] + dx, key[1] + dy, key[2] + dz];
                    for &index in self.cells.get(&cell).into_iter().flatten() {
                        let own = score(index);
                        if best.is_none_or(|(_, b)| better(own, b)) {
                            best = Some((index, own));
                        }
                    }
                }
            }
        }
        // Nothing within a cell: a corner far off its source, searched against every vertex.
        let found = best.filter(|(_, (d, _))| *d <= self.cell).or_else(|| {
            let count = (self.positions.len() / 3) as u32;
            (0..count)
                .map(|index| (index, score(index)))
                .reduce(|a, b| if better(b.1, a.1) { b } else { a })
        });
        let (index, (d, _)) = found.expect("a source vertex");
        (index, d)
    }
}

/// `bytes`, one geometry page, and what it `decoded` to — the vertices it names found, if it names
/// any (`decoded_page`) —, matched to `source`.
pub(in crate::tests) fn page_corners(
    (bytes, decoded): (&[u8], &trillion3d_page_codec::DecodedPage),
    source: &Source,
) -> std::result::Result<PageCorners, String> {
    let header = trillion3d_page_codec::Header::parse(bytes, usize::MAX)
        .map_err(|e| format!("header: {e:?}"))?;
    let position = decoded.attribute(0).expect("position");
    // Rank 1 is the normal, absent on a page that carries none.
    let normal = decoded.attribute(1);
    let at = |values: &[f32], i: u32| -> Point {
        std::array::from_fn(|c| f64::from(values[i as usize * 3 + c]))
    };
    let corners: Vec<Point> = decoded.indices().iter().map(|&i| at(position, i)).collect();
    let normals: Option<Vec<Point>> =
        normal.map(|n| decoded.indices().iter().map(|&i| at(n, i)).collect());
    let source = (corners.iter().enumerate())
        .map(|(k, &p)| source.nearest(p, normals.as_ref().map(|n| n[k])).0)
        .collect();
    Ok(PageCorners {
        source,
        corners,
        normals,
        error: f64::from(header.position.unit()) * 0.5 * 3f64.sqrt(),
        grid: PageGrid {
            position: header.position.precision,
            normal: header.normal_precision,
            tangent: header.tangent_precision,
        },
    })
}

/// A child corner's normal, when it has one, and its vertex.
type Wedge = (Option<[u64; 3]>, u32);

/// Each coarse corner of `pages` that decodes bit for bit onto a corner of its group's children,
/// matched again to that child corner's vertex, the same normal first: a position the
/// simplification kept is the children's vertex, not whichever source vertex lies nearest it —
/// the garden's rings write one column at z = 0 and again at z = −5.9e-17, a single point to the
/// nearest-vertex match. Groups run finest first, so a child is matched before its outputs.
fn rematch(primitive: &Value, pages: &mut [std::result::Result<PageCorners, String>]) {
    let groups = primitive["structure"]["groups"].as_array().expect("groups");
    let level = |page: usize| primitive["pages"][page]["level"].as_u64().unwrap_or(0);
    let ids = |group: &Value, key: &str| -> Vec<usize> {
        let list = group[key].as_array().expect(key).iter();
        list.map(|v| v.as_u64().expect("id") as usize).collect()
    };
    let mut order: Vec<&Value> = groups.iter().collect();
    order.sort_by_key(|&group| ids(group, "outputs").first().map_or(0, |&o| level(o)));
    let bits = |p: Point| p.map(f64::to_bits);
    for group in order {
        // Per decoded child corner, its normal and its vertex.
        let mut kept: HashMap<[u64; 3], Vec<Wedge>> = HashMap::new();
        for child in ids(group, "children") {
            let Some(Ok(d)) = pages.get(child) else {
                continue;
            };
            for (k, (&s, &p)) in d.source.iter().zip(&d.corners).enumerate() {
                let n = d.normals.as_ref().map(|n| bits(n[k]));
                kept.entry(bits(p)).or_default().push((n, s));
            }
        }
        for output in ids(group, "outputs") {
            let Some(Ok(d)) = pages.get_mut(output) else {
                continue;
            };
            for k in 0..d.corners.len() {
                let Some(candidates) = kept.get(&bits(d.corners[k])) else {
                    continue;
                };
                let n = d.normals.as_ref().map(|n| bits(n[k]));
                let same = candidates.iter().find(|(own, _)| *own == n);
                d.source[k] = same.unwrap_or(&candidates[0]).1;
            }
        }
    }
}

/// What each page of `pages` draws, as it decodes: its corners, three per triangle, each with the
/// page's own normal — zero on a page that carries none. What a cut is made of.
pub(in crate::tests) fn drawn(pages: &[std::result::Result<PageCorners, String>]) -> Vec<Mesh> {
    let each = pages.iter().map(|page| {
        let d = page.as_ref().expect("a decoded page");
        let count = d.corners.len();
        Mesh {
            positions: d.corners.clone(),
            normals: (d.normals.clone()).unwrap_or_else(|| vec![[0.0; 3]; count]),
            indices: (0..count as u32).collect(),
        }
    });
    each.collect()
}

/// Every page of cooked `primitive` in `scene`, decoded from its container and matched to the
/// primitive's source, a coarse corner the children kept to their vertex (`rematch`).
pub(in crate::tests) fn cooked_pages(
    scene: &CookedScene,
    primitive: &Value,
) -> Vec<std::result::Result<PageCorners, String>> {
    let (positions, normals) = (scene.positions(primitive), scene.normals(primitive));
    let source = Source::new(&positions, normals.as_deref());
    let cache = scene
        .objects
        .parent()
        .and_then(Path::parent)
        .expect("the cache");
    let pages = primitive["pages"].as_array().expect("pages");
    let mut pages_read = PrimitivePages::new(cache, &scene.result, primitive);
    let mut read: Vec<_> = pages
        .iter()
        .map(|page| {
            let bytes = pages_read.bytes(page);
            let decoded = pages_read.decoded(page);
            page_corners((&bytes, &decoded), &source)
        })
        .collect();
    rematch(primitive, &mut read);
    read
}
