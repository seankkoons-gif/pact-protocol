/**
 * H2: Structured Logging Utility
 * 
 * Provides structured JSON logging when PACT_LOG_JSON=1 is set.
 * Otherwise, uses standard console logging.
 */

export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Log a message with optional data.
 * 
 * If PACT_LOG_JSON=1, outputs JSON lines:
 *   { ts_ms, level, message, data }
 * 
 * Otherwise, uses standard console logging.
 */
export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // Check env var at runtime (not module load time) to support test environment changes
  const jsonMode = process.env.PACT_LOG_JSON === "1";
  
  if (jsonMode) {
    const logLine = {
      ts_ms: Date.now(),
      level,
      message,
      ...(data && { data }),
    };
    console.log(JSON.stringify(logLine));
  } else {
    // Standard console logging
    const prefix = `[${level.toUpperCase()}]`;
    if (data) {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](prefix, message, data);
    } else {
      console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](prefix, message);
    }
  }
}

