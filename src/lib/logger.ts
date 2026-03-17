import "server-only";

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

const LOG_DIR = process.env.LLMGPS_LOG_DIR || path.join(process.cwd(), "logs");
const RETENTION_DAYS = 1;

function ensureLogDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFilePath() {
  return path.join(LOG_DIR, `llmgps-${todayStamp()}.log`);
}

function purgeOldLogs() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffStamp = cutoff.toISOString().slice(0, 10);

    for (const file of readdirSync(LOG_DIR)) {
      const match = file.match(/^llmgps-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match && match[1] < cutoffStamp) {
        try {
          unlinkSync(path.join(LOG_DIR, file));
        } catch {
          // best effort
        }
      }
    }
  } catch {
    // log dir may not exist yet
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const parts = [`${error.name}: ${error.message}`];

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    parts.push(`  cause: ${cause.name}: ${cause.message}`);
    if (cause.stack) parts.push(`  cause stack: ${cause.stack}`);
  } else if (cause !== undefined) {
    parts.push(`  cause: ${String(cause)}`);
  }

  if (error.stack) parts.push(error.stack);
  return parts.join("\n");
}

function write(level: string, context: string, message: string, error?: unknown) {
  ensureLogDir();
  purgeOldLogs();

  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${level}] [${context}] ${message}`;
  if (error !== undefined) {
    line += `\n${formatError(error)}`;
  }
  line += "\n";

  try {
    appendFileSync(logFilePath(), line, "utf-8");
  } catch {
    // fallback to stderr if file write fails
    process.stderr.write(line);
  }
}

export function logError(context: string, message: string, error?: unknown) {
  write("ERROR", context, message, error);
}

export function logWarn(context: string, message: string, error?: unknown) {
  write("WARN", context, message, error);
}

export function logInfo(context: string, message: string) {
  write("INFO", context, message);
}
