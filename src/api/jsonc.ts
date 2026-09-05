import type { ConfigValue } from "./types.js";

/** A JSONC value with comments, ready to pass to files.jsonc. */
export class JsoncDocument {
  /** Store the rendered document text; callers construct documents through the builder commands. */
  private constructor(readonly content: string) {}

  /** @internal Build from typed commands; arbitrary unvalidated JSONC is not accepted. */
  static from(lines: readonly JsoncLine[]): JsoncDocument {
    const flattened = flatten(lines);
    if (flattened.filter((line) => line.kind === "value").length !== 1 ||
        flattened.some((line) => line.kind === "property")) {
      throw new Error("A JSONC document must contain exactly one value and no top-level properties");
    }
    return new JsoncDocument(renderLines(flattened, 0, false).join("\n") + "\n");
  }
}

/** One JSONC builder instruction. Prefer the jsonc helpers to constructing instructions manually. */
export type JsoncCommand =
  | { readonly kind: "comment"; readonly text: string }
  | { readonly kind: "blank" }
  | { readonly kind: "value"; readonly content: string }
  | { readonly kind: "property"; readonly name: string; readonly content: string };

/** A builder command or nested group. Absent/disabled groups are ignored. */
export type JsoncLine = JsoncCommand | JsoncDocument | readonly JsoncLine[] | false | null | undefined;

/** Compose JSONC line by line with comments; punctuation and escaping are generated. */
export const jsonc = {
  /** Join a document's comments and single root value, separating commands by newlines.
   * @example jsonc.concat(jsonc.comment("Editor settings"), jsonc.object([jsonc.property("theme", "dark")]))
   */
  concat(...lines: readonly JsoncLine[]): JsoncDocument {
    return JsoncDocument.from(lines);
  },
  /** Add a // comment. Each line of multiline text receives its own comment prefix. */
  comment(text: string): JsoncCommand {
    return { kind: "comment", text };
  },
  /** Insert an intentional empty line. */
  blank(): JsoncCommand {
    return { kind: "blank" };
  },
  /** Add an object property. Values may be ordinary JSON data or a nested JSONC document. */
  property(name: string, value: ConfigValue | JsoncDocument): JsoncCommand {
    return { kind: "property", name, content: renderValue(value) };
  },
  /** Add a JSON value, for example an array element or a primitive document root. */
  value(value: ConfigValue | JsoncDocument): JsoncCommand {
    return { kind: "value", content: renderValue(value) };
  },
  /** Build an object from properties, comments, blank lines, and optional groups. */
  object(lines: readonly JsoncLine[]): JsoncDocument {
    return container(lines, "property", "{", "}");
  },
  /** Build an array from values, comments, blank lines, and optional groups. */
  array(lines: readonly JsoncLine[]): JsoncDocument {
    return container(lines, "value", "[", "]");
  },
};

/** Validate object or array commands and render their punctuation and indentation. */
function container(lines: readonly JsoncLine[], kind: "property" | "value", open: string, close: string): JsoncDocument {
  const commands = flatten(lines);
  if (commands.some((line) => line.kind !== kind && line.kind !== "comment" && line.kind !== "blank")) {
    throw new Error(`JSONC ${open === "{" ? "objects require properties" : "arrays require values"}`);
  }
  const body = renderLines(commands, 1, true);
  const content = body.length ? [open, ...body, close].join("\n") : open + close;
  return JsoncDocument.from([{ kind: "value", content }]);
}

/** Flatten nested declarations while omitting disabled or absent entries. */
function flatten(lines: readonly JsoncLine[]): JsoncCommand[] {
  return lines.flatMap((line): JsoncCommand[] => {
    if (!line) return [];
    if (line instanceof JsoncDocument) return [{ kind: "value", content: line.content.trimEnd() }];
    if (isGroup(line)) return flatten(line);
    return [line];
  });
}

/** Narrow a JSONC declaration to a nested command array. */
function isGroup(line: JsoncLine): line is readonly JsoncLine[] {
  return Array.isArray(line);
}

/** Render comment and value lines, placing commas where comments cannot consume them. */
function renderLines(lines: readonly JsoncCommand[], depth: number, commas: boolean): string[] {
  const indent = "  ".repeat(depth);
  const lastValue = lines.findLastIndex((line) => line.kind === "value" || line.kind === "property");
  return lines.flatMap((line, index) => {
    if (line.kind === "blank") return [""];
    if (line.kind === "comment") return line.text.split(/\r\n|\r|\n/).map((text) => `${indent}// ${text}`);
    const content = line.kind === "property" ? `${JSON.stringify(line.name)}: ${line.content}` : line.content;
    const rendered = content.split("\n").map((text) => indent + text);
    if (commas && index !== lastValue) {
      if (/^\s*\/\//.test(rendered.at(-1) ?? "")) rendered.push(indent + ",");
      else rendered[rendered.length - 1] += ",";
    }
    return rendered;
  });
}

/** Render a value using the target format's literal and expression rules. */
function renderValue(value: ConfigValue | JsoncDocument): string {
  if (value instanceof JsoncDocument) return value.content.trimEnd();
  const content = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("JSONC numbers must be finite");
    if (item === undefined || typeof item === "function" || typeof item === "symbol") throw new Error("Invalid JSONC value");
    return item;
  }, 2);
  if (content === undefined) throw new Error("Invalid JSONC value");
  return content;
}
