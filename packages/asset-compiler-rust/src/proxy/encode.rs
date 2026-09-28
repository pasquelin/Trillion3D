use super::{
    SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
    PROXY_TRIANGLE_FLOATS, SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION,
};
use serde_json::{json, Value};

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
         "cellFloorMetres": PROXY_CELL_METRES,
         "triangleBudget": PROXY_TRIANGLE_BUDGET,
         "bounds": self.bounds,
         "triangles": self.triangle_count(),
         "nodes": self.node_count(),
        })
    }

    /// Cache object bytes in little-endian: header, shape counts, shape vertices and albedos,
    /// instance shapes and maps, the flat position of each placed shape triangle, then the
    /// triangles no shape carries, their albedos, node bounds and links. No repeated lengths —
    /// header imposes all, reader refuses file of other size.
    pub fn encode(&self) -> Vec<u8> {
        let sharing = &self.sharing;
        let mut shared = vec![false; self.triangle_count()];
        for &position in &sharing.positions {
            shared[position as usize] = true;
        }
        let loose: Vec<usize> = (0..shared.len()).filter(|p| !shared[*p]).collect();
        let shape_triangles: Vec<usize> = sharing
            .shapes
            .iter()
            .flatten()
            .map(|p| *p as usize)
            .collect();
        let mut words: Vec<u32> = vec![
            SCENE_PROXY_MAGIC,
            SCENE_PROXY_VERSION,
            self.triangle_count() as u32,
            self.node_count() as u32,
            sharing.shapes.len() as u32,
            shape_triangles.len() as u32,
            sharing.instances.len() as u32,
        ];
        debug_assert_eq!(words.len(), SCENE_PROXY_HEADER_WORDS);
        words.extend(sharing.shapes.iter().map(|shape| shape.len() as u32));
        let triangles_of = |positions: &[usize], words: &mut Vec<u32>| {
            for p in positions {
                let at = p * PROXY_TRIANGLE_FLOATS;
                let vertices = &self.triangles[at..at + PROXY_TRIANGLE_FLOATS];
                words.extend(vertices.iter().map(|v| v.to_bits()));
            }
            words.extend(positions.iter().map(|p| self.albedo[*p]));
        };
        triangles_of(&shape_triangles, &mut words);
        words.extend(sharing.instances.iter().map(|(shape, _)| *shape));
        for (_, map) in &sharing.instances {
            words.extend(map.iter().map(|v| v.to_bits()));
        }
        words.extend_from_slice(&sharing.positions);
        triangles_of(&loose, &mut words);
        words.extend(self.node_bounds.iter().map(|v| v.to_bits()));
        words.extend_from_slice(&self.node_children);
        words.iter().flat_map(|word| word.to_le_bytes()).collect()
    }
}

#[cfg(test)]
#[path = "encode_tests.rs"]
pub(crate) mod tests;
