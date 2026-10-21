//! The layers, marks and the option read.
use super::fields::{named, switch};
use super::*;
use super::{
    Hlod, HlodAssign, HlodBuilder, HlodLayer, HlodLodSelection, HlodMerging, HlodSimplifying,
    HlodSizeFilter, ASSIGN_FIELDS, HLOD_FIELDS, LAYER_FIELDS,
};
use crate::compiler::args::name_match::{present, NameMatch};
use crate::compiler::validate::{Fields, OPTIONS};

/// A layer setting of `layer` read as a number, `None` when absent; refused unless positive.
fn positive(layer: &Map<String, Value>, key: &str, what: &str) -> Result<Option<f64>> {
    let value = OPTIONS.optional(layer.get(key), &format!("{what}.{key}"), Fields::number)?;
    if value.is_some_and(|v| v <= 0.0) {
        return Err(OPTIONS.bad(format!("{what}.{key} must be positive")));
    }
    Ok(value)
}

/// Layer `entry` (`what` naming it), its parent's name apart: every field its builder admits read
/// and checked, the others refused; an instanced layer asking for no cluster DAG read as the
/// `merge` layer that draws each object's fallback.
pub(super) fn layer(entry: &Value, what: &str) -> Result<(HlodLayer, Option<String>)> {
    let map = OPTIONS.object(entry, what)?;
    let name = OPTIONS.text(map.get("name"), &format!("{what}.name"))?;
    if name.is_empty() {
        return Err(OPTIONS.bad(format!("{what}.name is empty")));
    }
    let word = OPTIONS.text(map.get("builder"), &format!("{what}.builder"))?;
    let builder = (HlodBuilder::ALL.into_iter())
        .find(|b| b.name() == word)
        .ok_or_else(|| {
            let choices = HLOD_BUILDERS.join(", ");
            OPTIONS.bad(format!(
                "{HLOD_FIELD} layer {name}: builder must be one of {choices}"
            ))
        })?;
    let admitted: Vec<&str> = LAYER_FIELDS
        .iter()
        .chain(builder.settings())
        .copied()
        .collect();
    let what = format!("{HLOD_FIELD} layer {name} ({word})");
    let map = OPTIONS.known(entry, &admitted, &what)?;
    let parent = OPTIONS.optional(map.get("parent"), &format!("{what}.parent"), Fields::text)?;
    let lod_selection = OPTIONS.optional(
        map.get("lodSelection"),
        &format!("{what}.lodSelection"),
        Fields::text,
    )?;
    let lod_selection = match lod_selection {
        None => HlodLodSelection::default(),
        Some(word) => (HlodLodSelection::ALL.into_iter())
            .find(|s| s.name() == word)
            .ok_or_else(|| {
                let choices = HLOD_LOD_SELECTIONS.join(" or ");
                OPTIONS.bad(format!("{what}.lodSelection must be {choices}"))
            })?,
    };
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
    let cluster_dag = switch(map, "clusterDag", &what)?.unwrap_or(true);
    // An instanced layer asking for no cluster DAG draws each object it takes at the last LOD of
    // its mesh — a source whose LODs are a cluster DAG, its fallback — rather than at the cut of its
    // own DAG: the layer that builds those meshes, a `merge` layer keeping its materials and
    // taking each source's fallback (`HlodLodSelection::Lowest`), its meshes drawn whole.
    let (builder, lod_selection) = match (builder, cluster_dag) {
        (HlodBuilder::Instanced, false) => (HlodBuilder::Merge, HlodLodSelection::Lowest),
        _ => (builder, lod_selection),
    };
    let texture_size = match OPTIONS.optional(
        map.get("textureSize"),
        &format!("{what}.textureSize"),
        Fields::index,
    )? {
        None => DEFAULT_HLOD_TEXTURE_SIZE,
        Some(size) => {
            let bounded = (MIN_HLOD_TEXTURE_SIZE..=MAX_HLOD_TEXTURE_SIZE).contains(&size);
            if !(bounded && size.is_power_of_two()) {
                return Err(OPTIONS.bad(format!(
                    "{what}.textureSize must be a power of two from {MIN_HLOD_TEXTURE_SIZE} to \
                     {MAX_HLOD_TEXTURE_SIZE}"
                )));
            }
            size
        }
    };
    let spatially_loaded = switch(map, "spatiallyLoaded", &what)?.unwrap_or(true);
    // Actors always loaded stream on no grid: a grid's setting would set nothing.
    if !spatially_loaded && (named(map, "cellSize") || named(map, "loadingRange")) {
        return Err(OPTIONS.bad(format!(
            "{what}: cellSize and loadingRange need spatiallyLoaded"
        )));
    }
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
        mesh_build: super::meshes::mesh_build(map, &what)?,
        spatially_loaded,
        cell_size: positive(map, "cellSize", &what)?.unwrap_or(DEFAULT_HLOD_CELL_SIZE),
        loading_range: positive(map, "loadingRange", &what)?.unwrap_or(DEFAULT_HLOD_LOADING_RANGE),
    };
    // How a translucent source shows in the atlas, carried with the maps of whichever builder bakes
    // one.
    let translucency = super::translucency::translucency(map, &what)?;
    read.approximation.maps.translucency = translucency;
    read.merging.maps.translucency = translucency;
    read.simplifying.maps.translucency = translucency;
    // What an approximated or simplified atlas holds where it holds no chart's value.
    let empty_texels = super::approximation::empty_texels(map, &what)?;
    read.approximation.empty_texels = empty_texels;
    read.simplifying.empty_texels = empty_texels;
    // How an approximated atlas is sized: a field of the layer, as a merged layer's sizing.
    if builder == HlodBuilder::Approximate {
        let fields = super::approximation::APPROXIMATION_SIZING;
        read.approximation.sizing = super::approximation::atlas_sizing(map, &what, fields)?;
    }
    Ok((read, parent.map(str::to_string)))
}

