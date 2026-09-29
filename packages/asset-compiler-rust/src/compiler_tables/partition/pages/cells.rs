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
/// `bounds`; returns the root. A region page lists beside its records the slots of the mesh pages
/// its cells' primitives lie in, `mesh_pages` by mesh rank (#792), each once.
pub(crate) fn write_pages(
    tree: &Region,
    records: &[Value],
    bounds: &[Box6],
    mesh_pages: &MeshSlots,
    directory: &Path,
) -> Result<Value> {
    let kind = &CELL_PAGES;
    let leaf = |cells: Range<usize>, _| {
        let records = &records[cells];
        let meshes = records
            .iter()
            .flat_map(|r| r["meshes"].as_array().into_iter().flatten());
        let pages = slots_of(meshes.filter_map(|m| m[0].as_u64()), mesh_pages);
        Ok(json!({kind.records: records, "meshPages": pages}))
    };
    let mut pager = Pager::new(kind, records, Some(bounds), directory, &leaf)?;
    Ok(json!({"version": kind.version, "pages": pager.root(tree)?}))
}
