//! A job's hair strands settings as the compiler reads them: `hairEndingPoint`, whether each curve of a
//! groom is given one control point more at its end, so that a strip of triangles drawn from the points
//! does not lose the last segment of the curve (`hair_strands::build`), and `hairGroups`, the settings a
//! job names for the groups of a groom by group number (whether a group is drawn stable, whether it
//! lights the scene behind it), which the group's flags carry to the renderer. A job that names none
//! gives the point and leaves every group to the project's settings. Read and checked here once; what
//! does not read is the job's refusal (`INVALID_OPTIONS`, `validate_compile_options`).
use super::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::hair_strands::abi::{
    HAIR_STRANDS_ENDING_POINT_FIELD, HAIR_STRANDS_FLAG_SCATTER, HAIR_STRANDS_FLAG_SCATTER_SET,
    HAIR_STRANDS_FLAG_STABLE, HAIR_STRANDS_FLAG_STABLE_SET, HAIR_STRANDS_GROUPS_FIELD,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// The settings of the job's `hairGroups` for one group: each is none where the job left it out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct GroupSettings {
    stable_rasterization: Option<bool>,
    scatter_scene_lighting: Option<bool>,
}

impl GroupSettings {
    /// The settings the job named, as the cache key holds them.
    fn identity(&self) -> Value {
        let mut named = Map::new();
        if let Some(on) = self.stable_rasterization {
            named.insert("stableRasterization".into(), json!(on));
        }
        if let Some(on) = self.scatter_scene_lighting {
            named.insert("scatterSceneLighting".into(), json!(on));
        }
        Value::Object(named)
    }

    /// The flags of a group's record that carry these settings: a setting the job named sets its
    /// "named" bit and, when true, its value bit.
    fn flags(&self) -> u32 {
        let bits = |setting: Option<bool>, set: u32, value: u32| match setting {
            Some(true) => set | value,
            Some(false) => set,
            None => 0,
        };
        bits(
            self.stable_rasterization,
            HAIR_STRANDS_FLAG_STABLE_SET,
            HAIR_STRANDS_FLAG_STABLE,
        ) | bits(
            self.scatter_scene_lighting,
            HAIR_STRANDS_FLAG_SCATTER_SET,
            HAIR_STRANDS_FLAG_SCATTER,
        )
    }
}

/// A job's hair strands settings: whether a curve is given its ending point, and the settings of the
/// groups the job names.
#[derive(Clone, Debug)]
pub struct HairOptions {
    ending_point: bool,
    groups: BTreeMap<i32, GroupSettings>,
}

impl Default for HairOptions {
    fn default() -> Self {
        Self {
            ending_point: true,
            groups: BTreeMap::new(),
        }
    }
}

impl HairOptions {
    /// The settings the job's `hairEndingPoint` and `hairGroups` fields name; `Err` with the job's
    /// refusal when the first is neither `true` nor `false`, or the second is not an object whose keys
    /// are group numbers and whose values hold `stableRasterization` and `scatterSceneLighting`, each
    /// `true`, `false` or null.
    pub fn read(
        ending_point: Option<&Value>,
        groups: Option<&Value>,
    ) -> std::result::Result<Self, String> {
        let ending_point = match present(ending_point) {
            None => true,
            Some(value) => OPTIONS
                .boolean(Some(value), HAIR_STRANDS_ENDING_POINT_FIELD)
                .map_err(|refusal| refusal.message)?,
        };
        let groups = match present(groups) {
            None => BTreeMap::new(),
            Some(value) => Self::read_groups(value).map_err(|refusal| refusal.message)?,
        };
        Ok(Self {
            ending_point,
            groups,
        })
    }

