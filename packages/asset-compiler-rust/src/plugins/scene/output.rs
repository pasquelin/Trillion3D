//! What a driver that fills its tables itself hands to `finish`, and the field accessors every
//! such table set shares.
use super::ScenePlugin;
use crate::Result;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Instant,
};

/// glTF tables under construction, as `finish` writes them: their nodes, what the report
/// publishes in the clear, the conversion's cache key, and the write itself.
pub(crate) trait SceneOutput {
    fn nodes(&self) -> &[Value];
    fn counts(&self) -> &BTreeMap<&'static str, usize>;
    /// Cache key: fingerprint of the driver, of its version and of everything it has read.
    fn key(&self) -> String;
    /// Writes the scene into `directory` and returns that folder.
    fn write(
        self,
        plugin: &dyn ScenePlugin,
        directory: &Path,
        source: &Path,
        started: Instant,
    ) -> Result<PathBuf>;
}

/// The three accessors of a `SceneOutput` whose type carries `nodes`, `counts` and
/// `key_material` fields: the same fields read the same way, whatever the format.
macro_rules! scene_output_fields {
    () => {
        fn nodes(&self) -> &[serde_json::Value] {
            &self.nodes
        }
        fn counts(&self) -> &std::collections::BTreeMap<&'static str, usize> {
            &self.counts
        }
        fn key(&self) -> String {
            $crate::hash(self.key_material.as_bytes())
        }
    };
}
pub(crate) use scene_output_fields;
