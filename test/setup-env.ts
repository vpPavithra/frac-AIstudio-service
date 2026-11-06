// Jest setupFiles entry (jest.config.js): runs before each test file and sets quiet, fast defaults.
// Values already set in the environment win.
// Tests assert on responses, not log lines; keep the output readable unless a run asks for logs.
process.env.LOG_LEVEL ??= "error";
// Mock model calls answer instantly in tests (the default pauses so progress is visible).
process.env.MOCK_DELAY_MS ??= "0";
