//! The settings one source's map holds, read by key (`Reader`): a switch, a number or a whole
//! number within its bounds, none where the map holds none; the one reader set of a mesh build
//! (`mesh_build.rs`, `voxels.rs`).
use crate::compiler::args::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::Result;
use serde_json::{Map, Value};

/// A source's `map`, `what` prefixing a key in the refusal of a value that does not read.
pub(super) struct Reader<'a> {
    pub(super) map: &'a Map<String, Value>,
    pub(super) what: &'a str,
}

impl<'a> Reader<'a> {
    /// The value `key` names, none when it is left out or `null`, and the name a refusal gives it.
    fn named(&self, key: &str) -> Option<(&'a Value, String)> {
        present(self.map.get(key)).map(|value| (value, format!("{}{key}", self.what)))
    }

    /// The switch `key` names.
    pub(super) fn boolean(&self, key: &str) -> Result<Option<bool>> {
        (self.named(key))
            .map(|(value, name)| OPTIONS.boolean(Some(value), &name))
            .transpose()
    }

    /// The finite number `key` names, from `low` to `high`, `takes` saying so in the refusal.
    pub(super) fn number(
        &self,
        key: &str,
        (low, high): (f64, f64),
        takes: &str,
    ) -> Result<Option<f64>> {
        (self.named(key))
            .map(|(value, name)| OPTIONS.bounded(value, &name, (low, high), takes))
            .transpose()
    }

    /// The whole number `key` names, from `low` to `high`, `takes` saying so in the refusal.
    pub(super) fn whole(
        &self,
        key: &str,
        (low, high): (i64, i64),
        takes: &str,
    ) -> Result<Option<i64>> {
        (self.named(key))
            .map(|(value, name)| OPTIONS.whole(value, &name, (low, high), takes))
            .transpose()
    }
}
