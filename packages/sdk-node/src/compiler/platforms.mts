/** The machines the compiler release targets, as `process.platform`-`process.arch`. */
export const SUPPORTED_PLATFORMS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
] as const;