/// Node `node` of `g`, if it has one.
pub(super) fn node_of(g: &Value, node: usize) -> Option<&Value> {
    g.get("nodes").and_then(|nodes| nodes.get(node))
}

/// The value `key` of node `node`'s `extras`, if it carries one.
fn extra_of<'a>(g: &'a Value, node: usize, key: &str) -> Option<&'a Value> {
    (node_of(g, node).and_then(|n| n.get("extras"))).and_then(|e| e.get(key))
}

/// The switch node `node`'s `extras` holds under `key`, none when it is absent or `null`; `Err`
/// when it is not a switch.
fn switch_of(g: &Value, node: usize, key: &str) -> Result<Option<bool>> {
    let Some(mark) = extra_of(g, node, key).filter(|mark| !mark.is_null()) else {
        return Ok(None);
    };
    OPTIONS
        .boolean(Some(mark), &format!("node {node}: extras.{key}"))
        .map(Some)
}

/// The mark node `entry`'s `extras` carries (`HLOD_MARK`), if any.
pub(super) fn mark_of(entry: Option<&Value>) -> Option<&Value> {
    (entry.and_then(|n| n.get("extras")))
        .and_then(|e| e.get(HLOD_MARK))
        .filter(|mark| !mark.is_null())
}

/// Whether published node `node` of `g` carries a mark (`HLOD_MARK`).
pub fn marked(g: &Value, node: usize) -> bool {
    mark_of(node_of(g, node)).is_some()
}

/// Whether node `node` of `g`'s object stands as itself in every HLOD actor its chain builds — its
/// meshes instanced beside what the actor's builder makes of the others, never built into it —:
/// the switch its `extras` carries (`HLOD_INSTANCE_MARK`), off when absent; `Err` when it is not
/// a switch.
pub fn instanced(g: &Value, node: usize) -> Result<bool> {
    switch_of(g, node, HLOD_INSTANCE_MARK).map(|set| set.unwrap_or(false))
}

/// Whether node `node` of `g`'s object may enter an HLOD layer at all: the switch its `extras`
/// carries (`HLOD_INCLUDE_MARK`), on when absent; `Err` when it is not a switch. Off, it enters
/// none, whatever a mark, a rule or the default would give it (`Hlod::assigned`).
pub fn included(g: &Value, node: usize) -> Result<bool> {
    switch_of(g, node, HLOD_INCLUDE_MARK).map(|set| set.unwrap_or(true))
}

