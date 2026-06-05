import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class DiagnosticLog {
  constructor(readonly path: string) {}

  async write(event: string, data: Record<string, unknown> = {}): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const redacted = redact(data) as Record<string, unknown>;
    const entry = {
      at: new Date().toISOString(),
      event,
      ...redacted,
    };
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /api[-_]?key|authorization|password|secret|token/i.test(key)
        ? "[redacted]"
        : redact(item),
    ]),
  );
}
