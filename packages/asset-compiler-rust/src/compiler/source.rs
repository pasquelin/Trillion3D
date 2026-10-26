//! Reading the intermediate scene: the glTF 2.0 and its GLB container, which every
//! scene driver produces and which only the compiler consumes. Driver choice lives
//! in `plugins`.
use crate::support::le::u32_at;
use crate::*;

pub(crate) mod assembly;
pub(crate) mod buffers;
pub(crate) mod copy;
pub(crate) mod fallback;
pub(crate) mod instancing;
pub(crate) mod load;
pub(crate) mod mapped;
pub(crate) mod mesh_share;
pub(crate) mod node_transform;
pub(crate) mod nodes;
pub(crate) mod primitive_modes;
pub(crate) mod safe_path;
pub(crate) mod scene;
pub(crate) mod select;
pub(crate) mod spline;
pub(crate) mod synth;
#[cfg(test)]
mod tests;

/// A glTF document, `.gltf` with its sidecars or GLB, as every reader takes it: its JSON, its
/// buffers as one binary (`concat_gltf_buffers`), each buffer's offset in it, the digest of each
/// sidecar, and the bytes the JSON itself weighs. The compiler decodes compression before it
/// flattens the views (`load_model_file`); a reader that decodes none flattens at once
/// (`flat_document`).
pub(crate) struct Document {
    pub(crate) g: Value,
    pub(crate) binary: Binary,
    pub(crate) offsets: Vec<usize>,
    pub(crate) sidecars: Vec<(String, String)>,
    pub(crate) json_bytes: usize,
}

/// Reads the document whose bytes are `file`, its sidecars in `dir`, checked against `declared`.
pub(crate) fn read_document(
    dir: &Path,
    file: memmap2::Mmap,
    declared: Option<&Value>,
) -> Result<Document> {
    let (g, embedded, json_bytes) = if is_glb(&file) {
        let (g, range) = parse_glb_parts(&file)?;
        let json_bytes = file.len() - range.len();
        (g, Some(Binary::MappedRange(file, range)), json_bytes)
    } else {
        (serde_json::from_slice(&file)?, None, file.len())
    };
    let (binary, offsets, sidecars) = concat_gltf_buffers(dir, &g, embedded, declared)?;
    Ok(Document {
        g,
        binary,
        offsets,
        sidecars,
        json_bytes,
    })
}

/// The document at `path` with every view on buffer 0, for a reader that decodes no compression:
/// the reference tracer (`oracle`) and a Unity model's tables.
pub(crate) fn flat_document(path: &Path) -> Result<(Value, Binary)> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut document = read_document(dir, map_source(path)?, None)?;
    let length = document.binary.bytes().len();
    flatten_buffer_views(&mut document.g, &document.offsets, length)?;
    Ok((document.g, document.binary))
}

pub(crate) fn is_glb(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == b'g' && bytes[1] == b'l' && bytes[2] == b'T' && bytes[3] == b'F'
}

/// Validates the container and locates its BIN without allocating a second copy.
pub(crate) fn parse_glb_parts(bytes: &[u8]) -> Result<(Value, std::ops::Range<usize>)> {
    if bytes.len() < 12 {
        return Err(invalid("GLB too short"));
    }
    // The twelve header bytes are there; a chunk header is read only while eight bytes remain.
    let word = |at: usize| u32_at(bytes, at).unwrap_or(0);
    let magic = word(0);
    if magic != 0x4654_6C67 {
        return Err(invalid("Not a GLB"));
    }
    let version = word(4);
    if version != 2 {
        return Err(CompilerError::new(
            "UNSUPPORTED_FORMAT",
            "Only GLB version 2 is supported",
        ));
    }
    let length = word(8) as usize;
    if length != bytes.len() {
        return Err(invalid("GLB length mismatch"));
    }
    let mut offset = 12;
    let mut json = None;
    let mut bin = None;
    while offset + 8 <= bytes.len() {
        let chunk_len = word(offset) as usize;
        let chunk_type = word(offset + 4);
        offset += 8;
        let end = offset
            .checked_add(chunk_len)
            .ok_or_else(|| invalid("GLB chunk overflow"))?;
        if end > bytes.len() {
            return Err(invalid("GLB chunk exceeds file"));
        }
        let data = &bytes[offset..end];
        match chunk_type {
            0x4E4F_534A => json = Some(serde_json::from_slice::<Value>(data)?),
            0x004E_4942 => bin = Some(offset..end),
            _ => {}
        }
        offset = end;
    }
    Ok((
        json.ok_or_else(|| invalid("GLB JSON chunk is required"))?,
        bin.unwrap_or(0..0),
    ))
}
/// The triangles of the glTF primitive `p`: its indices', else its unindexed positions', a
/// positive multiple of three.
pub(crate) fn primitive_triangles(g: &Value, p: &Value) -> Result<usize> {
    let position = position_accessor(g, p)?;
    let (accessor, refused): (_, fn() -> CompilerError) = match p.get("indices") {
        Some(indices) => {
            let id = required_index(Some(indices), "primitive.indices")?;
            let refused = || {
                let message = "Index count must be a positive multiple of three";
                CompilerError::new("INVALID_TRIANGLES", message)
            };
            (item(values(g, "accessors")?, id, "accessor")?, refused)
        }
        None => (position, || {
            invalid("Unindexed POSITION count must be a positive multiple of three")
        }),
    };
    let count = required_index(accessor.get("count"), "accessor.count")?;
    if count == 0 || count % 3 != 0 {
        return Err(refused());
    }
    Ok(count / 3)
}
pub(crate) fn node_triangles(g: &Value, node: &Value) -> Result<usize> {
    let mesh_id = required_index(node.get("mesh"), "node.mesh")?;
    let mesh = item(values(g, "meshes")?, mesh_id, "mesh")?;
    let mut triangles = 0;
    for p in values(mesh, "primitives")? {
        triangles += primitive_triangles(g, p)?;
    }
    Ok(triangles)
}
pub(crate) fn source_stats(g: &Value) -> Result<(usize, usize)> {
    let mut mesh_nodes = 0;
    let mut triangles = 0;
    for n in values(g, "nodes")? {
        if n.get("mesh").is_some() {
            mesh_nodes += 1;
            triangles += node_triangles(g, n)?;
        }
    }
    Ok((mesh_nodes, triangles))
}
