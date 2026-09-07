import type { TomlTableWithoutBigInt } from "smol-toml";

/** Require an object-shaped TOML table and identify the invalid field on failure. */
export function requireTable(value: unknown, field: string): TomlTableWithoutBigInt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a table`);
  }
  return value as TomlTableWithoutBigInt;
}

/** Require a non-empty string at a serialized-data boundary. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a string`);
  return value;
}
