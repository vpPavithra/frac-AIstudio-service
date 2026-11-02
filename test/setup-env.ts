// Tests assert on responses, not log lines; keep the output readable unless a run asks for logs.
process.env.LOG_LEVEL ??= "error";
