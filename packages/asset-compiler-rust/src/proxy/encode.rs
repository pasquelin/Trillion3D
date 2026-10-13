use super::{SceneProxy, SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION};
use serde_json::{json, Value};
use trillion3d_page_codec::proxy::{
    CutColumns, PROXY_ERROR_METRES, PROXY_NODE_WORDS, PROXY_SOURCES_COLUMN, PROXY_TRIANGLE_BUDGET,
    PROXY_TRIANGLE_FLOATS,
};

impl SceneProxy {
    /// Descriptor manifest carries: where to read object, weight, value.
    pub fn descriptor(&self, url: &str, sha256: &str, bytes: usize) -> Value {
        json!({
         "version": SCENE_PROXY_VERSION,
         "url": url,
         "sha256": sha256,
         "bytes": bytes,
         "errorMetres": self.error_metres,
         "cellMetres": self.cell_metres,
         "errorFloorMetres": PROXY_ERROR_METRES,
         "triangleBudget": PROXY_TRIANGLE_BUDGET,
         "bounds": self.bounds,
         "triangles": self.triangle_count(),
         "nodes": self.node_count(),
         "meshes": self.meshes.len(),
        })
    }

    /// Little-endian v6: a header, a table of the meshes — their triangle count, node count and grid
    /// step — and the columns of every mesh after the other, in the table's order: the triangles, their
    /// albedo, the nodes' exact bounds and their children. A mesh's links name its own triangles and
    /// nodes, from zero.
    pub fn encode(&self) -> Vec<u8> {
        let mut words = vec![
            SCENE_PROXY_MAGIC,
            SCENE_PROXY_VERSION,
            self.meshes.len() as u32,
            self.triangle_count() as u32,
            self.node_count() as u32,
            0,
        ];
        debug_assert_eq!(words.len(), SCENE_PROXY_HEADER_WORDS);
        for mesh in &self.meshes {
            words.push((mesh.triangles.len() / PROXY_TRIANGLE_FLOATS) as u32);
            words.push((mesh.node_children.len() / PROXY_NODE_WORDS) as u32);
            words.push((mesh.cell as f32).to_bits());
        }
        // Every column but the sources, each of every mesh in turn.
        let columns: Vec<_> = self.meshes.iter().map(CutColumns::column_words).collect();
        for column in 0..PROXY_SOURCES_COLUMN {
            for mesh in &columns {
                words.extend_from_slice(&mesh[column]);
            }
        }
        words.iter().flat_map(|word| word.to_le_bytes()).collect()
    }
}

#[cfg(test)]
#[path = "encode_tests.rs"]
pub(crate) mod tests;
