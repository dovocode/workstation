import type { GeneratedFileResource, IfExistsPolicy } from "./types.js";

/** Supported shell rendering targets. */
export type Shell = "zsh" | "bash";

/** A value expanded when the generated shell file runs, rather than during configuration loading. */
export type ShellExpression =
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "home"; readonly path: string }
  | { readonly kind: "concat"; readonly values: readonly ShellValue[] }
  | { readonly kind: "capture"; readonly command: ShellCommand };

/** Plain strings are quoted literals. Use `shell.variable`, `shell.home`, or `shell.capture` for expansion. */
export type ShellValue = string | ShellExpression;

/** A command plus individually quoted arguments; it is not executed while declaring configuration. */
export interface ShellCommand {
  readonly command: string;
  readonly args?: readonly ShellValue[];
  readonly stderr?: "inherit" | "ignore";
}

/** A condition evaluated by the generated shell script. */
export type ShellCondition =
  | { readonly kind: "command-exists"; readonly command: string }
  | { readonly kind: "executable" | "file" | "directory"; readonly path: ShellValue }
  | { readonly kind: "empty" | "non-empty"; readonly value: ShellValue }
  | { readonly kind: "and"; readonly conditions: readonly ShellCondition[] }
  | { readonly kind: "or"; readonly conditions: readonly ShellCondition[] }
  | { readonly kind: "not"; readonly condition: ShellCondition };

/** A statement in the portable Zsh/Bash declaration language. */
export type ShellStatement =
  | { readonly kind: "export"; readonly name: string; readonly value: ShellValue }
  | { readonly kind: "assign"; readonly name: string; readonly value: ShellValue }
  | { readonly kind: "unset"; readonly names: readonly string[] }
  | { readonly kind: "prepend-path"; readonly values: readonly ShellValue[] }
  | { readonly kind: "alias"; readonly name: string; readonly command: string }
  | { readonly kind: "eval"; readonly command: ShellCommand }
  | { readonly kind: "source"; readonly path: ShellValue; readonly ifExists: boolean }
  | { readonly kind: "if"; readonly condition: ShellCondition; readonly statements: readonly ShellStatement[] }
  | { readonly kind: "zsh-setopt"; readonly options: readonly string[] }
  | { readonly kind: "raw"; readonly code: string };

/** Generated startup-file options. Defaults to overwrite and mode `0o644`. */
export interface ShellFileOptions {
  /** Defaults to overwrite; replaced originals are saved in local state for restoration. */
  readonly ifExists?: IfExistsPolicy;
  /** Unix permissions, for example `0o600`. */
  readonly mode?: number;
}