impl Hlod {
    /// The HLOD `value` names, none when absent; `Err` with the job's refusal when it does not
    /// read or does not form chains (`parse`).
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        match present(value) {
            None => Ok(Self::default()),
            Some(Value::Bool(_)) => Err(format!(
                "{HLOD_FIELD} must be an object: leave it out for no HLOD"
            )),
            Some(value) => Self::parse(value).map_err(|e| e.message),
        }
    }

    /// The HLOD `named` names, in one pass: names and parents resolved, settings admitted by
    /// builder and defaulted, patterns compiled, then the chains checked (`chains`) — no cycle, no
    /// parent wearing its sources' own materials above a layer that wears its own, no chain past
    /// `MAX_HLOD_LEVELS` —, a layer not spatially loaded letting its parent go. Each layer's level
    /// is the scene's (`levels`).
    fn parse(named: &Value) -> Result<Self> {
        let map = OPTIONS.known(named, &HLOD_FIELDS, HLOD_FIELD)?;
        let listed = OPTIONS.array(
            map.get("layers").unwrap_or(&Value::Null),
            &format!("{HLOD_FIELD}.layers"),
        )?;
        if listed.is_empty() {
            return Err(OPTIONS.bad(format!("{HLOD_FIELD}.layers must list the layers")));
        }
        let mut layers: Vec<HlodLayer> = Vec::with_capacity(listed.len());
        let mut parents: Vec<Option<String>> = Vec::with_capacity(listed.len());
        for (at, entry) in listed.iter().enumerate() {
            let (read, parent) = layer(entry, &format!("{HLOD_FIELD}.layers[{at}]"))?;
            if layers.iter().any(|l| l.name == read.name) {
                return Err(OPTIONS.bad(format!("{HLOD_FIELD} layer {} is named twice", read.name)));
            }
            layers.push(read);
            parents.push(parent);
        }
        let names: Vec<String> = layers.iter().map(|l| l.name.clone()).collect();
        let rank = |name: &str, what: &str| {
            (names.iter().position(|n| n == name))
                .ok_or_else(|| OPTIONS.bad(format!("{what} names no layer {name}")))
        };
        let parents: Vec<Option<usize>> = (parents.iter().enumerate())
            .map(|(at, parent)| {
                let what = format!("{HLOD_FIELD} layer {}: parent", names[at]);
                parent.as_deref().map(|p| rank(p, &what)).transpose()
            })
            .collect::<Result<_>>()?;
        for (layer, parent) in layers.iter_mut().zip(parents) {
            layer.parent = parent;
        }
        let assign: Vec<HlodAssign> = present(map.get("assign"))
            .map(|rules| {
                (OPTIONS
                    .array(rules, &format!("{HLOD_FIELD}.assign"))?
                    .iter()
                    .enumerate())
                .map(|(at, rule)| {
                    let what = format!("{HLOD_FIELD}.assign[{at}]");
                    let entry = OPTIONS.known(rule, &ASSIGN_FIELDS, &what)?;
                    let layer = OPTIONS.text(entry.get("layer"), &format!("{what}.layer"))?;
                    let matched = entry.get("match").unwrap_or(&Value::Null);
                    Ok(HlodAssign {
                        matcher: NameMatch::read(matched, &format!("{what}.match"))?,
                        layer: rank(layer, &what)?,
                    })
                })
                .collect::<Result<_>>()
            })
            .transpose()?
            .unwrap_or_default();
        let default = OPTIONS.optional(
            map.get("default"),
            &format!("{HLOD_FIELD}.default"),
            Fields::text,
        )?;
        let default = default
            .map(|name| rank(name, &format!("{HLOD_FIELD}.default")))
            .transpose()?;
        let marks: Vec<(String, usize)> = present(map.get("marks"))
            .map(|marks| {
                (OPTIONS
                    .object(marks, &format!("{HLOD_FIELD}.marks"))?
                    .iter())
                .map(|(word, layer)| {
                    let what = format!("{HLOD_FIELD}.marks.{word}");
                    Ok((
                        word.clone(),
                        rank(OPTIONS.text(Some(layer), &what)?, &what)?,
                    ))
                })
                .collect::<Result<_>>()
            })
            .transpose()?
            .unwrap_or_default();
        let mut hlod = Self {
            layers,
            assign,
            default,
            marks,
            named: named.clone(),
        };
        hlod.chains()?;
        Ok(hlod)
    }
}
