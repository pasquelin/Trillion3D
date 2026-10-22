//! The grids a job's `partitionGrids` names: a list of entries, each the settings `partitionGrid`
//! takes under a name — a text not empty, holding none of `PARTITION_GRID_NAME_FORBIDDEN`, which
//! split the reference's grid names into parts —, the first the default grid, which an object
//! naming none, or a grid the list does not hold, streams on; and how an object finds its grid by
//! its name (`rank_of`), the names told apart without regard to case, as the reference's are.
use super::super::name_match::present;
use super::super::*;
use super::settings::unknown_setting;
use super::{GridSettings, PartitionGrid, PartitionScheme};

/// The grid name `value` holds: a text not empty, holding none of `PARTITION_GRID_NAME_FORBIDDEN`;
/// `None` for any other value. The one test of a grid's name, its entry's (`grid_name`) and an
/// object's `runtimeGrid` (`objects.rs`).
pub(crate) fn grid_name_of(value: &Value) -> Option<&str> {
    (value.as_str()).filter(|name| {
        !name.is_empty() && !name.contains(|c: char| PARTITION_GRID_NAME_FORBIDDEN.contains(c))
    })
}

/// Whether grid names `a` and `b` are one name: the same letters without regard to case.
fn same_name(a: &str, b: &str) -> bool {
    (a.chars().flat_map(char::to_lowercase)).eq(b.chars().flat_map(char::to_lowercase))
}

/// The name of the grid at rank `at` of the list, `name` the entry's own, `field` naming the
/// entry: the reference's first partition's when the first entry names none; `Err` for a name
/// that is not a text or no grid name, or one a later entry leaves out.
fn grid_name(
    name: Option<&Value>,
    (at, field): (usize, &str),
) -> std::result::Result<String, String> {
    let Some(name) = name else {
        return match at {
            0 => Ok(DEFAULT_PARTITION_GRID_NAME.to_string()),
            _ => Err(format!(
                "{field}: {PARTITION_GRID_NAME_KEY} is required: only the first grid may leave it out"
            )),
        };
    };
    grid_name_of(name).map(str::to_string).ok_or_else(|| {
        format!(
            "{field}: {PARTITION_GRID_NAME_KEY} must be a text with none of \
                 {PARTITION_GRID_NAME_FORBIDDEN}, got {name}"
        )
    })
}

impl PartitionGrid {
    /// The partition `list`, the value of `partitionGrids`, names under `scheme`, `scheme_identity`
    /// what named the scheme; `Err` with the job's refusal for a list that is empty or no list, an
    /// entry that does not read, a name twice, or square settings — the whole partition's — that a
    /// later entry names unlike the first's.
    pub(super) fn listed(
        list: &Value,
        scheme: PartitionScheme,
        scheme_identity: Option<Value>,
    ) -> std::result::Result<Self, String> {
        let settings = PARTITION_GRID_SETTINGS.join(", ");
        let accepted = [&[PARTITION_GRID_NAME_KEY][..], &PARTITION_GRID_SETTINGS[..]].concat();
        let entries = (list.as_array())
            .filter(|entries| !entries.is_empty())
            .ok_or_else(|| {
                format!(
                    "{PARTITION_GRIDS_FIELD} must be a list of one grid or more, each an object \
                     of {PARTITION_GRID_NAME_KEY}, {settings}, got {list}"
                )
            })?;
        let mut grids: Vec<GridSettings> = Vec::with_capacity(entries.len());
        for (at, entry) in entries.iter().enumerate() {
            let field = format!("{PARTITION_GRIDS_FIELD}[{at}]");
            let mut fields = (entry.as_object().cloned()).ok_or_else(|| {
                format!("{field} must be an object of {PARTITION_GRID_NAME_KEY}, {settings}")
            })?;
            if let Some(refusal) = unknown_setting(&fields, &accepted, &field) {
                return Err(refusal);
            }
            let name = fields.remove(PARTITION_GRID_NAME_KEY);
            let name = grid_name(present(name.as_ref()), (at, &field))?;
            if grids.iter().any(|grid| same_name(&grid.name, &name)) {
                return Err(format!(
                    "{field}: {PARTITION_GRID_NAME_KEY} {name:?} names a grid already: names are \
                     told apart without regard to case"
                ));
            }
            let mut grid = GridSettings::from_fields(&fields, scheme, &field)?;
            let first = grids.first().map(|first| first.square);
            let unlike =
                first.and_then(|f| grid.square.differing(&f, |key| fields.contains_key(key)));
            if let Some(setting) = unlike {
                return Err(format!(
                    "{field}: {setting} is the whole partition's, the first grid's: a later grid \
                     names it alike or not at all"
                ));
            }
            grid.name = name;
            grids.push(grid);
        }
        Ok(Self {
            scheme,
            grids,
            grids_identity: Some(list.clone()),
            scheme_identity,
            ..Self::default()
        })
    }

