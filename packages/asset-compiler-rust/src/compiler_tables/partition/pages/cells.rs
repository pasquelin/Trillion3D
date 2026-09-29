//! The pages of the cell records (#750): each region page names the mesh pages its cells use
//! (#792).
use super::*;

/// The slots of the mesh pages each mesh's primitives lie in, by mesh rank.
pub(crate) type MeshSlots = BTreeMap<u64, Vec<String>>;

/// The slots of the mesh pages the meshes of ranks `meshes` lie in, sorted and each once: a region
/// page's list (#792), and the scene tables' for the node table (#751).
pub(crate) fn slots_of(
    meshes: impl Iterator<Item = u64>,
    mesh_pages: &MeshSlots,
) -> BTreeSet<&String> {
    meshes
        .filter_map(|mesh| mesh_pages.get(&mesh))
        .flatten()
        .collect()
}

/// Writes the pages of the cells `tree` halved, whose records and world boxes are `records` and
/// `bounds`; returns the root. A region page lists beside its records the rank of its first cell,
/// `first`: its `n`-th record is `scene-cell-<first + n>.json`, the rank the world roots name that
/// cell by (#1237), whatever page a view opens first. It lists too the slots of the mesh pages its
/// cells' primitives lie in, `mesh_pages` by mesh rank (#792), each once; an index page and the
/// root list beside each page the core parents its cells hang under (#575), which is all a moved
/// parent may carry them by; the root also lists the rows a view holds (`view_rows`).
pub(crate) fn write_pages(
    tree: &Region,
    records: &[Value],
    bounds: &[Box6],
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<Value> {
    let kind = &CELL_PAGES;
    let leaf = |cells: Range<usize>, _| {
        let first = cells.start;
        let records = &records[cells];
        let meshes = records
            .iter()
            .flat_map(|r| meshes_of(r).map(|(mesh, _)| mesh));
        let pages = slots_of(meshes, mesh_pages);
        Ok(json!({"first": first, kind.records: records, "meshPages": pages}))
    };
    let parents = |cells: Range<usize>| parents_of(&records[cells]);
    let mut pager = Pager::new(
        kind,
        records,
        Some(bounds),
        directory,
        &leaf,
        Some(&parents),
    )?;
    let (pages, parents) = pager.root(tree)?;
    let (cube, meshes) = view_rows(records);
    Ok(
        json!({"version": kind.version, "pages": pages, "parents": parents, "meshes": meshes, "cube": cube}),
    )
}

/// The core ranks `records` hang nodes under, each once in rank order, eight hexadecimal digits
/// each, run together: fixed width per parent, whatever the cells.
fn parents_of(records: &[Value]) -> String {
    let ranks = records
        .iter()
        .flat_map(|record| record["parents"].as_array().into_iter().flatten())
        .filter_map(|parent| parent[0].as_u64());
    let ranks: BTreeSet<u64> = ranks.collect();
    ranks.iter().map(|rank| format!("{rank:08x}")).collect()
}
