use super::{SceneProxy, SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC, SCENE_PROXY_VERSION};

impl SceneProxy {
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
