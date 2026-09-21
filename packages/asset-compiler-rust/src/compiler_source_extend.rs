//! Vertices the DAG created, carried by the compiled scene.
//!
//! A coarse cluster of `qem-attributes` names vertices the source does not have. Every reader
//! of the cache draws a page as indices into the primitive's vertex buffer of `source.gltf`, so
//! that buffer is where the created vertices go: the primitive's vertex attributes are rewritten
//! as float accessors holding the source vertices followed by the created ones, and its index
//! accessor is left untouched — a glTF reader that ignores the cache still draws the source
//! surface, from the first part of the buffer. Each primitive writes its buffer to a file of
//! its own while it compiles, in parallel; the files enter `source.bin` afterwards, in job order,
//! so two compilations of one scene write the same bytes.
use super::*;
use compiler_primitive_attributes::attribute_name;

/// One attribute of a rewritten primitive: its glTF name, width, and where its values lie in
/// the primitive's vertex file.
pub(super) struct CoarseAttribute {
    pub name: &'static str,
    pub width: usize,
    pub offset: usize,
    pub bytes: usize,
    /// Bounds of the values, which glTF requires on POSITION.
    pub min: Vec<f32>,
    pub max: Vec<f32>,
}
/// The vertex buffer of a rewritten primitive, written to its own file.
pub(super) struct CoarseVertices {
    pub mesh: usize,
    pub primitive: usize,
    pub count: usize,
    pub file: PathBuf,
    pub attributes: Vec<CoarseAttribute>,
}

fn bounds(values: &[f32], width: usize) -> (Vec<f32>, Vec<f32>) {
    let mut min = vec![f32::INFINITY; width];
    let mut max = vec![f32::NEG_INFINITY; width];
    for vertex in values.chunks_exact(width) {
        for (c, value) in vertex.iter().enumerate() {
            min[c] = min[c].min(*value);
            max[c] = max[c].max(*value);
        }
    }
    (min, max)
}

fn le_bytes(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Writes the primitive's vertices — POSITION then every page attribute, each tightly packed
/// as float — under `directory/vertices/`, and describes the file.
pub(super) fn write_coarse_vertices(
    directory: &Path,
    (mesh, primitive): (usize, usize),
    positions: &[f32],
    attributes: &[geometry_page::Attribute],
) -> Result<CoarseVertices> {
    let folder = directory.join("vertices");
    fs::create_dir_all(&folder)?;
    let file = folder.join(format!("{mesh}-{primitive}.bin"));
    let mut writer = BufWriter::new(File::create(&file)?);
    let mut described = Vec::with_capacity(attributes.len() + 1);
    let mut offset = 0usize;
    let columns = std::iter::once(("POSITION", 3usize, positions)).chain(
        attributes
            .iter()
            .map(|a| (attribute_name(a.flag), a.width, a.values.as_slice())),
    );
    for (name, width, values) in columns {
        let bytes = le_bytes(values);
        writer.write_all(&bytes)?;
        let (min, max) = bounds(values, width);
        described.push(CoarseAttribute {
            name,
            width,
            offset,
            bytes: bytes.len(),
            min,
            max,
        });
        offset += bytes.len();
    }
    writer.flush()?;
    Ok(CoarseVertices {
        mesh,
        primitive,
        count: positions.len() / 3,
        file,
        attributes: described,
    })
}

/// A rewritten primitive's attributes in the output scene: name, buffer view rank, and the
/// accessor that reads it.
pub(super) struct ExtensionViews {
    pub primitive: (usize, usize),
    pub attributes: Vec<(&'static str, Value)>,
}

/// Appends the vertex file of every rewritten primitive to `source.bin`, one buffer view per
/// attribute, and removes the file. Returns the accessors those views need, keyed by primitive.
pub(super) fn append_to_source_bin(
    writer: &mut impl Write,
    offset: &mut usize,
    output_views: &mut Vec<Value>,
    coarse: &[CoarseVertices],
) -> Result<Vec<ExtensionViews>> {
    let mut out = Vec::with_capacity(coarse.len());
    for vertices in coarse {
        let padding = crate::shared_math::pad_to_4(*offset);
        writer.write_all(&[0u8; 3][..padding])?;
        *offset += padding;
        let base = *offset;
        let mut file = File::open(&vertices.file)?;
        *offset += std::io::copy(&mut file, writer)? as usize;
        drop(file);
        fs::remove_file(&vertices.file)?;
        let mut attributes = Vec::with_capacity(vertices.attributes.len());
        for a in &vertices.attributes {
            let view = output_views.len();
            output_views.push(
                json!({"buffer":0,"byteOffset":base+a.offset,"byteLength":a.bytes,"target":34962}),
            );
            let kind = match a.width {
                2 => "VEC2",
                3 => "VEC3",
                _ => "VEC4",
            };
            let mut accessor =
                json!({"bufferView":view,"componentType":5126,"count":vertices.count,"type":kind});
            if a.name == "POSITION" {
                accessor["min"] = json!(a.min);
                accessor["max"] = json!(a.max);
            }
            attributes.push((a.name, accessor));
        }
        out.push(ExtensionViews {
            primitive: (vertices.mesh, vertices.primitive),
            attributes,
        });
    }
    // The folder served its files; a compilation that failed before this point leaves them,
    // and the next one overwrites them under the same names.
    if let Some(folder) = coarse.first().and_then(|v| v.file.parent()) {
        let _ = fs::remove_dir(folder);
    }
    Ok(out)
}
