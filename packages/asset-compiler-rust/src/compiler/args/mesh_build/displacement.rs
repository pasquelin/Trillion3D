//! The baked displacement settings of a mesh's build (`meshBuild`,
//! `MeshDisplacementBakeSettingsWire`): its height maps, the set of texture coordinates they are
//! read at and how the tessellation shares the vertices it adds (`displace::DisplacementSettings`).
//! Each source names them as it names the others (`mesh_build.rs`): a rule's, the scene's, the
//! mesh's own `extras`; the reference's default — no map, nothing baked — where none does.
use crate::compiler::args::name_match::present;
use crate::compiler::args::reader::Reader;
use crate::compiler::validate::OPTIONS;
use crate::displace::abi::{
    DEFAULT_DISPLACEMENT_MAP_CENTER, DEFAULT_DISPLACEMENT_MAP_MAGNITUDE, DISPLACEMENT_EDGE_SPLITS,
    DISPLACEMENT_EDGE_SPLIT_SETTING, DISPLACEMENT_MAPS_SETTING, DISPLACEMENT_MAP_KEYS,
    DISPLACEMENT_TEXTURE_KEYS, DISPLACEMENT_UV_CHANNEL_SETTING, MAX_DISPLACEMENT_UV_CHANNEL,
};
use crate::displace::{DisplacementSettings, EdgeSplit, MapSpec};
use crate::simplify::CENTIMETRES;
use crate::Result;
use serde_json::Value;

/// The baked displacement settings one source names, each none where it names none.
#[derive(Clone, Debug, Default)]
pub(super) struct NamedDisplacement {
    maps: Option<Vec<MapSpec>>,
    uv_channel: Option<usize>,
    edge_split: Option<EdgeSplit>,
}

/// The finite number `value` names, `default` where it is left out or `null`, `what` naming it in
/// the refusal of one that is no number.
fn number(value: Option<&Value>, default: f64, what: &str) -> Result<f64> {
    match present(value) {
        None => Ok(default),
        Some(value) => OPTIONS.bounded(value, what, (-f64::MAX, f64::MAX), "a finite number"),
    }
}

/// The 32-bit float `value` names, `default` where it is left out or `null`, `what` naming it: a
/// finite number the float holds finite, and, for a magnitude (`centimetres`), its product with
/// `CENTIMETRES`, the unit the tessellation works in.
fn float(value: Option<&Value>, default: f64, what: &str, centimetres: bool) -> Result<f32> {
    let number = number(value, default, what)? as f32;
    let scaled = number * if centimetres { CENTIMETRES } else { 1.0 };
    match scaled.is_finite() {
        true => Ok(number),
        false => Err(OPTIONS.bad(format!(
            "{what} must be a number a 32-bit float holds{}, got {}",
            if centimetres { " in centimetres" } else { "" },
            value.map_or_else(|| default.to_string(), Value::to_string),
        ))),
    }
}

/// The height map `value` names, `what` naming it: an object of `texture`, a texture info with a
/// whole `index` and no other field, and the `magnitude` and the `center` of its heights.
fn map_spec(value: &Value, what: &str) -> Result<MapSpec> {
    let map = OPTIONS.known(value, &DISPLACEMENT_MAP_KEYS, what)?;
    let [texture_key, magnitude_key, center_key] = DISPLACEMENT_MAP_KEYS;
    let texture = present(map.get(texture_key))
        .ok_or_else(|| OPTIONS.bad(format!("{what} names no {texture_key}")))?;
    let info = OPTIONS.known(
        texture,
        &DISPLACEMENT_TEXTURE_KEYS,
        &format!("{what}.{texture_key}"),
    )?;
    let index = OPTIONS.index(info.get("index"), &format!("{what}.{texture_key}.index"))?;
    let magnitude = float(
        map.get(magnitude_key),
        DEFAULT_DISPLACEMENT_MAP_MAGNITUDE,
        &format!("{what}.{magnitude_key}"),
        true,
    )?;
    let center = float(
        map.get(center_key),
        DEFAULT_DISPLACEMENT_MAP_CENTER,
        &format!("{what}.{center_key}"),
        false,
    )?;
    Ok(MapSpec {
        texture: index,
        magnitude,
        center,
    })
}

impl NamedDisplacement {
    /// The baked displacement settings `read` holds: `displacementMaps` a list of height maps,
    /// `displacementUvChannel` a whole number from 0 to `MAX_DISPLACEMENT_UV_CHANNEL`,
    /// `displacementEdgeSplit` one of `DISPLACEMENT_EDGE_SPLITS`.
    pub(super) fn of(read: &Reader<'_>) -> Result<Self> {
        let maps = match present(read.map.get(DISPLACEMENT_MAPS_SETTING)) {
            None => None,
            Some(list) => {
                let what = format!("{}{DISPLACEMENT_MAPS_SETTING}", read.what);
                let items = OPTIONS.array(list, &what)?;
                let maps = (items.iter().enumerate())
                    .map(|(at, item)| map_spec(item, &format!("{what}[{at}]")))
                    .collect::<Result<Vec<_>>>()?;
                Some(maps)
            }
        };
        let takes = format!("a whole number from 0 to {MAX_DISPLACEMENT_UV_CHANNEL}");
        let uv_channel = read.whole(
            DISPLACEMENT_UV_CHANNEL_SETTING,
            (0, MAX_DISPLACEMENT_UV_CHANNEL),
            &takes,
        )?;
        let edge_split = match present(read.map.get(DISPLACEMENT_EDGE_SPLIT_SETTING)) {
            None => None,
            Some(value) => {
                let what = format!("{}{DISPLACEMENT_EDGE_SPLIT_SETTING}", read.what);
                let named = value.as_str().and_then(EdgeSplit::named);
                let takes = DISPLACEMENT_EDGE_SPLITS.join(" or ");
                let refused = || OPTIONS.bad(format!("{what} must be {takes}, got {value}"));
                Some(named.ok_or_else(refused)?)
            }
        };
        Ok(Self {
            maps,
            uv_channel: uv_channel.map(|n| n as usize),
            edge_split,
        })
    }

