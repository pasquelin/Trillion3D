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
/// `bounds`; returns the root, with the totals the runtime reads before any page (`totals`). A
/// region page lists beside its records the slots of the mesh pages
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
    let (meshes, parents) = totals(records);
    Ok(
        json!({"version": kind.version, "pages": pager.root(tree)?, "meshes": meshes, "parents": parents}),
    )
}

/// What the runtime sizes its rows by and follows before it reads any page (#575): per mesh, in
/// rank order, its rank then how many nodes the cells place, eight hexadecimal digits each; and each
/// core rank the cells hang nodes under, in eight. Fixed width: the root grows with the meshes and parents
/// placed, never with the cells.
fn totals(records: &[Value]) -> (Vec<String>, Vec<String>) {
    let mut meshes = BTreeMap::<u64, u64>::new();
    let mut parents = BTreeSet::<u64>::new();
    for record in records {
        for mesh in record["meshes"].as_array().into_iter().flatten() {
            let (rank, count) = (mesh[0].as_u64(), mesh[1].as_u64());
            *meshes.entry(rank.unwrap_or_default()).or_default() += count.unwrap_or_default();
        }
        let ranks = record["parents"].as_array().into_iter().flatten();
        parents.extend(ranks.filter_map(|parent| parent[0].as_u64()));
    }
    let meshes = meshes
        .iter()
        .map(|(rank, count)| format!("{rank:08x}{count:08x}"));
    let parents = parents.iter().map(|rank| format!("{rank:08x}"));
    (meshes.collect(), parents.collect())
}
