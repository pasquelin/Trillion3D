//! A layer of the option: every field its builder admits read and checked, the others refused.
use super::fields::{named, switch};
use super::*;
use super::{
    HlodBuilder, HlodLayer, HlodLodSelection, HlodMerging, HlodSimplifying, HlodSizeFilter,
    LAYER_FIELDS,
};
use crate::compiler::validate::{Fields, OPTIONS};

/// A layer setting of `layer` read as a number, `None` when absent; refused unless positive.
fn positive(layer: &Map<String, Value>, key: &str, what: &str) -> Result<Option<f64>> {
    let value = OPTIONS.optional(layer.get(key), &format!("{what}.{key}"), Fields::number)?;
    if value.is_some_and(|v| v <= 0.0) {
        return Err(OPTIONS.bad(format!("{what}.{key} must be positive")));
    }
    Ok(value)
}

/// The builder layer `name`'s `word` names; refused unless it is one.
fn builder_of(word: &str, name: &str) -> Result<HlodBuilder> {
    (HlodBuilder::ALL.into_iter())
        .find(|b| b.name() == word)
        .ok_or_else(|| {
            let choices = HLOD_BUILDERS.join(", ");
            OPTIONS.bad(format!(
                "{HLOD_FIELD} layer {name}: builder must be one of {choices}"
            ))
        })
}

/// The LOD selection `map` names, the default when absent; refused unless it is one.
fn lod_selection_of(map: &Map<String, Value>, what: &str) -> Result<HlodLodSelection> {
    let lod_selection = OPTIONS.optional(
        map.get("lodSelection"),
        &format!("{what}.lodSelection"),
        Fields::text,
    )?;
    match lod_selection {
        None => Ok(HlodLodSelection::default()),
        Some(word) => (HlodLodSelection::ALL.into_iter())
            .find(|s| s.name() == word)
            .ok_or_else(|| {
                let choices = HLOD_LOD_SELECTIONS.join(" or ");
                OPTIONS.bad(format!("{what}.lodSelection must be {choices}"))
            }),
    }
}

/// Whether the layer's meshes get a cluster DAG. Two settings, as the reference has them: an
/// instanced layer's objects keep their own cluster DAG unless the layer disallows it
/// (`disallowClusterDag`, false by default); the mesh a layer builds gets one only where the layer
/// asks for it (`clusterDag`, false by default, a merged, approximated or simplified mesh being a
/// plain mesh by default).
fn cluster_dag_of(map: &Map<String, Value>, what: &str, builder: HlodBuilder) -> Result<bool> {
    Ok(match builder {
        HlodBuilder::Instanced => !switch(map, "disallowClusterDag", what)?.unwrap_or(false),
        _ => switch(map, "clusterDag", what)?.unwrap_or(false),
    })
}

/// The atlas side `map` names, the default when absent; refused unless a power of two in bounds.
fn texture_size_of(map: &Map<String, Value>, what: &str) -> Result<usize> {
    let named = OPTIONS.optional(
        map.get("textureSize"),
        &format!("{what}.textureSize"),
        Fields::index,
    )?;
    let Some(size) = named else {
        return Ok(DEFAULT_HLOD_TEXTURE_SIZE);
    };
    let bounded = (MIN_HLOD_TEXTURE_SIZE..=MAX_HLOD_TEXTURE_SIZE).contains(&size);
    if !(bounded && size.is_power_of_two()) {
        return Err(OPTIONS.bad(format!(
            "{what}.textureSize must be a power of two from {MIN_HLOD_TEXTURE_SIZE} to \
             {MAX_HLOD_TEXTURE_SIZE}"
        )));
    }
    Ok(size)
}

/// Whether the layer's actors stream on a grid. Actors always loaded stream on no grid: a grid's
/// setting would set nothing, and is refused.
fn spatially_loaded_of(map: &Map<String, Value>, what: &str) -> Result<bool> {
    let spatially_loaded = switch(map, "spatiallyLoaded", what)?.unwrap_or(true);
    if !spatially_loaded && (named(map, "cellSize") || named(map, "loadingRange")) {
        return Err(OPTIONS.bad(format!(
            "{what}: cellSize and loadingRange need spatiallyLoaded"
        )));
    }
    Ok(spatially_loaded)
}