    fn read_groups(value: &Value) -> crate::Result<BTreeMap<i32, GroupSettings>> {
        let named = OPTIONS.object(value, HAIR_STRANDS_GROUPS_FIELD)?;
        let mut groups = BTreeMap::new();
        for (key, group) in named {
            let what = format!("{HAIR_STRANDS_GROUPS_FIELD}.{key}");
            let id: i32 = key
                .parse()
                .ok()
                .filter(|_| !key.starts_with('+'))
                .ok_or_else(|| OPTIONS.bad(format!("{what} is not a group number")))?;
            let fields = OPTIONS.known(
                group,
                &["stableRasterization", "scatterSceneLighting"],
                &what,
            )?;
            let read = |name: &str| {
                OPTIONS.optional(
                    fields.get(name),
                    &format!("{what}.{name}"),
                    |checks, value, what| checks.boolean(value, what),
                )
            };
            let settings = GroupSettings {
                stable_rasterization: read("stableRasterization")?,
                scatter_scene_lighting: read("scatterSceneLighting")?,
            };
            if settings != GroupSettings::default() {
                groups.insert(id, settings);
            }
        }
        Ok(groups)
    }

    /// Whether a curve is given a control point more at its end.
    pub(crate) fn ending_point(&self) -> bool {
        self.ending_point
    }

    /// The flags the job gives the group numbered `id` (`HAIR_STRANDS_FLAG_*_SET` and their values),
    /// none for a group it does not name.
    pub(crate) fn group_flags(&self, id: i32) -> u32 {
        self.groups.get(&id).map_or(0, GroupSettings::flags)
    }

    /// What named the ending point, for the cache key: `None` while it is the default, so that a job
    /// that gives the point, named or not, keeps its key.
    pub fn identity(&self) -> Option<Value> {
        (!self.ending_point).then(|| json!(false))
    }

    /// What named the groups, for the cache key: `None` while the job names none.
    pub fn groups_identity(&self) -> Option<Value> {
        (!self.groups.is_empty()).then(|| {
            Value::Object(
                self.groups
                    .iter()
                    .map(|(id, settings)| (id.to_string(), settings.identity()))
                    .collect::<Map<_, _>>(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_curve_is_given_its_ending_point_unless_the_job_says_not() {
        assert!(HairOptions::read(None, None).expect("none").ending_point());
        assert!(HairOptions::read(Some(&Value::Null), None)
            .expect("null")
            .ending_point());
        assert!(HairOptions::read(Some(&json!(true)), None)
            .expect("true")
            .ending_point());
        let off = HairOptions::read(Some(&json!(false)), None).expect("false");
        assert!(!off.ending_point());
        assert_eq!(off.identity(), Some(json!(false)));
        assert_eq!(HairOptions::default().identity(), None);
    }

    #[test]
    fn an_ending_point_that_is_not_a_boolean_is_the_jobs_refusal_by_name() {
        let refusal = HairOptions::read(Some(&json!("yes")), None).expect_err("a word");
        assert!(refusal.contains("hairEndingPoint"), "{refusal}");
    }

    #[test]
    fn a_group_the_job_names_carries_its_settings_in_its_flags() {
        let job = json!({
            "2": {"stableRasterization": true},
            "-1": {"scatterSceneLighting": false},
            "7": {}
        });
        let options = HairOptions::read(None, Some(&job)).expect("groups");
        assert_eq!(
            options.group_flags(2),
            HAIR_STRANDS_FLAG_STABLE_SET | HAIR_STRANDS_FLAG_STABLE
        );
        assert_eq!(options.group_flags(-1), HAIR_STRANDS_FLAG_SCATTER_SET);
        assert_eq!(options.group_flags(7), 0, "a group that names nothing");
        assert_eq!(options.group_flags(3), 0, "a group the job does not name");
        assert!(options.groups_identity().is_some());
        assert_eq!(HairOptions::default().groups_identity(), None);
        let empty = HairOptions::read(None, Some(&json!({}))).expect("none");
        assert_eq!(empty.groups_identity(), None);
    }

    #[test]
    fn groups_that_are_not_numbered_settings_are_the_jobs_refusal_by_name() {
        for bad in [
            json!({"hair": {}}),
            json!({"1": {"shadow": true}}),
            json!({"1": {"stableRasterization": 1}}),
            json!([]),
        ] {
            let refusal = HairOptions::read(None, Some(&bad)).expect_err("refused");
            assert!(refusal.contains("hairGroups"), "{refusal}");
        }
    }
}
