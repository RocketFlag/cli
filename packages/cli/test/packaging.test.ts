import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

interface PackageJsonShape {
  name: string;
  version: string;
  description?: string;
  license?: string;
  type?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<
    string,
    string | { types?: string; default?: string }
  >;
  files?: string[];
  engines?: { node?: string };
}

describe("Repository packaging, workflows, and READMEs", () => {
  beforeAll(() => {
    const cliDistEntry = path.join(repoRoot, "packages/cli/dist/index.js");
    if (!existsSync(cliDistEntry)) {
      execFileSync("npm", ["run", "build"], {
        cwd: repoRoot,
        stdio: "inherit",
      });
    }
  });

  describe("GitHub Actions workflows", () => {
    it("has .github/workflows/ci.yml with Node 22.x/24.x matrix and required verification steps", async () => {
      const ciPath = path.join(repoRoot, ".github/workflows/ci.yml");
      expect(existsSync(ciPath)).toBe(true);

      const content = await readFile(ciPath, "utf8");
      expect(content).toContain("push:");
      expect(content).toContain("pull_request:");
      expect(content).toContain("22.x");
      expect(content).toContain("24.x");
      expect(content).toContain("npm ci");
      expect(content).toContain("npm run typecheck");
      expect(content).toContain("npm run lint");
      expect(content).toContain("npm test");
      expect(content).toContain("npm run build");
      expect(content.indexOf("npm run build")).toBeLessThan(
        content.indexOf("npm test"),
      );
    });

    it("has .github/workflows/release.yml publishing packages in dependency order with provenance", async () => {
      const releasePath = path.join(repoRoot, ".github/workflows/release.yml");
      expect(existsSync(releasePath)).toBe(true);

      const content = await readFile(releasePath, "utf8");
      expect(content).toContain("release:");
      expect(content).toContain("created");
      expect(content).toContain("id-token: write");
      expect(content).toContain("npm ci");
      expect(content).toContain("npm run typecheck");
      expect(content).toContain("npm run lint");
      expect(content).toContain("npm test");
      expect(content).toContain("npm run build");
      expect(content).toContain("--access public --provenance");

      const managementIdx = content.indexOf("@rocketflag/management");
      const cliIdx = content.search(
        /npm publish\s+-w\s+rocketflag(?:\s|$)|--workspace=rocketflag(?:\s|$)/,
      );

      expect(managementIdx).toBeGreaterThan(-1);
      expect(cliIdx).toBeGreaterThan(managementIdx);
    });
  });

  describe("README.md files", () => {
    const readmePaths = [
      "README.md",
      "packages/management/README.md",
      "packages/mcp/README.md",
      "packages/cli/README.md",
    ];

    it.each(readmePaths)(
      "%s exists, is non-empty, and contains zero em dashes",
      async (relativePath) => {
        const fullPath = path.join(repoRoot, relativePath);
        expect(existsSync(fullPath)).toBe(true);

        const content = await readFile(fullPath, "utf8");
        expect(content.trim().length).toBeGreaterThan(100);
        expect(content).not.toContain("\u2014");
      },
    );
  });

  describe("Workspace package.json entrypoints and build outputs", () => {
    const packages = [
      {
        dir: "packages/management",
        expectedName: "@rocketflag/management",
        expectedBin: undefined,
      },
      {
        dir: "packages/mcp",
        expectedName: "@rocketflag/mcp",
        expectedBin: "rocketflag-mcp",
      },
      {
        dir: "packages/cli",
        expectedName: "rocketflag",
        expectedBin: "rocketflag",
      },
    ] as const;

    it.each(packages)(
      "$dir has valid package.json entrypoints pointing to built files",
      async ({ dir, expectedName, expectedBin }) => {
        const pkgDir = path.join(repoRoot, dir);
        const pkgJsonPath = path.join(pkgDir, "package.json");
        const raw = await readFile(pkgJsonPath, "utf8");
        const pkg = JSON.parse(raw) as PackageJsonShape;

        expect(pkg.name).toBe(expectedName);
        expect(pkg.type).toBe("module");
        expect(pkg.license).toBe("MIT");
        expect(pkg.engines?.node).toBe(">=22");
        expect(pkg.files).toContain("dist");
        expect(pkg.files).toContain("README.md");

        expect(pkg.main).toBeDefined();
        expect(pkg.types).toBeDefined();

        const mainFile = path.resolve(pkgDir, pkg.main!);
        const typesFile = path.resolve(pkgDir, pkg.types!);
        expect(existsSync(mainFile)).toBe(true);
        expect(existsSync(typesFile)).toBe(true);

        const mainStat = await stat(mainFile);
        const typesStat = await stat(typesFile);
        expect(mainStat.isFile()).toBe(true);
        expect(typesStat.isFile()).toBe(true);

        const dotExport = pkg.exports?.["."];
        expect(dotExport).toBeDefined();
        expect(typeof dotExport).toBe("object");
        if (typeof dotExport === "object" && dotExport !== null) {
          expect(dotExport.default).toBe(pkg.main);
          expect(dotExport.types).toBe(pkg.types);
          expect(existsSync(path.resolve(pkgDir, dotExport.default!))).toBe(true);
          expect(existsSync(path.resolve(pkgDir, dotExport.types!))).toBe(true);
        }

        if (expectedBin) {
          expect(pkg.bin).toBeDefined();
          const binTarget = pkg.bin?.[expectedBin];
          expect(binTarget).toBeDefined();
          const binFile = path.resolve(pkgDir, binTarget!);
          expect(existsSync(binFile)).toBe(true);
          const binContent = await readFile(binFile, "utf8");
          expect(binContent.startsWith("#!/usr/bin/env node")).toBe(true);
        }
      },
    );
  });
});
