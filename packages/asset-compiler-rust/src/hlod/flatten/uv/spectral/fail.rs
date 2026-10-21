//! The errors of the spectral charts, one code for every way the library refuses: the input is
//! malformed (an argument out of its range), the mesh cannot be charted (not a manifold, false
//! edges that cut it apart), or a step ends where the library gives up (too few charts allowed, a
//! closed surface left uncut). The caller treats them all as the library's failure.
use crate::CompilerError;

/// The code of every spectral chart error.
const CODE: &str = "HLOD_UV_CHARTS";

/// An argument outside what the library accepts.
pub(crate) fn invalid_argument(what: &str) -> CompilerError {
    CompilerError::new(CODE, format!("invalid argument: {what}"))
}

/// A mesh the library cannot chart.
pub(crate) fn invalid_data(what: &str) -> CompilerError {
    CompilerError::new(CODE, format!("invalid mesh: {what}"))
}

/// A step that gives up.
pub(crate) fn failed(what: &str) -> CompilerError {
    CompilerError::new(CODE, format!("charting failed: {what}"))
}
