//! The mesh cards stage: every compiled mesh whose build asks for cards (`maxMeshCards` above 0)
//! has them built from the level-0 triangles of the source mesh it is read from
//! (`build_mesh_cards`), but those drawn through a skin; those of the HLOD cells whose layer allows a distance field (`actors.rs`)
//! are built with the world's actors, which come after; and all are written in one product,
//! `meshCards.bin`, which the manifest's `meshCards` section names (`write_mesh_cards`). A scene
//! whose meshes and HLOD cells build none writes neither. A mesh whose triangles, materials, box
//! and settings are those of another, or of one met in an earlier compilation, has that one's cards
//! (`memo.rs`).
use super::abi::MESH_CARDS_FILE;
use super::build::{build, MeshCards};
use super::encode::{encode, report, PlacedCards};
use super::{memo, CardSettings};
use crate::compiler::cache::storage::{product, Product};
use crate::distance_field::{source_meshes, DistanceFieldSettings, Owner, Placed, Scene};
use crate::plugins::scene::cancel;
use crate::support::derived::Derived;
use crate::Result;
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

type Vec3 = [f64; 3];
use std::sync::atomic::AtomicBool;

/// What the stage reads: the scene, its meshes' map, how each source mesh's cards are
/// built (its build's) and the distance fields already built, whose boxes the cards of the meshes
/// that have a field are fitted in.
pub(crate) struct CardInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub settings: &'a [CardSettings],
    /// How each source mesh's field is built: whether its triangles count two-sided is the cards'
    /// too.
    pub fields: &'a [DistanceFieldSettings],
    pub built: &'a [Placed],
    /// The cache the cards built are kept in, by what they were built from (`memo.rs`).
    pub cache: &'a Path,
    /// The job's cancellation token, read before each mesh and each direction's rays.
    pub cancelled: &'a AtomicBool,
}

/// A mesh that asks for cards, and the key they are kept by.
struct MeshKey {
    compiled: usize,
    source: usize,
    two_sided: bool,
    /// The box of the mesh's distance field, where it has one.
    bounds: Option<(Vec3, Vec3)>,
    key: String,
}

/// The meshes some node draws through a skin: they bend, so a card of their rest pose would stay
/// behind, and they get none.
fn skinned_meshes(g: &Value) -> BTreeSet<usize> {
    let nodes = g.get("nodes").and_then(Value::as_array);
    (nodes.into_iter().flatten())
        .filter(|node| node.get("skin").is_some())
        .filter_map(|node| node.get("mesh")?.as_u64().map(|mesh| mesh as usize))
        .collect()
}

/// The cards of every compiled mesh that asks for some, in the order of the meshes.
pub(crate) fn build_mesh_cards(inputs: &CardInputs<'_>) -> Result<Vec<PlacedCards>> {
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::MeshCards);
    // The box of a mesh's distance field is the one its cards are fitted in.
    let boxes: BTreeMap<u32, (Vec3, Vec3)> = (inputs.built.iter())
        .filter_map(|placed| match placed.owner {
            Owner::Mesh(mesh) => Some((mesh, placed.bounds())),
            Owner::HlodCell(_) => None,
        })
        .collect();
    let skinned = skinned_meshes(inputs.g);
    let asked: Vec<(usize, usize)> = (source_meshes(inputs.mesh_map).into_iter())
        .filter(|&(_, source)| {
            !skinned.contains(&source)
                && (inputs.settings.get(source)).is_some_and(CardSettings::builds)
        })
        .collect();
    // Each mesh's key, and the box its cards are fitted in: a mesh met again — the same triangles,
    // materials, box and settings — has the cards of its first meeting, built once.
    let read = (inputs.g, inputs.bin);
    let keyed: Vec<MeshKey> = asked
        .par_iter()
        .map(|&(compiled, source)| -> Result<MeshKey> {
            cancel::check(inputs.cancelled)?;
            let bounds = boxes.get(&(compiled as u32)).copied();
            let two_sided = inputs.fields[source].as_if_two_sided;
            let key = memo::key(read, source, (&inputs.settings[source], two_sided, bounds))?;
            Ok(MeshKey {
                compiled,
                source,
                two_sided,
                bounds,
                key,
            })
        })
        .collect::<Result<_>>()?;
    let mut distinct: BTreeMap<&str, &MeshKey> = BTreeMap::new();
    for mesh in &keyed {
        distinct.entry(mesh.key.as_str()).or_insert(mesh);
    }
    let derived = Derived::new(inputs.cache);
    let built: BTreeMap<&str, Option<Arc<MeshCards>>> = (distinct.par_iter())
        .map(|(&key, mesh)| -> Result<_> {
            cancel::check(inputs.cancelled)?;
            let stored = derived
                .get(memo::KIND, key)
                .and_then(|bytes| memo::decode(&bytes));
            if stored.is_some() {
                return Ok((key, stored.map(Arc::new)));
            }
            let Some(scene) = Scene::read(read, mesh.source, (mesh.two_sided, true))? else {
                return Ok((key, None));
            };
            let bounds = mesh.bounds.unwrap_or((scene.low, scene.high));
            let Some(cards) = build(
                &scene,
                bounds,
                &inputs.settings[mesh.source],
                inputs.cancelled,
            ) else {
                return Err(cancel::refusal());
            };
            derived.put(memo::KIND, key, &memo::encode(&cards));
            Ok((key, Some(Arc::new(cards))))
        })
        .collect::<Result<_>>()?;
    Ok(keyed
        .iter()
        .filter_map(|mesh| {
            let cards = built[mesh.key.as_str()].as_ref()?;
            let owner = Owner::Mesh(mesh.compiled as u32);
            Some(PlacedCards::new(owner, MeshCards::clone(cards)))
        })
        .collect())
}

/// Writes `cards` as `meshCards.bin` in `directory`; returns its product and the manifest's
/// `meshCards` section, none when there are no cards.
pub(crate) fn write_mesh_cards(
    cards: &[PlacedCards],
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    if cards.is_empty() {
        return Ok(None);
    }
    let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::MeshCards);
    let bytes = encode(cards);
    let written = product(directory, MESH_CARDS_FILE, &bytes)?;
    let section = report(cards, bytes.len());
    progress(json!({"phase":"meshCards","completed":1,"total":1,
        "meshes":cards.len(),"cards":section["cards"]}));
    Ok(Some((written, section)))
}
