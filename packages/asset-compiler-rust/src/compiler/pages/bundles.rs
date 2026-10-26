//! THE PAGE ASSIGNMENT: which clusters share a streaming page — the unit a runtime reads, installs,
//! keeps and drops —, which pages each one needs, and the pages laid end to end: a primitive's
//! geometry pages (`../primitive/pages.rs`) and the world DAG's (`../../hlod/chain/bundles.rs`), one
//! assignment (`assign_pages`) and one layout (`lay_bundles`).
//!
//! Each COVER is assigned on its own, as one resource: a primitive's DAG, or in the world DAG one
//! HLOD cell's actor. Its groups are walked from the coarsest level to the finest (`order.rs`), its
//! roots first as one group, and each group's clusters fill the current page while it holds them,
//! a new page opened past it: a group may spread over several pages, which the run-time cut reads
//! by its members' residency (`sdk-browser/src/geometry/cut/readiness.ts`). A cover's first
//! `root_pages` pages — its mesh's always-resident size, or its HLOD layer's — are its ROOT PAGES,
//! the others streaming pages of `STREAM_BUNDLE_BYTES` and `STREAM_PAGE_CLUSTERS` at most; a page
//! holding one of its roots is a root page too — as is every page before it —, so its root pages
//! always hold a complete cover. Every root page, those too, holds `ROOT_PAGE_BYTES` and
//! `ROOT_PAGE_CLUSTERS` at most. A cluster no empty page holds is refused, its page named.
use crate::dag::bounds::balls_ball;
use crate::dag::{DagCluster, DagGroup};
use crate::*;

mod lay;
mod order;
mod relative;
pub(crate) use lay::{lay_bundles, Bundle, Laying};
use order::{along_diagonal, diagonals, walk_order, Walked};

/// A ROOT PAGE's bounds: the bytes and the clusters it holds at most. The run-time pool holds a
/// root page in a grain of its root region, as wide as the widest root page, these bytes at most
/// (`sdk-browser/src/geometry/pages/pool/placement.ts`).
pub(crate) const ROOT_PAGE_BYTES: usize = 32 * 1024;
pub(crate) const ROOT_PAGE_CLUSTERS: usize = 64;
/// The clusters a streaming page holds at most, beside its bytes (`STREAM_BUNDLE_BYTES`).
pub(crate) const STREAM_PAGE_CLUSTERS: usize = 256;

/// The root pages a cover keeps for an always-resident size of `kib` KiB (`meshBuild`'s
/// `alwaysResidentKib`): the root pages that size fills, rounded up, one at least — 0 keeps one,
/// the least; a size past the mesh keeps every page it has.
pub(crate) fn root_page_count(kib: u32) -> usize {
    let pages = (u64::from(kib) << 10).div_ceil(ROOT_PAGE_BYTES as u64);
    pages.clamp(1, u64::from(u32::MAX)) as usize
}

/// A DAG's pages: each page's DAG slots in the order filled — the order the culling hierarchy is
/// built over —, whether each is a root page of its cover, how many lead — the pinned cover's root
/// pages, first —, the page of every DAG slot and the bytes each weighed in its page.
pub(crate) struct Assignment {
    pub pages: Vec<Vec<usize>>,
    pub root: Vec<bool>,
    pub pinned: usize,
    pub page_of: Vec<usize>,
    pub size: Vec<usize>,
}

