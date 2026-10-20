//! The encoder's refusal: a stable code and what it says, and the result it rides in.
/// A refusal of the encoder: a stable code and what it says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodeError {
    pub code: &'static str,
    pub message: &'static str,
}

impl EncodeError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// The encoder's result: a value or its refusal.
pub type Result<T> = std::result::Result<T, EncodeError>;