    /// These settings, each that names none taken from `lower`.
    pub(super) fn or(self, lower: Self) -> Self {
        Self {
            maps: self.maps.or(lower.maps),
            uv_channel: self.uv_channel.or(lower.uv_channel),
            edge_split: self.edge_split.or(lower.edge_split),
        }
    }

    /// Every setting, the default where none was named.
    pub(super) fn resolved(self) -> DisplacementSettings {
        let default = DisplacementSettings::default();
        DisplacementSettings {
            maps: self.maps.unwrap_or(default.maps),
            uv_channel: self.uv_channel.unwrap_or(default.uv_channel),
            edge_split: self.edge_split.unwrap_or(default.edge_split),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MeshBuildOptions;
    use serde_json::json;

    /// The baked displacement settings of each mesh of `g` under the job's `meshBuild`.
    fn settings(job: Option<&Value>, g: &Value) -> Vec<DisplacementSettings> {
        let built = MeshBuildOptions::read(job).expect("read").meshes(g);
        let built = built.expect("meshes");
        built.into_iter().map(|build| build.displacement).collect()
    }

    fn scene() -> Value {
        json!({
            "nodes": [{"name": "Rock", "mesh": 0}, {"name": "Wall", "mesh": 1}],
            "meshes": [
                {},
                {"extras": {
                    "displacementMaps": [{"texture": {"index": 2}, "magnitude": 0.5}],
                    "displacementUvChannel": 1
                }}
            ]
        })
    }

    // Behaviour: a mesh bakes no displacement unless a source names a map; its own `extras` do.
    #[test]
    fn a_mesh_bakes_nothing_unless_a_source_names_a_map() {
        let all = settings(None, &scene());
        assert!(all[0].is_off());
        let map = MapSpec {
            texture: 2,
            magnitude: 0.5,
            center: 0.0,
        };
        assert_eq!(all[1].maps, vec![map]);
        assert_eq!(
            (all[1].uv_channel, all[1].edge_split),
            (1, EdgeSplit::Seams)
        );
    }

    // Behaviour: for each setting the first source that names it wins: a rule for the mesh's
    // objects, the scene's, the mesh's own `extras`.
    #[test]
    fn the_rule_of_an_object_beats_the_scene_which_beats_the_mesh() {
        let job = json!({
            "displacementUvChannel": 3,
            "objects": [{
                "match": "Rock",
                "displacementMaps": [{"texture": {"index": 7}}],
                "displacementEdgeSplit": "always-duplicate"
            }]
        });
        let all = settings(Some(&job), &scene());
        let rock = MapSpec {
            texture: 7,
            magnitude: 0.0,
            center: 0.0,
        };
        assert_eq!(all[0].maps, vec![rock]);
        assert_eq!(all[0].edge_split, EdgeSplit::AlwaysDuplicate);
        assert_eq!(all[0].uv_channel, 3);
        assert_eq!((all[1].uv_channel, all[1].maps.len()), (3, 1));
    }

    // Behaviour: a value that does not read refuses the job, naming the setting.
    #[test]
    fn a_value_that_does_not_read_is_refused_by_name() {
        for (job, named) in [
            (json!({"displacementMaps": {}}), "displacementMaps"),
            (json!({"displacementMaps": [{"magnitude": 1}]}), "texture"),
            (
                json!({"displacementMaps": [{"texture": {"index": -1}}]}),
                "index",
            ),
            (
                json!({"displacementMaps": [{"texture": {"index": 0}, "scale": 1}]}),
                "scale",
            ),
            (
                json!({"displacementMaps": [{"texture": {"index": 0, "texCoord": 1}}]}),
                "texCoord",
            ),
            (
                json!({"displacementMaps": [{"texture": {"index": 0}, "magnitude": 1e300}]}),
                "magnitude",
            ),
            (
                json!({"displacementMaps": [{"texture": {"index": 0}, "magnitude": 1e37}]}),
                "magnitude",
            ),
            (
                json!({"displacementMaps": [{"texture": {"index": 0}, "center": -1e40}]}),
                "center",
            ),
            (json!({"displacementUvChannel": 8}), "displacementUvChannel"),
            (
                json!({"displacementEdgeSplit": "none"}),
                "displacementEdgeSplit",
            ),
        ] {
            let refusal = MeshBuildOptions::read(Some(&job)).expect_err(named);
            assert!(refusal.contains(named), "{refusal}");
        }
        let g = json!({"meshes": [{"extras": {"displacementUvChannel": 9}}]});
        let refused = MeshBuildOptions::read(None).expect("read").meshes(&g);
        let refusal = refused.expect_err("extras").message;
        assert!(refusal.contains("displacementUvChannel"), "{refusal}");
    }
}
