type LogLevel = "info" | "warn" | "error" | "debug";

const COLORS = {
  info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m", debug: "\x1b[90m", reset: "\x1b[0m",
};

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const prefix = `${COLORS[level]}[${ts}] [${level.toUpperCase()}]${COLORS.reset}`;
  if (meta) console.log(`${prefix} ${message}`, JSON.stringify(meta));
  else console.log(`${prefix} ${message}`);
}

export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
  debug: (m: string, meta?: Record<string, unknown>) => {
    if (process.env.DEBUG === "true" || process.env.NODE_ENV === "development") log("debug", m, meta);
  },
};
