//! The settings one map of the job holds, read by key (`Reader`): a switch, a number or a whole
//! number within its bounds, none where the map holds none, a refusal naming the setting and what
//! it takes (`INVALID_OPTIONS`) where it does not read. The one reader set of the job's own maps:
//! a mesh build's (`mesh_build.rs`, `mesh_build/voxels.rs`), an object's draw distance
//! (`objects/draw_distance.rs`) and a partition grid's (`partition.rs`, `partition/settings.rs`).
use crate::compiler::args::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::Result;
use serde_json::{Map, Value};

/// A source's `map`, `what` prefixing a key in the refusal of a value that does not read.
pub(crate) struct Reader<'a> {
    pub(crate) map: &'a Map<String, Value>,
    pub(crate) what: &'a str,
}

impl<'a> Reader<'a> {
    /// The value `key` names, none when it is left out or `null`, and the name a refusal gives it.
    fn named(&self, key: &str) -> Option<(&'a Value, String)> {
        present(self.map.get(key)).map(|value| (value, format!("{}{key}", self.what)))
    }

    /// The switch `key` names.
    pub(crate) fn boolean(&self, key: &str) -> Result<Option<bool>> {
        (self.named(key))
            .map(|(value, name)| {
                (value.as_bool()).ok_or_else(|| {
                    OPTIONS.bad(format!("{name} must be true or false, got {value}"))
                })
            })
            .transpose()
    }

    /// The finite number `key` names, from `low` to `high`, `takes` saying so in the refusal.
    pub(crate) fn number(
        &self,
        key: &str,
        (low, high): (f64, f64),
        takes: &str,
    ) -> Result<Option<f64>> {
        (self.named(key))
            .map(|(value, name)| OPTIONS.bounded(value, &name, (low, high), takes))
            .transpose()
    }

    /// The number of metres above 0 `key` names.
    pub(crate) fn metres(&self, key: &str) -> Result<Option<f64>> {
        self.number(
            key,
            (f64::MIN_POSITIVE, f64::MAX),
            "a number of metres above 0",
        )
    }

    /// The whole number `key` names, from `low` to `high`, `takes` saying so in the refusal.
    pub(crate) fn whole(
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