/** Build shell statements without hand-written quoting. Helpers describe code; they do not execute commands. */
export const shell = {
  /**
   * Reference a shell variable at runtime.
   * @example shell.export("VISUAL", shell.variable("EDITOR"))
   */
  variable(name: string): ShellExpression {
    return { kind: "variable", name: validateVariable(name) };
  },
  /**
   * Expand a path under the shell's HOME at runtime.
   * @example shell.home(".local/bin")
   */
  home(path = ""): ShellExpression {
    if (path.includes("\0") || path.includes("\n")) throw new Error("Invalid home-relative path");
    return { kind: "home", path: path.replace(/^\//, "") };
  },
  /** Join literals and expressions into one shell value. */
  concat(...values: readonly ShellValue[]): ShellExpression {
    return { kind: "concat", values };
  },
  /** Use a command's stdout as a value via command substitution. */
  capture(command: ShellCommand): ShellExpression {
    return { kind: "capture", command };
  },
  /** Describe a command and its arguments. Use `capture` for its output or `eval` for initialization code. */
  command(
    command: string,
    args: readonly ShellValue[] = [],
    options: Pick<ShellCommand, "stderr"> = {},
  ): ShellCommand {
    if (!command || command.includes("\0") || command.includes("\n")) {
      throw new Error("Invalid shell command");
    }
    return { command, args, ...options };
  },
  /** Set and export an environment variable. */
  export(name: string, value: ShellValue): ShellStatement {
    return { kind: "export", name: validateVariable(name), value };
  },
  /** Set a shell variable without exporting it. */
  assign(name: string, value: ShellValue): ShellStatement {
    return { kind: "assign", name: validateVariable(name), value };
  },
  /** Remove one or more shell variables. */
  unset(...names: readonly string[]): ShellStatement {
    if (names.length === 0) throw new Error("unset requires at least one variable");
    return { kind: "unset", names: names.map(validateVariable) };
  },
  /**
   * Prepend paths while retaining the current PATH.
   * @example shell.prependPath(shell.home(".local/bin"))
   */
  prependPath(...values: readonly ShellValue[]): ShellStatement {
    return { kind: "prepend-path", values };
  },
  /** Define an alias; its command text is interpreted when the alias runs. */
  alias(name: string, command: string): ShellStatement {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`Invalid shell alias: ${name}`);
    return { kind: "alias", name, command };
  },
  /**
   * Evaluate shell code printed by a command.
   * @example shell.eval(shell.command("mise", ["activate", "zsh"]))
   */
  eval(command: ShellCommand): ShellStatement {
    return { kind: "eval", command };
  },
  /** Source another shell file. With `ifExists: true`, source only when readable. */
  source(path: ShellValue, options: { readonly ifExists?: boolean } = {}): ShellStatement {
    return { kind: "source", path, ifExists: options.ifExists ?? false };
  },
  /** Generate a shell-time conditional containing one or more statements. */
  when(condition: ShellCondition, statements: readonly ShellStatement[]): ShellStatement {
    if (statements.length === 0) throw new Error("Shell condition requires at least one statement");
    return { kind: "if", condition, statements };
  },
  /** Insert literal shell code without validation or quoting. Prefer typed helpers for ordinary statements. */
  raw(code: string): ShellStatement {
    return { kind: "raw", code };
  },
  /** Construct conditions evaluated when the shell starts. */
  condition: {
    /** Test whether a command is available on PATH. */
    commandExists(command: string): ShellCondition {
      if (!command || command.includes("\0") || command.includes("\n")) {
        throw new Error("Invalid shell command");
      }
      return { kind: "command-exists", command };
    },
    /** Test whether a path is executable. */
    executable(path: ShellValue): ShellCondition {
      return { kind: "executable", path };
    },
    /** Test whether a path is a regular file. */
    file(path: ShellValue): ShellCondition {
      return { kind: "file", path };
    },
    /** Test whether a path is a directory. */
    directory(path: ShellValue): ShellCondition {
      return { kind: "directory", path };
    },
    /** Test whether a value is empty. */
    empty(value: ShellValue): ShellCondition {
      return { kind: "empty", value };
    },
    /** Test whether a value is non-empty. */
    nonEmpty(value: ShellValue): ShellCondition {
      return { kind: "non-empty", value };
    },
    /** Combine conditions with shell AND. */
    and(...conditions: readonly ShellCondition[]): ShellCondition {
      if (conditions.length === 0) throw new Error("and requires at least one condition");
      return { kind: "and", conditions };
    },
    /** Combine conditions with shell OR. */
    or(...conditions: readonly ShellCondition[]): ShellCondition {
      if (conditions.length === 0) throw new Error("or requires at least one condition");
      return { kind: "or", conditions };
    },
    /** Negate a condition. */
    not(condition: ShellCondition): ShellCondition {
      return { kind: "not", condition };
    },
  },
};

/** Declare independent Zsh startup files. Each defaults to overwrite with original-file restoration. */
export const zsh = {
  /** Generate ~/.zshenv, read by every Zsh invocation. Keep this minimal. */
  zshenv: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("zsh", "~/.zshenv", statements, options),
  /** Generate ~/.zprofile for login-shell environment initialization. */
  zprofile: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("zsh", "~/.zprofile", statements, options),
  /** Generate ~/.zshrc for interactive aliases, prompts, and completion. */
  zshrc: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("zsh", "~/.zshrc", statements, options),
  /** Enable Zsh-only options using uppercase names. Cannot be rendered to Bash. */
  setopt(...options: readonly string[]): ShellStatement {
    if (options.length === 0) throw new Error("setopt requires at least one option");
    for (const option of options) {
      if (!/^[A-Z_]+$/.test(option)) throw new Error(`Invalid Zsh option: ${option}`);
    }
    return { kind: "zsh-setopt", options };
  },
};

/** Declare Bash startup files. Bash login shells read the first available profile file. */
export const bash = {
  /** Generate ~/.bashrc for interactive non-login shells. */
  bashrc: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("bash", "~/.bashrc", statements, options),
  /** Generate ~/.bash_profile for Bash login shells; source ~/.bashrc explicitly if desired. */
  bashProfile: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("bash", "~/.bash_profile", statements, options),
  /** Generate ~/.profile using Bash syntax; use only where Bash will read it. */
  profile: (statements: readonly ShellStatement[], options?: ShellFileOptions) =>
    shellFile("bash", "~/.profile", statements, options),
};

/** Render statements to shell text without writing a file or running a command. */
export function renderShell(statements: readonly ShellStatement[], target: Shell): string {
  return `${statements.map((statement) => renderStatement(statement, target, 0)).join("\n")}\n`;
}

/** Render shell statements into a generated startup-file resource. */
function shellFile(
  format: Shell,
  target: string,
  statements: readonly ShellStatement[],
  options: ShellFileOptions = {},
): GeneratedFileResource {
  return {
    kind: "generated-file",
    target,
    format,
    value: renderShell(statements, format),
    ifExists: options.ifExists ?? "overwrite",
    mode: options.mode ?? 0o644,
  };
}

/** Render a shell statement at the requested indentation depth. */
function renderStatement(statement: ShellStatement, target: Shell, depth: number): string {
  const indent = "  ".repeat(depth);
  switch (statement.kind) {
    case "export":
      return `${indent}export ${statement.name}=${renderValue(statement.value)}`;
    case "assign":
      return `${indent}${statement.name}=${renderValue(statement.value)}`;
    case "unset":
      return `${indent}unset ${statement.names.join(" ")}`;
    case "prepend-path":
      return `${indent}export PATH=${[...statement.values.map(renderValue), '"$PATH"'].join(":")}`;
    case "alias":
      return `${indent}alias ${statement.name}=${quote(statement.command)}`;
    case "eval":
      return `${indent}eval "${escapeDouble(`$(${renderCommand(statement.command)})`)}"`;
    case "source": {
      const source = `source ${renderValue(statement.path)}`;
      return statement.ifExists
        ? `${indent}if [[ -r ${renderValue(statement.path)} ]]; then ${source}; fi`
        : `${indent}${source}`;
    }
    case "if":
      return [
        `${indent}if ${renderCondition(statement.condition)}; then`,
        ...statement.statements.map((child) => renderStatement(child, target, depth + 1)),
        `${indent}fi`,
      ].join("\n");
    case "zsh-setopt":
      if (target !== "zsh") throw new Error("setopt is only valid in Zsh configuration");
      return `${indent}setopt ${statement.options.join(" ")}`;
    case "raw":
      return statement.code.split("\n").map((line) => `${indent}${line}`).join("\n");
  }
}

/** Translate a typed condition into shell test syntax. */
function renderCondition(condition: ShellCondition): string {
  switch (condition.kind) {
    case "command-exists":
      return `command -v ${quote(condition.command)} >/dev/null 2>&1`;
    case "executable":
      return `[[ -x ${renderValue(condition.path)} ]]`;
    case "file":
      return `[[ -f ${renderValue(condition.path)} ]]`;
    case "directory":
      return `[[ -d ${renderValue(condition.path)} ]]`;
    case "empty":
      return `[[ -z ${renderValue(condition.value)} ]]`;
    case "non-empty":
      return `[[ -n ${renderValue(condition.value)} ]]`;
    case "and":
      return condition.conditions.map(renderCondition).join(" && ");
    case "or":
      return condition.conditions.map(renderCondition).join(" || ");
    case "not":
      return `! ${renderCondition(condition.condition)}`;
  }
}

/** Quote command arguments and append the requested stderr redirection. */
function renderCommand(command: ShellCommand): string {
  const stderr = command.stderr === "ignore" ? " 2>/dev/null" : "";
  return [quote(command.command), ...(command.args ?? []).map(renderValue)].join(" ") + stderr;
}

/** Render a value using the target format's literal and expression rules. */
function renderValue(value: ShellValue): string {
  if (typeof value === "string") return quote(value);
  switch (value.kind) {
    case "variable":
      return `"\${${value.name}}"`;
    case "home":
      return `"\${HOME}${value.path ? `/${escapeDouble(value.path)}` : ""}"`;
    case "concat":
      return `"${value.values.map(renderInsideDoubleQuotes).join("")}"`;
    case "capture":
      return `"$(${renderCommand(value.command)})"`;
  }
}

/** Render a literal or expression inside an existing double-quoted shell value. */
function renderInsideDoubleQuotes(value: ShellValue): string {
  if (typeof value === "string") return escapeDouble(value);
  const rendered = renderValue(value);
  return rendered.startsWith('"') && rendered.endsWith('"') ? rendered.slice(1, -1) : rendered;
}

/** Quote a literal according to the target renderer's escaping rules. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Escape backslashes and double quotes inside a shell expression. */
function escapeDouble(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Reject names that are not valid shell variable identifiers. */
function validateVariable(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid shell variable: ${name}`);
  return name;
}
