import { describe, expect, it } from "vite-plus/test";

import { resolveDiffPathForWorkspace } from "./diffFileActions";

describe("resolveDiffPathForWorkspace", () => {
  it("resolves repository-relative diff files from a nested project", () => {
    expect(
      resolveDiffPathForWorkspace({
        filePath: "frontend/Dockerfile",
        workspaceRoot: "/repo/frontend",
        repositoryRoot: "/repo",
      }),
    ).toBe("Dockerfile");
  });

  it("preserves repository-relative paths in a separate worktree", () => {
    expect(
      resolveDiffPathForWorkspace({
        filePath: "frontend/Dockerfile",
        workspaceRoot: "/worktrees/feature",
        repositoryRoot: "/repo",
      }),
    ).toBe("frontend/Dockerfile");
  });

  it("handles Windows roots and mixed diff separators", () => {
    expect(
      resolveDiffPathForWorkspace({
        filePath: "Frontend/src\\index.ts",
        workspaceRoot: "C:\\repo\\frontend",
        repositoryRoot: "C:\\repo",
      }),
    ).toBe("src/index.ts");
  });

  // regression: #6174 opening diff files broke for repositories at a filesystem root
  it.each([
    { workspaceRoot: "/frontend", repositoryRoot: "/" },
    { workspaceRoot: "C:\\frontend", repositoryRoot: "C:\\" },
  ])("handles filesystem roots: $repositoryRoot", ({ workspaceRoot, repositoryRoot }) => {
    expect(
      resolveDiffPathForWorkspace({
        filePath: "frontend/index.ts",
        workspaceRoot,
        repositoryRoot,
      }),
    ).toBe("index.ts");
  });

  it.each([
    {
      filePath: "/repo/frontend/src/index.ts",
      workspaceRoot: "/repo/frontend",
      expected: "src/index.ts",
    },
    { filePath: "c:\\Repo\\src\\index.ts", workspaceRoot: "C:\\repo", expected: "src/index.ts" },
  ])(
    "opens absolute diff paths inside the workspace: $filePath",
    ({ filePath, workspaceRoot, expected }) => {
      expect(
        resolveDiffPathForWorkspace({ filePath, workspaceRoot, repositoryRoot: workspaceRoot }),
      ).toBe(expected);
    },
  );

  it.each([
    "backend/server.ts",
    "frontend2/app.ts",
    "frontend/../secret.ts",
    "C:secret.ts",
    "/repo/backend/server.ts",
    "/repo/frontend/../backend/server.ts",
    "/repo/frontend",
    "/etc/passwd",
  ])("does not resolve an out-of-project diff path: %s", (filePath) => {
    expect(
      resolveDiffPathForWorkspace({
        filePath,
        workspaceRoot: "/repo/frontend",
        repositoryRoot: "/repo",
      }),
    ).toBeNull();
  });
});
