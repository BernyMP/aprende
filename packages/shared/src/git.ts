function lowerCaseRemote(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/**
 * The host and repository path a remote names, lower case and without a port, or null for a
 * remote that names no host, such as a local path.
 */
function parseGitRemoteRepository(
  value: string,
): { readonly host: string; readonly path: string } | null {
  const normalized = lowerCaseRemote(value);

  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const repositorySegments = url.pathname.split("/").filter((segment) => segment.length > 0);
      if (url.hostname && repositorySegments.length > 1) {
        return { host: url.hostname, path: repositorySegments.join("/") };
      }
    } catch {
      return null;
    }
  }

  // A userless one-letter prefix is a Windows drive, not an SCP host.
  const scpStyleHostAndPath = /^[a-z]:/i.test(normalized)
    ? null
    : /^(?:[a-zA-Z0-9._-]+@)?([^@:/\\\s]+):\/?([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized);
  const scpHost = scpStyleHostAndPath?.[1];
  const scpPath = scpStyleHostAndPath?.[2];
  return scpHost && scpPath ? { host: scpHost, path: scpPath } : null;
}

/**
 * `host/path` for a remote that names a host, otherwise the remote itself, lower case. A host that
 * spells repositories differently over SSH has its source control registry's
 * `repositoryKeyFromRemote` rewrite this, so persisted keys come from that, not from here.
 */
export function normalizeGitRemoteUrl(value: string): string {
  const repository = parseGitRemoteRepository(value);
  return repository === null ? lowerCaseRemote(value) : `${repository.host}/${repository.path}`;
}

function* gitConfigLines(configText: string) {
  let pending = "";
  let quoted = false;
  for (const line of configText.split(/\r?\n/)) {
    let continued = false;
    if (line.endsWith("\\")) {
      for (const [token] of line.matchAll(/\\[\s\S]?|["#;]/g)) {
        if (token === '"') quoted = !quoted;
        else if (!quoted && (token === "#" || token === ";")) break;
        else if (token === "\\") continued = true;
      }
    }
    if (continued) {
      pending += line.slice(0, -1);
      continue;
    }
    yield pending + line;
    pending = "";
    quoted = false;
  }
  if (pending.length > 0) yield pending;
}

function parseGitConfigValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      out += raw[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (char === "#" || char === ";")) break;
    out += char;
  }
  return out.trim();
}

export function isBareGitConfig(configText: string): boolean {
  let inCore = false;
  let bare = false;
  for (const rawLine of gitConfigLines(configText)) {
    let line = rawLine.trim();
    // Git accepts the first setting on the section header's own line.
    const header = /^\[\s*([^\]]*?)\s*\](.*)$/.exec(line);
    if (header !== null) {
      inCore = header[1]!.toLowerCase() === "core";
      line = header[2]!.trim();
    }
    if (!inCore) continue;
    const match = /^bare\s*(?:=(.*)|[#;].*)?$/i.exec(line);
    if (match === null) continue;
    const value = match[1] === undefined ? "true" : parseGitConfigValue(match[1]).toLowerCase();
    bare = value === "true" || value === "yes" || value === "on" || value === "1";
  }
  return bare;
}

export function parseOriginUrlFromGitConfig(configText: string): string | null {
  let section: string | null = null;
  let originUrl: string | null = null;
  let firstRemoteUrl: string | null = null;
  const joined = configText.replace(/\\\r?\n[ \t]*/g, "");
  for (const rawLine of joined.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    // Git preserves case in quoted remote subsections but lowercases legacy dotted ones,
    // and accepts the first setting on the section header's own line.
    const header = /^\[\s*remote(?:\s+"([^"]+)"|\.([^\]\s]+))\s*\](.*)$/i.exec(line);
    if (header) {
      section = header[1] ?? header[2]?.toLowerCase() ?? null;
      line = header[3]!.trim();
    } else if (line.startsWith("[")) {
      section = null;
      continue;
    }
    if (section === null) continue;
    const match = /^url\s*=\s*(.*)$/i.exec(line);
    if (!match) continue;
    const url = parseGitConfigValue(match[1] ?? "");
    if (url.length === 0) continue;
    if (section === "origin") {
      originUrl ??= url;
    } else {
      firstRemoteUrl ??= url;
    }
  }
  return originUrl ?? firstRemoteUrl;
}
