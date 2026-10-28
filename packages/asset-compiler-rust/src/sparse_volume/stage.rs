//! The sparse volumes stage: every node the scene shows that cites a `.vdb` file gets its frames
//! built and written in `sparseVolumes.bin`; none, no product.
use super::abi::*;
use super::derived::Derived;
use super::encode::frame;
use super::format::*;
use super::import::{default_assignment, sequence_files, Frame, ImportOptions};
use super::texture::{Addressing, TextureData};
use super::vdb::{self, invalid, File};
use crate::compiler::cache::storage::{product, Product};
use crate::support::perf::{Phase, Timer};
use crate::Result;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;

/// The key of a node's `extensions` that cites a volume.
const EXTENSION: &str = "TRILLION3D_sparse_volume";

/// What the stage reads: the scene, the folder its files lie in, the nodes it shows and those a
/// hidden node hides.
pub(crate) struct SparseVolumeInputs<'a> {
    pub g: &'a Value,
    pub image_root: &'a Path,
    pub scene_nodes: &'a BTreeSet<usize>,
    pub hidden: &'a BTreeSet<usize>,
}

/// The volume each node of `g` cites, with the fingerprint of every file of its sequence: what the
/// cache key holds of them. A file that is not there has none.
pub(crate) fn linked_volumes(g: &Value, root: &Path) -> Vec<Value> {
    let nodes = g
        .get("nodes")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    nodes
        .iter()
        .filter_map(|node| {
            node.pointer("/extensions")?
                .get(EXTENSION)?
                .get("uri")?
                .as_str()
        })
        .map(|uri| {
            let shas: Vec<Option<String>> = files_of(root, uri)
                .unwrap_or_default()
                .iter()
                .map(|path| crate::hash_file(path).ok())
                .collect();
            json!({"uri": uri, "sha256": shas})
        })
        .collect()
}

/// The files `uri` names, a whole sequence where its name ends with a number.
fn files_of(root: &Path, uri: &str) -> Result<Vec<std::path::PathBuf>> {
    let first = crate::support::uri::resolve_under(root, uri)
        .map_err(|why| invalid(format!("the volume {uri:?} is refused: {why}")))?;
    if !first.is_file() {
        return Err(invalid(format!("the volume file {uri:?} is not there")));
    }
    Ok(sequence_files(&first))
}

/// Builds the frames of the node `node` and appends them to `file`; the node's entry of the section.
fn build_node(node: usize, uri: &str, root: &Path, file: &mut Vec<u8>) -> Result<Value> {
    let paths = files_of(root, uri)?;
    let mut bytes = Vec::with_capacity(paths.len());
    let mut parsed: Vec<File> = Vec::with_capacity(paths.len());
    for path in &paths {
        bytes.push(std::fs::read(path)?);
        parsed.push(vdb::read(bytes.last().expect("pushed"))?);
    }
    drop(bytes);
    let options: ImportOptions = default_assignment(&parsed[0].grids);
    // The volume of the sequence is the union of its frames' boxes, and every frame starts at its
    // lowest voxel.
    let mut union: Option<(IVec3, IVec3)> = None;
    for file in &parsed {
        super::import::validate(&options, &file.grids)?;
        if let Some((low, high)) = super::import::mapped_bounds(&options, &file.grids) {
            let (min, max) = union.get_or_insert((low, high));
            *min = zip3(*min, low, i32::min);
            *max = zip3(*max, high, i32::max);
        }
    }
    let (origin, top) =
        union.ok_or_else(|| invalid(format!("the volume {uri:?} holds no active voxel")))?;
    let extent = sub3(top, origin);
    let mips = mip_levels([0; 3], extent);
    let addressing = Addressing { resolution: extent };
    let mut frames = Vec::new();
    let mut formats: Option<[PixelFormat; 2]> = None;
    for file_grids in &parsed {
        let source = Frame::new(&file_grids.grids, &options, origin)?;
        let mut texture = TextureData::create(&source).map_err(invalid)?;
        if formats.is_some_and(|known| known != texture.header.formats) {
            return Err(invalid(format!(
                "the frames of the volume {uri:?} do not share their formats"
            )));
        }
        formats = Some(texture.header.formats);
        texture.build_mips(&addressing, mips).map_err(invalid)?;
        let derived = Derived::build(&texture);
        let compressed = derived.compress().map_err(invalid)?;
        let encoded = frame(&derived, &compressed);
        // The voxels start at `origin`: the frame's transform puts them back where they were.
        let mut matrix = source.matrix;
        for axis in 0..3 {
            matrix[12 + axis] += f64::from(origin[axis]) * source.matrix[axis * 5];
        }
        frames.push(json!({"offset": file.len(), "bytes": encoded.len(), "matrix": matrix}));
        file.extend_from_slice(&encoded);
    }
    Ok(json!({
        "node": node, "uri": uri, "resolution": extent, "mipLevels": mips,
        "formats": formats.map(|pair| pair.map(|format| format as u32)), "frames": frames,
    }))
}

/// Writes `sparseVolumes.bin` in `directory` for the volumes the scene's nodes cite; returns its
/// product and the manifest's `sparseVolumes` section, none when no shown node cites one.
pub(crate) fn write_sparse_volumes(
    inputs: &SparseVolumeInputs<'_>,
    directory: &Path,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Option<(Product, Value)>> {
    let nodes = inputs
        .g
        .get("nodes")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    let cited: Vec<(usize, &str)> = nodes
        .iter()
        .enumerate()
        .filter(|(index, _)| inputs.scene_nodes.contains(index) && !inputs.hidden.contains(index))
        .filter_map(|(index, node)| {
            let uri = node
                .pointer("/extensions")?
                .get(EXTENSION)?
                .get("uri")?
                .as_str()?;
            Some((index, uri))
        })
        .collect();
    if cited.is_empty() {
        return Ok(None);
    }
    let _t = Timer::new(Phase::SparseVolumes);
    let mut file = Vec::new();
    let mut volumes = Vec::new();
    for (node, uri) in cited {
        volumes.push(build_node(node, uri, inputs.image_root, &mut file)?);
    }
    let written = product(directory, SPARSE_VOLUMES_FILE, &file)?;
    progress(json!({"phase":"sparseVolumes","completed":1,"total":1,"volumes":volumes.len()}));
    let section = json!({
        "version": SECTION_VERSION, "file": SPARSE_VOLUMES_FILE, "bytes": file.len(),
        "sha256": written.sha256, "volumes": volumes,
    });
    Ok(Some((written, section)))
}
