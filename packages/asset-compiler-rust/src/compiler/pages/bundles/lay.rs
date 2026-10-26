//! The assigned pages laid end to end, linked, hashed and banded: what a container writes.
use super::relative::relative_pages;
use super::*;
use std::sync::OnceLock;
use trillion3d_page_codec::refs::{share, Parent, Same, Shelf, MAX_PAIR_RANK};
use trillion3d_page_codec::{PageError, MAGIC};

/// One streaming page as laid: where it starts in its payload, its length, how many cluster pages
/// it holds, the pages it needs (closed up to a root page), its digest, and its precision band
/// (`page_band`) — `None` for a pinned root page.
#[derive(Clone, Debug)]
pub(crate) struct Bundle {
    pub start: usize,
    pub bytes: usize,
    pub count: usize,
    pub dependencies: Vec<usize>,
    pub sha256: [u8; 32],
    pub band: Option<i32>,
}

/// How a DAG's pages are assigned and laid (`lay_bundles`): where its vertices are — each cluster's
/// own ball is read off them (`order.rs`) —, the cover that holds each DAG slot — `None` the pinned
/// one, which a primitive's slots all are: none is held; in the world DAG every slot of an actor
/// its HLOD cell's, which holds its root pages while the actor is loaded
/// (`../../../hlod/chain/bundles.rs`) —, the root pages each cover keeps at least, by cover
/// (`root_page_count`: a primitive's mesh's, an HLOD cell's actor's layer's), and the largest world
/// scale its mesh is placed at, 1 for world-space pages: the bands of every mesh in metres.
pub(crate) struct Laying<'a> {
    pub positions: &'a [f32],
    pub held: &'a dyn Fn(usize) -> Option<usize>,
    pub root_pages: &'a dyn Fn(Option<usize>) -> usize,
    pub scale: f64,
}

/// A DAG's streaming pages laid end to end (`lay_bundles`).
pub(crate) struct Laid {
    /// The pages' bytes, end to end.
    pub payload: Vec<u8>,
    /// The pages, in payload order.
    pub bundles: Vec<Bundle>,
    /// Each DAG slot's page and offset there, in the bytes the pages take on disk, and the length
    /// of each.
    pub at: Vec<(usize, usize)>,
    pub lengths: Vec<usize>,
    /// Each DAG slot's offset in the place its page takes in the pool, resident: the slots before
    /// it in the page, each at the bytes it weighed in the assignment (`Assignment::size`).
    pub resident: Vec<usize>,
    /// The pinned cover's root pages, first: none where cells hold the root pages.
    pub pinned: usize,
    /// Whether each page is a root page of its cover.
    pub root: Vec<bool>,
    /// The most pages one page needs directly.
    pub bound: usize,
    /// The page of every DAG slot.
    pub bundle_of: Vec<usize>,
}

/// The precision band of a page replaced at `parent_error`, in metres: the power of two below it,
/// the lowest band for none. A container lays the bundles past the pinned ones band by band from
/// the coarsest, so what a view needs first lies together, read in few requests.
pub(crate) fn page_band(parent_error: f64) -> i32 {
    if parent_error <= 0.0 {
        return i32::MIN;
    }
    parent_error.log2().floor() as i32
}

/// The refusal of a page the codec cannot share: its code, as a compile's.
fn shared(error: PageError) -> CompilerError {
    CompilerError::new(
        error.code(),
        "A geometry page could not be shared between clusters",
    )
}

