import { fileURLToPath } from "node:url";

import type { Config } from "@docusaurus/types";

const config: Config = {
  title: "Workstation",
  tagline: "A reproducible setup. A machine that stays yours.",
  favicon: "img/favicon.svg",
  url: "https://dovocode.github.io",
  baseUrl: "/workstation/",
  organizationName: "dovocode",
  projectName: "workstation",
  trailingSlash: true,
  onBrokenLinks: "throw",
  markdown: {
    format: "detect",
    hooks: { onBrokenMarkdownLinks: "throw", onBrokenMarkdownImages: "throw" },
  },
  presets: [["classic", {
    docs: {
      path: "../docs",
      routeBasePath: "/",
      sidebarPath: fileURLToPath(new URL("./sidebars.ts", import.meta.url)),
      /** Link source files outside the website workspace to their repository location. */
      editUrl: ({ docPath }: { docPath: string }) => `https://github.com/dovocode/workstation/edit/main/docs/${docPath}`,
      showLastUpdateTime: false,
      showLastUpdateAuthor: false,
    },
    blog: false,
    pages: false,
    theme: { customCss: fileURLToPath(new URL("./src/css/custom.css", import.meta.url)) },
  }]],
  themes: [["@easyops-cn/docusaurus-search-local", {
    hashed: true,
    indexDocs: true,
    indexBlog: false,
    docsRouteBasePath: "/",
    docsDir: "../docs",
    language: "en",
    highlightSearchTermsOnTargetPage: true,
    explicitSearchResultPath: true,
  }]],
  themeConfig: {
    colorMode: { defaultMode: "light", respectPrefersColorScheme: true },
    navbar: {
      title: "Workstation",
      logo: { alt: "Workstation terminal", src: "img/favicon.svg" },
      items: [
        { type: "docSidebar", sidebarId: "handbook", label: "Handbook", position: "left" },
        { to: "/developer-workstation", label: "Build your setup", position: "left" },
        { href: "https://dovocode.github.io/workstation/api/", label: "API", position: "left" },
        { href: "https://github.com/dovocode/workstation", label: "GitHub", position: "right" },
      ],
    },
    docs: { sidebar: { hideable: true, autoCollapseCategories: true } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    footer: {
      style: "dark",
      links: [
        { title: "Learn", items: [{ label: "First configuration", to: "/tutorial" }, { label: "Developer workstation", to: "/developer-workstation" }] },
        { title: "Use", items: [{ label: "Everyday workflows", to: "/workflows" }, { label: "Troubleshooting", to: "/troubleshooting" }] },
        { title: "Reference", items: [{ label: "CLI commands", to: "/cli" }, { label: "API reference", href: "https://dovocode.github.io/workstation/api/" }, { label: "Source & releases", href: "https://github.com/dovocode/workstation" }] },
      ],
      copyright: "Workstation · Declare it. Review it. Reconcile it.",
    },
    prism: { additionalLanguages: ["bash", "toml", "json", "yaml", "typescript"] },
    metadata: [{ name: "description", content: "Learn to build and maintain a reproducible macOS or Linux workstation with TypeScript. Step-by-step setup, package and dotfile recipes, safe upgrades, services, tasks, and recovery." }],
  },
};
export default config;
