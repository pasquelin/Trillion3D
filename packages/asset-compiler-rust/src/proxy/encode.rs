use super::{
    SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
    SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION,
};
use serde_json::{json, Value};

impl SceneProxy {
    /// Le descriptif que le manifeste porte : où lire l'objet, ce qu'il pèse, ce qu'il vaut.
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

    /// Les octets de l'objet de cache, en petit-boutiste : l'en-tête, puis les sommets monde, les
    /// albédos, les bornes des nœuds et leurs liens, bout à bout. Aucune longueur n'y est répétée —
    /// l'en-tête les impose toutes, et un lecteur refuse un fichier d'une autre taille.
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(
            SCENE_PROXY_HEADER_WORDS * 4
                + self.triangles.len() * 4
                + self.albedo.len() * 4
                + self.node_bounds.len() * 4
                + self.node_children.len() * 4,
        );
        for word in [
            SCENE_PROXY_MAGIC,
            SCENE_PROXY_VERSION,
            self.triangle_count() as u32,
            self.node_count() as u32,
        ] {
            bytes.extend_from_slice(&word.to_le_bytes());
        }
        for value in &self.triangles {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in &self.albedo {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in &self.node_bounds {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in &self.node_children {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }
}
