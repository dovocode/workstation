/** Built-in command vocabulary shared by help output and task-name validation. */
export const commands = {
  help: { usage: "help", description: "Show command help" },
  init: { usage: "init", description: "Create a starter configuration without overwriting" },
  build: { usage: "build", description: "Reconcile the workstation" },
  plan: { usage: "plan", description: "Preview reconciliation without writing locks or state" },
  status: { usage: "status", description: "Inspect drift against recorded state and pins" },
  doctor: { usage: "doctor", description: "Check executables and explain backend capabilities" },
  history: { usage: "history", description: "List recovery snapshot IDs" },
  rollback: { usage: "rollback RUN", description: "Preview file or pinned mise restoration; --apply executes" },
  lock: { usage: "lock update [IDs]", description: "Refresh package pins without installation" },
  update: { usage: "update", description: "Update Workstation itself" },
} as const;

/** Identify names reserved by the CLI, including object-prototype-safe lookups. */
export function isBuiltinCommand(name: string): boolean {
  return Object.hasOwn(commands, name);
}

/** Render command descriptions from the authoritative registry. */
export function commandHelp(): string {
  return Object.values(commands).map(({ usage, description }) => `  ${usage.padEnd(18)}${description}`).join("\n");
}