    /// The rank among the grids of the grid named `name`, told apart without regard to case; `None`
    /// for a name no grid of the job has, which streams on the first grid, the reference's
    /// fallback.
    pub(crate) fn rank_of(&self, name: &str) -> Option<usize> {
        (self.grids.iter()).position(|grid| same_name(&grid.name, name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The partition a job naming `fields` reads.
    fn read(fields: Value) -> std::result::Result<PartitionGrid, String> {
        PartitionGrid::read(fields.as_object().expect("a job"))
    }

    #[test]
    fn grids_are_named_the_first_is_the_default_and_a_name_is_told_without_case() {
        let job =
            json!({"partitionGrids": [{"cellSize": 64.0}, {"name": "Far", "cellSize": 512.0}]});
        let grid = read(job).expect("reads");
        let names: Vec<&str> = grid.grids.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, [DEFAULT_PARTITION_GRID_NAME, "Far"]);
        let cells: Vec<f64> = grid.grids.iter().map(|g| g.cell_size).collect();
        assert_eq!(cells, [64.0, 512.0]);
        let ranks = ["FAR", DEFAULT_PARTITION_GRID_NAME, "nowhere"].map(|name| grid.rank_of(name));
        assert_eq!(ranks, [Some(1), Some(0), None], "no grid is named nowhere");
    }

    #[test]
    fn a_job_naming_one_grid_or_none_reads_as_before() {
        let none = read(json!({})).expect("reads");
        assert!(none.grids.len() == 1 && none.grids_identity().is_none());
        assert_eq!(none.grids[0].name, DEFAULT_PARTITION_GRID_NAME);
        let one = read(json!({"partitionGrid": {"cellSize": 64.0}})).expect("reads");
        assert!(one.grids.len() == 1 && one.identity().is_some());
        assert_eq!(one.grids[0].cell_size, 64.0);
    }

    #[test]
    fn grids_that_cannot_be_told_apart_or_do_not_read_refuse_the_job() {
        let square =
            |settings: Value| json!({"partitionScheme": "spatialHash", "partitionGrids": settings});
        let cases = [
            (
                json!({"partitionGrid": true, "partitionGrids": [{}]}),
                "name them once",
            ),
            (json!({"partitionGrids": []}), "one grid or more"),
            (json!({"partitionGrids": [{}, {}]}), "is required"),
            (
                json!({"partitionGrids": [{}, {"name": "a:b"}]}),
                "none of :.",
            ),
            (
                json!({"partitionGrids": [{"name": "A"}, {"name": "a"}]}),
                "names a grid already",
            ),
            (
                json!({"partitionGrids": [{"cellSize": 0}]}),
                "partitionGrids[0]: cellSize",
            ),
            (json!({"partitionGrids": [{"nme": "x"}]}), "no field nme"),
            (
                square(json!([{}, {"name": "x", "nestedLevels": true}])),
                "the whole partition's",
            ),
        ];
        for (job, words) in cases {
            let refusal = read(job.clone()).expect_err("refused");
            assert!(refusal.contains(words), "{job}: {refusal}");
        }
        // The first grid's square settings, named alike by a later one, are the partition's.
        let alike = json!([{"nestedLevels": true}, {"name": "x", "nestedLevels": true}]);
        assert!(read(square(alike)).is_ok());
        // Flatness is each grid's own.
        assert!(read(json!({"partitionGrids": [{}, {"name": "x", "flat": false}]})).is_ok());
    }
}
