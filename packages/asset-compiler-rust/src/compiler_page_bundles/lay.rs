//! The packed bundles laid end to end, linked, hashed and banded: what a container writes.
use super::*;

/// One streaming bundle as laid: where it starts in its payload, its length, how many pages it
/// holds, the bundles it needs (closed up to the root cover), its digest, and its precision band
/// (`page_band`) — `None` for a pinned bundle of roots.
#[derive(Clone, Debug)]
pub(crate) struct Bundle {
    pub start: usize,
    pub bytes: usize,
    pub count: usize,
    pub dependencies: Vec<usize>,
    pub sha256: [u8; 32],
    pub band: Option<i32>,
}

/// A DAG's pages in streaming bundles laid end to end (`lay_bundles`).
pub(crate) struct Laid {
    /// The written bundles' bytes, end to end.
    pub payload: Vec<u8>,
    /// The written bundles, in payload order: the first ones, whose ranks all have a page.
    pub bundles: Vec<Bundle>,
    /// Each culling rank's bundle and offset there; `None` for a rank without a page.
    pub at: Vec<Option<(usize, usize)>>,
    /// The bundles of the pinned root cover, first.
    pub pinned: usize,
    /// The most bundles a bundle needs directly, fixed before packing (`dependency_bound`).
    pub bound: usize,
    /// The bundle of every DAG slot, the unwritten ones' too.
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

/// The pages of `dag` in culling `order` packed in streaming bundles (`pack_bundles`), linked and
/// checked (`compiler_bundle_dependencies.rs`), then laid end to end, each bundle hashed and banded
/// by its coarsest parent error times `scale` — the largest world scale its mesh is placed at, 1 for
/// world-space pages —, so the bands of every mesh compare in metres. `pages` holds each rank's page,
/// taken as it is laid: the DAG never holds its bytes twice. A rank without a page — a placed
/// object's cluster in the world DAG, whose pages are its primitive's own — weighs its indices, four
/// bytes each, and lies in a bundle never written: those bundles come last, past every written one.
/// `held` names, by slot, the cell of a root packed past the pinned top.
pub(crate) fn lay_bundles<P: AsRef<[u8]>>(
    (dag, groups): (&[DagCluster], &[DagGroup]),
    order: &[usize],
    mut pages: Vec<Option<P>>,
    held: &dyn Fn(usize) -> Option<usize>,
    scale: f64,
) -> Result<Laid> {
    let size = |rank: usize| {
        pages[rank]
            .as_ref()
            .map_or(dag[order[rank]].indices.len() * 4, |page| {
                page.as_ref().len()
            })
    };
    let bound = dependency_bound(dag, groups);
    let (packed, pinned, bundle_of) = pack_bundles(dag, groups, order, bound, (&size, held))?;
    let closed = close_dependencies(&direct_dependencies(dag, groups, &bundle_of, packed.len()))?;
    verify_dependencies(dag, groups, order, &bundle_of, &closed, pinned)?;
    let written = (packed.iter())
        .position(|members| members.iter().all(|&rank| pages[rank].is_none()))
        .unwrap_or(packed.len());
    let mut payload = Vec::with_capacity(pages.iter().flatten().map(|p| p.as_ref().len()).sum());
    let (mut bundles, mut at) = (Vec::with_capacity(written), vec![None; order.len()]);
    for (index, (members, dependencies)) in packed.iter().zip(closed).enumerate() {
        let start = payload.len();
        let mut coarsest = f64::NEG_INFINITY;
        for &rank in members {
            let page = match (index < written, pages[rank].take()) {
                (true, Some(page)) => page,
                (false, None) => continue,
                _ => {
                    return Err(CompilerError::new(
                        "INVALID_PAGE_DEPENDENCIES",
                        format!(
                            "Page {rank} sits in streaming bundle {index}, written whole or not at \
                             all, among ranks of the other kind"
                        ),
                    ))
                }
            };
            at[rank] = Some((index, payload.len() - start));
            payload.extend_from_slice(page.as_ref());
            coarsest = coarsest.max(dag[order[rank]].parent_error);
        }
        if index < written {
            bundles.push(Bundle {
                start,
                bytes: payload.len() - start,
                count: members.len(),
                dependencies,
                sha256: digest_bytes(&payload[start..]),
                band: (index >= pinned).then(|| page_band(coarsest * scale)),
            });
        }
    }
    Ok(Laid {
        payload,
        bundles,
        at,
        pinned,
        bound,
        bundle_of,
    })
}