/// The pages of `dag`, every slot filed once, before any culling order: the covers in
/// `laying.held`'s order — `None`, the pinned one, first —, each walked and filled on its own
/// (`cover_pages`). `size` is what the cluster at a DAG slot weighs in its page: its encoded
/// page's bytes resident in the pool once installed (`Header::resident_bytes`, not the bytes it
/// takes on disk). Laid by `lay_bundles`, the one assignment its pages and the hierarchy share.
pub(crate) fn assign_pages(
    (dag, groups): (&[DagCluster], &[DagGroup]),
    laying: &Laying,
    size: &dyn Fn(usize) -> usize,
) -> Result<Assignment> {
    let held = laying.held;
    // Each cover's groups: the DAG's, filed by their first member's cover, then the clusters no
    // group holds — its roots — as one group of their own.
    let mut covers: BTreeMap<Option<usize>, Vec<Walked>> = BTreeMap::new();
    let mut grouped = vec![false; dag.len()];
    for group in groups.iter().filter(|group| !group.children.is_empty()) {
        group
            .children
            .iter()
            .for_each(|&child| grouped[child] = true);
        let level = (group.children.iter())
            .map(|&child| dag[child].level)
            .max()
            .unwrap_or(0);
        let centre = [group.sphere[0], group.sphere[1], group.sphere[2]];
        let members = group.children.clone();
        let walked = Walked {
            level,
            centre,
            members,
        };
        covers
            .entry(held(group.children[0]))
            .or_default()
            .push(walked);
    }
    let mut roots: BTreeMap<Option<usize>, Vec<usize>> = BTreeMap::new();
    for slot in (0..dag.len()).filter(|&slot| !grouped[slot]) {
        roots.entry(held(slot)).or_default().push(slot);
    }
    for (cover, members) in roots {
        let level = members
            .iter()
            .map(|&root| dag[root].level)
            .max()
            .unwrap_or(0);
        let spheres: Vec<[f64; 4]> = members.iter().map(|&root| dag[root].sphere).collect();
        let ball = balls_ball(&spheres);
        let walked = Walked {
            level,
            centre: [ball[0], ball[1], ball[2]],
            members,
        };
        covers.entry(cover).or_default().push(walked);
    }
    let mut assigned = Assignment {
        pages: Vec::new(),
        root: Vec::new(),
        pinned: 0,
        page_of: vec![usize::MAX; dag.len()],
        size: vec![0; dag.len()],
    };
    let along = diagonals(dag, laying.positions);
    for (cover, walked) in covers {
        let least = (laying.root_pages)(cover);
        let roots = cover_pages((walked, &grouped, &along), least, size, &mut assigned)?;
        if cover.is_none() {
            assigned.pinned = roots;
        }
    }
    if let Some(slot) = assigned.page_of.iter().position(|&page| page == usize::MAX) {
        return Err(CompilerError::new(
            "INVALID_PAGE_DEPENDENCIES",
            format!("Cluster {slot} sits in no streaming page"),
        ));
    }
    Ok(assigned)
}

/// One cover's pages behind `assigned`'s, by DAG slot: its groups `walked` in walk order
/// (`walk_order`), each group's clusters along the diagonal (`along_diagonal`, `along` each slot's
/// place on it), each cluster into the current page while it holds its bytes (`size` of its slot)
/// and one more cluster, else into a new page — the cover's first `least` root pages
/// (`Laying::root_pages`), the others streaming pages. Its root pages are marked: those first
/// ones, and every page up to the last holding a cluster no group holds (`grouped`); every one of
/// them, a page a root lands in and those before it included, holds a root page's bytes and
/// clusters at most. Returns how many they are.
fn cover_pages(
    (mut walked, grouped, along): (Vec<Walked>, &[bool], &[f32]),
    least: usize,
    size: &dyn Fn(usize) -> usize,
    assigned: &mut Assignment,
) -> Result<usize> {
    let first = assigned.pages.len();
    let limits = |page: usize, root: bool| {
        if root || page - first < least {
            (ROOT_PAGE_BYTES, ROOT_PAGE_CLUSTERS)
        } else {
            (STREAM_BUNDLE_BYTES, STREAM_PAGE_CLUSTERS)
        }
    };
    assigned.pages.push(Vec::new());
    let (mut bytes, mut last_root) = (0usize, first);
    for at in walk_order(&walked) {
        let members = &mut walked[at].members;
        along_diagonal(members, along);
        for &slot in members.iter() {
            let page = assigned.pages.len() - 1;
            let cluster_bytes = size(slot);
            // A root's page, and every page up to the last one a root landed in, is a root page.
            let (most_bytes, most_clusters) = limits(page, !grouped[slot] || page <= last_root);
            let full = assigned.pages[page].len() + 1 > most_clusters;
            // A page still empty takes any cluster, however heavy: the refusal below names it.
            let over = full || bytes + cluster_bytes > most_bytes;
            if over && !assigned.pages[page].is_empty() {
                assigned.pages.push(Vec::new());
                bytes = 0;
            }
            let page = assigned.pages.len() - 1;
            let (most_bytes, _) = limits(page, !grouped[slot] || page <= last_root);
            if cluster_bytes > most_bytes {
                return Err(CompilerError::new(
                    "CLUSTER_PAGE_TOO_LARGE",
                    format!(
                        "Cluster {slot} weighs {cluster_bytes} bytes, past the {most_bytes} \
                         bytes of its page"
                    ),
                ));
            }
            assigned.pages[page].push(slot);
            assigned.page_of[slot] = page;
            assigned.size[slot] = cluster_bytes;
            bytes += cluster_bytes;
            if !grouped[slot] {
                last_root = last_root.max(page);
            }
        }
    }
    let count = assigned.pages.len() - first;
    let roots = least.min(count).max(last_root + 1 - first);
    assigned.root.extend((0..count).map(|page| page < roots));
    Ok(roots)
}
