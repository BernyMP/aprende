// @effect-diagnostics nodeBuiltinImport:off - a Claude Code hook; runs with Node built-ins only.
// PostToolUse hook: when an edit lands in a path a domain agent owns (.agents/domains/<name>/owns.txt),
// add that domain's brief to the conversation once per session. Context only: it never blocks,
// and any failure exits 0 with no output so the tool call stands.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const MAX_BRIEF_LINES = 3;

const globToRegExp = (glob: string): RegExp => {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      const slash = glob[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};

const findRepoRoot = (filePath: string): string | null => {
  let dir = NodePath.dirname(filePath);
  while (true) {
    if (NodeFS.existsSync(NodePath.join(dir, ".agents", "domains"))) return dir;
    const parent = NodePath.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const readLines = (file: string): Array<string> =>
  NodeFS.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

// Claims the (session, domain) pair; false when an earlier edit in this session already did.
const firstTimeThisSession = (sessionId: string, domain: string): boolean => {
  const dir = NodePath.join(NodeOS.tmpdir(), "aprende-domain-briefs");
  NodeFS.mkdirSync(dir, { recursive: true });
  try {
    NodeFS.writeFileSync(NodePath.join(dir, `${sessionId}--${domain}`), "", { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

const briefFor = (input: unknown): string | null => {
  if (typeof input !== "object" || input === null) return null;
  const { session_id: sessionId, tool_input: toolInput } = input as Record<string, unknown>;
  if (typeof sessionId !== "string" || !/^[\w-]+$/.test(sessionId)) return null;
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const filePath = (toolInput as Record<string, unknown>).file_path;
  if (typeof filePath !== "string" || !NodePath.isAbsolute(filePath)) return null;

  const root = findRepoRoot(filePath);
  if (root === null) return null;
  const relative = NodePath.relative(root, filePath).split(NodePath.sep).join("/");
  const domainsDir = NodePath.join(root, ".agents", "domains");
  for (const domain of NodeFS.readdirSync(domainsDir).sort()) {
    const ownsFile = NodePath.join(domainsDir, domain, "owns.txt");
    if (!NodeFS.existsSync(ownsFile)) continue;
    if (!readLines(ownsFile).some((glob) => globToRegExp(glob).test(relative))) continue;
    if (!firstTimeThisSession(sessionId, domain)) return null;
    const brief = readLines(NodePath.join(domainsDir, domain, "brief.md"));
    return brief.slice(0, MAX_BRIEF_LINES).join("\n");
  }
  return null;
};

try {
  const brief = briefFor(JSON.parse(NodeFS.readFileSync(0, "utf8")));
  if (brief) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: brief },
      }),
    );
  }
} catch {
  // A broken brief must never fail the edit.
}
