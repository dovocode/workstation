import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  handbook: [
    "README",
    {
      type: "category", label: "1. Get started", collapsed: false,
      items: ["concepts", "getting-started", "tutorial", "developer-workstation"],
    },
    {
      type: "category", label: "2. Design your setup",
      items: ["configuration", "designing-your-setup", "managed-setup"],
    },
    {
      type: "category", label: "3. Manage your machine",
      items: ["resources", "files", "shells", "custom-tools", "services", "provisioning"],
    },
    {
      type: "category", label: "4. Operate & recover",
      items: ["workflows", "operations", "troubleshooting"],
    },
    {
      type: "category", label: "5. Automate & integrate",
      items: ["tasks", "environments", "embedding"],
    },
    {
      type: "category", label: "Reference & contributing",
      items: ["cli", { type: "link", label: "Generated TypeScript API ↗", href: "https://dovocode.github.io/workstation/api/" }, "development", "architecture"],
    },
  ],
};
export default sidebars;
