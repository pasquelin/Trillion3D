//! The one error of the compiler: a stable code a host matches on, and a message for people.
use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub struct CompilerError {
    pub code: &'static str,
    pub message: String,
}
impl CompilerError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl Display for CompilerError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for CompilerError {}
impl From<std::io::Error> for CompilerError {
    fn from(value: std::io::Error) -> Self {
        Self::new("IO_ERROR", value.to_string())
    }
}
impl From<serde_json::Error> for CompilerError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("INVALID_JSON", value.to_string())
    }
}
impl From<rayon::ThreadPoolBuildError> for CompilerError {
    fn from(value: rayon::ThreadPoolBuildError) -> Self {
        Self::new("THREAD_POOL_ERROR", value.to_string())
    }
}
pub type Result<T> = std::result::Result<T, CompilerError>;
