//! The pieces of the scene tables' stage (`../tables.rs`): the animation banks' product, the surfaces
//! the tables carry, and the tables written under their own name.
use super::*;

/// The animation banks written as `animation-banks.bin` when an object plays an item: the product
/// and the descriptor the manifest names it by (`animationBanks`), none for a scene with no item.
pub(super) fn banks_product(
    banks: &motion::bank::Banks,
    directory: &Path,
) -> Result<Option<(Product, Value)>> {
    let Some(bytes) = &banks.file else {
        return Ok(None);
    };
    let written = product(directory, motion::bank::ANIMATION_BANKS_FILE, bytes)?;
    let descriptor = json!({"url": written.name, "bytes": written.bytes,
        "version": motion::bank::ANIMATION_BANKS_VERSION, "sha256": written.sha256,
        "items": banks.items});
    Ok(Some((written, descriptor)))
}

/// The surfaces of the scene `described` (`g`'s published, with the world's materials) the tables
/// carry: the material table, the document's table, and the table rank of each flattened material
/// `hlod` names, in the order the world's clusters name them.
pub(super) fn surface_tables(
    (g, bin, mesh_map): (&Value, &[u8], &BTreeMap<usize, usize>),
    materials: &crate::MaterialOptions,
    (described, hlod): (&Value, &[usize]),
) -> Result<(Materials, Value, Vec<usize>)> {
    let (responsive, mut ignored) = materials.responsive_levels(described);
    let (sky, sky_ignored) = materials.sky_flags(described);
    ignored.extend(sky_ignored);
    let mut surfaces = Materials {
        table: Vec::new(),
        interned: BTreeMap::new(),
        responsive,
        sky,
        ignored,
        densities: uv_density::by_material(g, bin, mesh_map.keys().copied())?,
    };
    let document = document_table(described, "source.bin", &mut surfaces)?;
    // Each flattened material's entry in its no-tangent variant: a merged actor's pages hold no
    // tangents, an approximated shell's do (`hlod/chain/pages.rs`), and there each cluster's
    // tangent flag picks the stored-frame normal factor (`tangentNormalScaleY`), so one entry
    // serves both.
    let ranks: Vec<usize> = hlod
        .iter()
        .map(|&id| surfaces.rank(described, &json!({"material": id})))
        .collect::<Result<_>>()?;
    Ok((surfaces, document, ranks))
}

/// The slots of the mesh pages the meshes `nodes` draw lie in, sorted and each once: what a runtime
/// reads before its first frame, the cells naming the rest (#751).
fn core_pages(
    nodes: &[Value],
    published: &Value,
    by_mesh: &partition::pages::MeshSlots,
) -> Vec<String> {
    let meshes = nodes.iter().filter_map(|node| node["mesh"].as_u64());
    // A fallback mesh no node draws is read with the core too (`source/fallback.rs`).
    let meshes = meshes.chain(fallback_meshes(published));
    partition::pages::slots_of(meshes, by_mesh)
        .into_iter()
        .cloned()
        .collect()
}

/// The ranks of the fallback meshes of the published scene `published` (`source/fallback.rs`).
pub(crate) fn fallback_meshes(published: &Value) -> impl Iterator<Item = u64> + '_ {
    let meshes = published["meshes"].as_array().into_iter().flatten();
    (meshes.enumerate())
        .filter(|(_, mesh)| crate::compiler::source::fallback::of(mesh).is_some())
        .map(|(rank, _)| rank as u64)
}

/// The tables written as a cache product under their own name, and told on the progress `events`
/// with the milliseconds since `started`: the published scene `published` of the input scene `g`
/// (its binary `bin`), whose objects' settings `objects` name the nodes they stream; its nodes
/// (`table`) and `roots`, which `split` places in the core and its cells when it makes any, with
/// the skins and animations renumbered to the core's; the slots of the mesh pages (`by_mesh`) the
/// core's nodes draw, its `textures` and its surfaces (`surface_tables`).
pub(super) fn write_tables(
    (g, bin, published, objects): (&Value, &[u8], &Value, &crate::ObjectSettings),
    (by_mesh, directory): (&partition::pages::MeshSlots, &Path),
    (split, table, roots): (Option<partition::Partitioned>, Vec<Value>, Vec<usize>),
    (textures, surfaces): (Vec<Value>, (Materials, Value, Vec<usize>)),
    (events, started): (&impl Fn(Value), Instant),
) -> Result<Product> {
    let (surfaces, document, hlod_materials) = surfaces;
    let (mut skins, mut animations) = (
        motion::skin_table(g, bin)?,
        motion::animation_table(g, bin)?,
    );
    let (mut nodes, roots, partition, cells) = match split {
        Some(split) => {
            motion::renumber(&mut skins, &mut animations, &split.rank);
            (split.nodes, split.roots, split.partition, split.cells)
        }
        None => (table, roots, Value::Null, 0),
    };
    name_object_settings(&mut nodes, published, objects)?;
    let counts = json!({"nodes":nodes.len(),"cells":cells,"materials":surfaces.table.len(),"textures":textures.len()});
    let tables = json!({
        "version": SCENE_TABLES_VERSION,
        "nodeTableVersion": NODE_TABLE_VERSION,
        "materialTableVersion": MATERIAL_TABLE_VERSION,
        "geometryTableVersion": GEOMETRY_TABLE_VERSION,
        "scene": scene_roots(published, roots)?,
        "nodes": nodes,
        "partition": partition,
        "meshPages": core_pages(&nodes, published, by_mesh),
        "cameras": camera_table(published)?,
        "skins": skins,
        "animations": animations,
        "materials": surfaces.table,
        "textures": textures,
        "document": document,
        "hlodMaterials": hlod_materials,
    });
    let written = product(directory, SCENE_TABLES_FILE, &serde_json::to_vec(&tables)?)?;
    let mut told = json!({"phase":"tables","completed":1,"total":1,"ms":shared_math::elapsed_ms(started),"counts":counts});
    if !surfaces.ignored.is_empty() {
        told["warnings"] = json!(surfaces.ignored);
    }
    events(told);
    Ok(written)
}