/// The pages of `dag` as `assigned` files them in streaming pages (`assign_pages`, run once, before
/// the culling hierarchy is built over their fill order), linked and checked
/// (`compiler/pages/dependencies.rs`), then written and laid end to end, each page hashed and
/// banded by its coarsest parent error times `laying.scale`, so the bands of every mesh compare in
/// metres.
///
/// `pages` holds each DAG slot's cluster page alone, as the encoder wrote it. A streaming page's
/// clusters are written in the order they lie in it, each naming the vertices an earlier one stores
/// and — where the page names the vertices of the pages it depends on (`relative_pages`) — those
/// the clusters of its direct dependencies hold (`trillion3d_page_codec::refs`); a cluster's place
/// for the pairs it is named by is the words from the start of its streaming page's place in the
/// pool. `Laid::at` names each slot's page and offset there, `Laid::lengths` the bytes it takes.
/// A page that is no `WGP3` page — a voxel page — is laid as it is.
pub(crate) fn lay_bundles<P: AsRef<[u8]> + Sync>(
    (dag, groups): (&[DagCluster], &[DagGroup]),
    pages: &[P],
    (assigned, laying): (Assignment, &Laying),
) -> Result<Laid> {
    let page_of = assigned.page_of;
    let direct = direct_dependencies(dag, groups, (&page_of, assigned.pages.len()), laying.held);
    let bound = direct.iter().map(Vec::len).max().unwrap_or(0);
    let closed = close_dependencies(&direct)?;
    verify_dependencies(dag, groups, (&page_of, &assigned.root), &closed)?;
    // Each slot's place in the pool's place of its streaming page, in bytes: the slots before it
    // in the page, each at the bytes it weighed in the assignment (`Assignment::size`).
    let mut resident = vec![0; dag.len()];
    for members in &assigned.pages {
        let mut place = 0;
        for &slot in members {
            resident[slot] = place;
            place += assigned.size[slot].next_multiple_of(4);
        }
    }
    let relative = relative_pages(&assigned.root, &direct);
    let place_of = |slot: usize| (resident[slot] / 4) as u32;
    let geometry = |slot: usize| pages[slot].as_ref().starts_with(&MAGIC.to_le_bytes());
    // The clusters of a streaming page by their vertices, built by the first page that searches it.
    let shelves: Vec<OnceLock<std::result::Result<Shelf, PageError>>> =
        (0..assigned.pages.len()).map(|_| OnceLock::new()).collect();
    let shelf_of = |bundle: usize| {
        shelves[bundle].get_or_init(|| {
            let clusters = (assigned.pages[bundle].iter())
                .filter(|&&slot| geometry(slot))
                .map(|&slot| (place_of(slot), pages[slot].as_ref()))
                .collect();
            Shelf::of(clusters)
        })
    };
    let written: Vec<Vec<Vec<u8>>> = (0..assigned.pages.len())
        .into_par_iter()
        .map(|index| -> Result<Vec<Vec<u8>>> {
            let parents: Vec<Parent> = match relative[index] {
                true => {
                    let mut parents = Vec::new();
                    for &dependency in &direct[index] {
                        // The rank of a streaming page in the list is the pair's; a direct
                        // dependency is always in the closed list.
                        let at = closed[index].binary_search(&dependency).map_err(|_| {
                            CompilerError::new(
                                "INVALID_PAGE_DEPENDENCIES",
                                format!("Bundle {index} depends on {dependency}, not in its list"),
                            )
                        })?;
                        // A pair holds a rank up to `MAX_PAIR_RANK`: a page ranked past it is not
                        // searched, its vertices stored (a larger page, never a wrong vertex).
                        let Some(rank) = u32::try_from(at + 1).ok().filter(|&r| r <= MAX_PAIR_RANK)
                        else {
                            continue;
                        };
                        let shelf = shelf_of(dependency).as_ref().map_err(|&e| shared(e))?;
                        parents.push(Parent { rank, shelf });
                    }
                    parents
                }
                false => Vec::new(),
            };
            let mut same = Same::default();
            (assigned.pages[index].iter())
                .map(|&slot| match geometry(slot) {
                    true => share(pages[slot].as_ref(), place_of(slot), &parents, &mut same)
                        .map_err(shared),
                    false => Ok(pages[slot].as_ref().to_vec()),
                })
                .collect()
        })
        .collect::<Result<_>>()?;
    let mut payload = Vec::with_capacity(written.iter().flatten().map(Vec::len).sum());
    let (mut bundles, mut at) = (Vec::with_capacity(closed.len()), vec![(0, 0); dag.len()]);
    let mut lengths = vec![0; dag.len()];
    for (index, ((members, dependencies), laid_pages)) in
        assigned.pages.iter().zip(closed).zip(written).enumerate()
    {
        let start = payload.len();
        let mut coarsest = f64::NEG_INFINITY;
        for (&slot, page) in members.iter().zip(laid_pages) {
            at[slot] = (index, payload.len() - start);
            lengths[slot] = page.len();
            payload.extend_from_slice(&page);
            coarsest = coarsest.max(dag[slot].parent_error);
        }
        bundles.push(Bundle {
            start,
            bytes: payload.len() - start,
            count: members.len(),
            dependencies,
            sha256: [0; 32],
            band: (index >= assigned.pinned).then(|| page_band(coarsest * laying.scale)),
        });
    }
    // Each bundle hashed once the payload is laid, side by side on the pool.
    bundles
        .par_iter_mut()
        .for_each(|bundle| bundle.sha256 = digest_bytes(&payload[bundle.start..][..bundle.bytes]));
    Ok(Laid {
        payload,
        bundles,
        at,
        lengths,
        resident,
        pinned: assigned.pinned,
        root: assigned.root,
        bound,
        bundle_of: page_of,
    })
}
