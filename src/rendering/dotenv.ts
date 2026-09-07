import type { ConfigValue } from "../api/types.js";

interface Entry { readonly index: number; readonly prefix: string; readonly suffix: string }

/** Validate literal dotenv strings. Expansion and shell execution are never performed. */
function dotenvValues(value: ConfigValue): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dotenv values must be an object of strings");
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== "string" || /[\r\n\0]/.test(item) || item.includes("'")) {
      throw new Error(`Invalid dotenv key or value for ${key}: use single-line strings without single quotes or NUL`);
    }
  }
  return value as Readonly<Record<string, string>>;
}

/** Parse single-line dotenv assignments and comments, rejecting ambiguous syntax and duplicate keys. */
function parse(text: string): { lines: string[]; entries: Map<string, Entry> } {
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) ?? [];
  const entries = new Map<string, Entry>();
  lines.forEach((line, index) => {
    const body = line.replace(/\r?\n$/, "");
    if (/^\s*(?:#.*)?$/.test(body)) return;
    const match = /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*)(.*)$/.exec(body);
    if (!match) throw new Error(`Unsupported dotenv syntax at line ${index + 1}`);
    const key = match[2]!;
    if (entries.has(key)) throw new Error(`Duplicate dotenv key: ${key}`);
    const rhs = match[3]!;
    const value = /^(?:'(?:[^']*)'|"(?:[^"\\]|\\.)*"|[^'"#]*?)(\s*(?:#.*)?)$/.exec(rhs);
    if (!value) throw new Error(`Unsupported dotenv quoting at line ${index + 1}`);
    entries.set(key, { index, prefix: match[1]!, suffix: value[1]! + (line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : "") });
  });
  return { lines, entries };
}

/** Merge declared keys, preserving other lines and inline comments; quote values literally. */
export function mergeDotenv(text: string, values: ConfigValue): string {
  const data = dotenvValues(values);
  const { lines, entries } = parse(text);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(data)) {
    const entry = entries.get(key);
    if (entry) lines[entry.index] = `${entry.prefix}'${value}'${entry.suffix}`;
    else {
      if (lines.length && !lines[lines.length - 1]!.endsWith("\n")) lines.push(newline);
      lines.push(`${key}='${value}'${newline}`);
    }
  }
  return lines.join("");
}

/** Restore only declared keys from their original lines, retaining all unowned lines. */
export function restoreDotenv(text: string, original: string, values: ConfigValue): string {
  const current = parse(text);
  const prior = parse(original);
  for (const key of Object.keys(dotenvValues(values))) {
    const entry = current.entries.get(key);
    const old = prior.entries.get(key);
    if (entry) current.lines[entry.index] = old ? prior.lines[old.index]! : "";
  }
  return current.lines.join("");
}