/// The settings of `map` every builder that bakes an atlas carries with its maps: how a translucent
/// source shows in it, what an approximated or simplified atlas holds where it holds no chart's
/// value, and how an approximated atlas is sized — a field of the layer, as a merged layer's sizing.
fn read_atlas_shared(read: &mut HlodLayer, map: &Map<String, Value>, what: &str) -> Result<()> {
    let translucency = super::translucency::translucency(map, what)?;
    read.approximation.maps.translucency = translucency;
    read.merging.maps.translucency = translucency;
    read.simplifying.maps.translucency = translucency;
    let empty_texels = super::approximation::empty_texels(map, what)?;
    read.approximation.empty_texels = empty_texels;
    read.simplifying.empty_texels = empty_texels;
    if read.builder == HlodBuilder::Approximate {
        let fields = super::approximation::APPROXIMATION_SIZING;
        read.approximation.sizing = super::approximation::atlas_sizing(map, what, fields)?;
    }
    Ok(())
}

/// Layer `entry`'s fields, its name and its builder (`what` naming the layer): the fields the layer
/// and its builder admit, any other refused.
fn admitted<'e>(
    entry: &'e Value,
    what: &str,
) -> Result<(&'e Map<String, Value>, &'e str, HlodBuilder)> {
    let map = OPTIONS.object(entry, what)?;
    let name = OPTIONS.text(map.get("name"), &format!("{what}.name"))?;
    if name.is_empty() {
        return Err(OPTIONS.bad(format!("{what}.name is empty")));
    }
    let word = OPTIONS.text(map.get("builder"), &format!("{what}.builder"))?;
    let builder = builder_of(word, name)?;
    let fields: Vec<&str> = LAYER_FIELDS
        .iter()
        .chain(builder.settings())
        .copied()
        .collect();
    let named = format!("{HLOD_FIELD} layer {name} ({word})");
    Ok((OPTIONS.known(entry, &fields, &named)?, name, builder))
}

/// Layer `entry` (`what` naming it), its parent's name apart: every field its builder admits read
/// and checked, the others refused.
pub(super) fn layer(entry: &Value, what: &str) -> Result<(HlodLayer, Option<String>)> {
    let (map, name, builder) = admitted(entry, what)?;
    let what = format!("{HLOD_FIELD} layer {name} ({})", builder.name());
    let parent = OPTIONS.optional(map.get("parent"), &format!("{what}.parent"), Fields::text)?;
    let lod_selection = lod_selection_of(map, &what)?;
    let merge_materials = switch(map, "mergeMaterials", &what)?.unwrap_or(false);
    // A merged layer that keeps its sources' materials bakes no atlas: its atlas's settings are
    // refused there (`merging`).
    let merging = match builder {
        HlodBuilder::Merge => super::merging::merging(map, &what, merge_materials)?,
        _ => HlodMerging::default(),
    };
    let size_filter = match builder {
        HlodBuilder::Instanced => super::instancing::size_filter(map, &what)?,
        _ => HlodSizeFilter::None,
    };
    let simplifying = match builder {
        HlodBuilder::Simplify => super::simplifying::simplifying(map, &what)?,
        _ => HlodSimplifying::default(),
    };
    // An instanced layer disallowing a cluster DAG stays an instanced layer: its objects are still
    // rows of their source meshes, each placed on that mesh's fallback — a mesh the compiler makes
    // once per source mesh, drawn whole — in place of the mesh's own DAG (`compiler/source/fallback.rs`).
    let cluster_dag = cluster_dag_of(map, &what, builder)?;
    let allow_distance_field =
        switch(map, "allowDistanceField", &what)?.unwrap_or(builder.allows_distance_field());
    let texture_size = texture_size_of(map, &what)?;
    let spatially_loaded = spatially_loaded_of(map, &what)?;
    let mut read = HlodLayer {
        name: name.to_string(),
        builder,
        parent: None,
        accuracy: positive(map, "accuracy", &what)?,
        deviation: positive(map, "deviation", &what)?,
        texture_size,
        approximation: super::approximation::approximation(map.get("approximation"), &what)?,
        lod_selection,
        merge_materials,
        merging,
        size_filter,
        simplifying,
        cluster_dag,
        mesh_build: super::meshes::mesh_build(map, &what, builder)?,
        allow_distance_field,
        spatially_loaded,
        cell_size: positive(map, "cellSize", &what)?.unwrap_or(DEFAULT_HLOD_CELL_SIZE),
        loading_range: positive(map, "loadingRange", &what)?.unwrap_or(DEFAULT_HLOD_LOADING_RANGE),
    };
    read_atlas_shared(&mut read, map, &what)?;
    Ok((read, parent.map(str::to_string)))
}
