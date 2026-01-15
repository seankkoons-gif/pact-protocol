/**
 * H2: Logger Tests
 * 
 * Tests for structured JSON logging utility.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { log } from "../logger";

describe("logger", () => {
  const originalEnv = process.env.PACT_LOG_JSON;
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  let logOutput: string[] = [];
  let errorOutput: string[] = [];
  let warnOutput: string[] = [];
  
  beforeEach(() => {
    logOutput = [];
    errorOutput = [];
    warnOutput = [];
    
    console.log = (...args: any[]) => {
      logOutput.push(args.map(String).join(" "));
    };
    console.error = (...args: any[]) => {
      errorOutput.push(args.map(String).join(" "));
    };
    console.warn = (...args: any[]) => {
      warnOutput.push(args.map(String).join(" "));
    };
  });
  
  afterEach(() => {
    process.env.PACT_LOG_JSON = originalEnv;
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });
  
  it("logs in human-readable format by default", () => {
    log("info", "Test message", { key: "value" });
    
    expect(logOutput.length).toBe(1);
    expect(logOutput[0]).toContain("[INFO]");
    expect(logOutput[0]).toContain("Test message");
  });
  
  it("logs in JSON format when PACT_LOG_JSON=1", () => {
    process.env.PACT_LOG_JSON = "1";
    
    log("info", "Test message", { key: "value" });
    
    expect(logOutput.length).toBe(1);
    const jsonLog = JSON.parse(logOutput[0]);
    expect(jsonLog.level).toBe("info");
    expect(jsonLog.message).toBe("Test message");
    expect(jsonLog.data).toEqual({ key: "value" });
    expect(jsonLog.ts_ms).toBeTypeOf("number");
  });
  
  it("handles error level correctly", () => {
    log("error", "Error message");
    
    expect(errorOutput.length).toBe(1);
    expect(errorOutput[0]).toContain("[ERROR]");
    expect(errorOutput[0]).toContain("Error message");
  });
  
  it("handles warn level correctly", () => {
    log("warn", "Warning message");
    
    expect(warnOutput.length).toBe(1);
    expect(warnOutput[0]).toContain("[WARN]");
    expect(warnOutput[0]).toContain("Warning message");
  });
  
  it("handles messages without data", () => {
    process.env.PACT_LOG_JSON = "1";
    
    log("info", "Simple message");
    
    const jsonLog = JSON.parse(logOutput[0]);
    expect(jsonLog.message).toBe("Simple message");
    expect(jsonLog.data).toBeUndefined();
  });
});




