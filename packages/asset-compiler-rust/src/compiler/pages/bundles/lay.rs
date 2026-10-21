//! The assigned pages laid end to end, linked, hashed and banded: what a container writes.
use super::*;

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

/// How a DAG's pages are assigned and laid (`lay_bundles`): where its vertices are — each
/// cluster's own ball is read off them (`order.rs`) —, the cover that holds each DAG slot — `None`
/// the pinned one; in the world DAG every slot of an actor its HLOD cell's, which holds its root
/// pages while the actor is loaded (`../../../hlod/chain/bundles.rs`) —, the root pages each cover
/// keeps at least, by cover (`root_page_count`: a primitive's mesh's, an HLOD cell's actor's
/// layer's), and the largest world scale its mesh is placed at, 1 for world-space pages: the bands
/// of every mesh in metres.
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
    /// Each DAG slot's page and offset there.
    pub at: Vec<(usize, usize)>,
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

/// The pages of `dag` as `assigned` files them in streaming pages (`assign_pages`, run once, before
/// the culling hierarchy is built over their fill order), linked and checked
/// (`compiler/pages/dependencies.rs`), then laid end to end, each page hashed and banded by its
/// coarsest parent error times `laying.scale`, so the bands of every mesh compare in metres.
/// `pages` holds each DAG slot's cluster page, taken as it is laid: the DAG never holds its bytes
/// twice. `Laid::at` names each slot's page and offset there.
pub(crate) fn lay_bundles<P: AsRef<[u8]> + Default>(
    (dag, groups): (&[DagCluster], &[DagGroup]),
    mut pages: Vec<P>,
    (assigned, laying): (Assignment, &Laying),
) -> Result<Laid> {
    let page_of = assigned.page_of;
    let direct = direct_dependencies(dag, groups, (&page_of, assigned.pages.len()), laying.held);
    let bound = direct.iter().map(Vec::len).max().unwrap_or(0);
    let closed = close_dependencies(&direct)?;
    verify_dependencies(dag, groups, (&page_of, &assigned.root), &closed)?;
    let mut payload = Vec::with_capacity(pages.iter().map(|page| page.as_ref().len()).sum());
    let (mut bundles, mut at) = (Vec::with_capacity(closed.len()), vec![(0, 0); dag.len()]);
    for (index, (members, dependencies)) in assigned.pages.iter().zip(closed).enumerate() {
        let start = payload.len();
        let mut coarsest = f64::NEG_INFINITY;
        for &slot in members {
            at[slot] = (index, payload.len() - start);
            payload.extend_from_slice(std::mem::take(&mut pages[slot]).as_ref());
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
        pinned: assigned.pinned,
        root: assigned.root,
        bound,
        bundle_of: page_of,
    })
}
