//! A job's `hairEndingPoint` as the compiler reads it: whether each curve of a groom is given one
//! control point more at its end, so that a strip of triangles drawn from the points does not lose
//! the last segment of the curve (`hair_strands::build`). The field is `true` or `false`; a job that
//! names none gives the point. Read and checked here once; what does not read is the job's refusal
//! (`INVALID_OPTIONS`, `validate_compile_options`).
use super::name_match::present;
use crate::compiler::validate::OPTIONS;
use crate::hair_strands::abi::HAIR_STRANDS_ENDING_POINT_FIELD;
use serde_json::{json, Value};

/// A job's hair strands settings: whether a curve is given its ending point.
#[derive(Clone, Debug)]
pub struct HairOptions {
    ending_point: bool,
}

impl Default for HairOptions {
    fn default() -> Self {
        Self { ending_point: true }
    }
}

impl HairOptions {
    /// The settings the job's `hairEndingPoint` field names; `Err` with the job's refusal when it is
    /// neither `true` nor `false`.
    pub fn read(value: Option<&Value>) -> std::result::Result<Self, String> {
        let Some(value) = present(value) else {
            return Ok(Self::default());
        };
        OPTIONS
            .boolean(Some(value), HAIR_STRANDS_ENDING_POINT_FIELD)
            .map(|ending_point| Self { ending_point })
            .map_err(|refusal| refusal.message)
    }

    /// Whether a curve is given a control point more at its end.
    pub(crate) fn ending_point(&self) -> bool {
        self.ending_point
    }

    /// What named the settings, for the cache key: `None` while they are the default, so that a job
    /// that gives the point, named or not, keeps its key.
    pub fn identity(&self) -> Option<Value> {
        (!self.ending_point).then(|| json!(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_curve_is_given_its_ending_point_unless_the_job_says_not() {
        assert!(HairOptions::read(None).expect("none").ending_point());
        assert!(HairOptions::read(Some(&Value::Null))
            .expect("null")
            .ending_point());
        assert!(HairOptions::read(Some(&json!(true)))
            .expect("true")
            .ending_point());
        let off = HairOptions::read(Some(&json!(false))).expect("false");
        assert!(!off.ending_point());
        assert_eq!(off.identity(), Some(json!(false)));
        assert_eq!(HairOptions::default().identity(), None);
    }

    #[test]
    fn an_ending_point_that_is_not_a_boolean_is_the_jobs_refusal_by_name() {
        let refusal = HairOptions::read(Some(&json!("yes"))).expect_err("a word");
        assert!(refusal.contains("hairEndingPoint"), "{refusal}");
    }
}
