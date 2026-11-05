import { describe, expect, it } from "vite-plus/test";

import { isBareGitConfig, normalizeGitRemoteUrl, parseOriginUrlFromGitConfig } from "./git.ts";

describe("normalizeGitRemoteUrl", () => {
  it("canonicalizes equivalent GitHub remotes across protocol variants", () => {
    expect(normalizeGitRemoteUrl("git@github.com:BernyMP/Aprende.git")).toBe(
      "github.com/bernymp/aprende",
    );
    expect(normalizeGitRemoteUrl("https://github.com/BernyMP/Aprende.git")).toBe(
      "github.com/bernymp/aprende",
    );
    expect(normalizeGitRemoteUrl("ssh://git@github.com/BernyMP/Aprende")).toBe(
      "github.com/bernymp/aprende",
    );
  });

  it("preserves nested group paths for providers like GitLab", () => {
    expect(normalizeGitRemoteUrl("git@gitlab.com:BernyMP/platform/Aprende.git")).toBe(
      "gitlab.com/bernymp/platform/aprende",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/BernyMP/platform/Aprende.git")).toBe(
      "gitlab.com/bernymp/platform/aprende",
    );
  });

  it("drops explicit ports from URL-shaped remotes", () => {
    expect(normalizeGitRemoteUrl("https://gitlab.company.com:8443/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
    expect(normalizeGitRemoteUrl("ssh://git@gitlab.company.com:2222/team/project.git")).toBe(
      "gitlab.company.com/team/project",
    );
  });

  it("normalizes SCP-like remotes with non-git SSH users", () => {
    expect(normalizeGitRemoteUrl("gitlab@gitlab.example.com:group/project.git")).toBe(
      "gitlab.example.com/group/project",
    );
    expect(normalizeGitRemoteUrl("deploy@bitbucket.org:workspace/repo.git")).toBe(
      "bitbucket.org/workspace/repo",
    );
    expect(normalizeGitRemoteUrl("code.example.test:team/repo.git")).toBe(
      "code.example.test/team/repo",
    );
    expect(normalizeGitRemoteUrl("git@code.example.test:/team/repo.git")).toBe(
      "code.example.test/team/repo",
    );
    expect(normalizeGitRemoteUrl("C:/repos/project")).toBe("c:/repos/project");
    expect(normalizeGitRemoteUrl("git@x:team/project.git")).toBe("x/team/project");
  });
});

describe("isBareGitConfig", () => {
  it("reads continued bare values after comments and at end of input", () => {
    const config = ["[core] bare = false # ignored backslash \\", 'bare = "tr\\', 'ue"'].join("\n");

    expect(isBareGitConfig(config)).toBe(true);
    expect(isBareGitConfig("[core]\nbare = tr\\\nue\\")).toBe(true);
  });
});

describe("parseOriginUrlFromGitConfig", () => {
  it("reads the origin url and ignores other remotes", () => {
    const config = [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "upstream"]',
      "\turl = https://github.com/other/repo.git",
      '[remote "origin"]',
      "\turl = git@github.com:BernyMP/aprende.git",
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      '[branch "main"]',
      "\tremote = origin",
    ].join("\n");
    expect(parseOriginUrlFromGitConfig(config)).toBe("git@github.com:BernyMP/aprende.git");
  });

  it("strips inline comments and quotes from the url value", () => {
    expect(
      parseOriginUrlFromGitConfig(
        '[remote "origin"]\n\turl = https://github.com/acme/repo.git # mirror\n',
      ),
    ).toBe("https://github.com/acme/repo.git");
    expect(
      parseOriginUrlFromGitConfig('[remote "origin"]\n\turl = "git@github.com:acme/repo.git"\n'),
    ).toBe("git@github.com:acme/repo.git");
  });

  it("accepts legacy dotted headers, header comments, and line continuations", () => {
    expect(parseOriginUrlFromGitConfig("[remote.origin]\n\turl = git@github.com:a/b.git\n")).toBe(
      "git@github.com:a/b.git",
    );
    expect(parseOriginUrlFromGitConfig("[remote.Origin]\n\turl = git@github.com:a/b.git\n")).toBe(
      "git@github.com:a/b.git",
    );
    expect(
      parseOriginUrlFromGitConfig(
        '[remote "Origin"]\n\turl = git@github.com:x/y.git\n[remote "origin"]\n\turl = git@github.com:a/b.git\n',
      ),
    ).toBe("git@github.com:a/b.git");
    expect(
      parseOriginUrlFromGitConfig('[remote "origin"] # primary\n\turl = git@github.com:a/b.git\n'),
    ).toBe("git@github.com:a/b.git");
    expect(
      parseOriginUrlFromGitConfig(
        '[remote "origin"]\n\turl = https://github.com/acme/\\\n\t\trepo.git\n',
      ),
    ).toBe("https://github.com/acme/repo.git");
  });

  it("reads settings on the remote header line", () => {
    const upstream = '\n[remote "upstream"]\n\turl = https://github.com/other/source.git\n';
    expect(
      parseOriginUrlFromGitConfig(`[remote "origin"] url = git@github.com:a/b.git${upstream}`),
    ).toBe("git@github.com:a/b.git");
    expect(parseOriginUrlFromGitConfig("[remote.Origin]url=git@github.com:a/b.git\n")).toBe(
      "git@github.com:a/b.git",
    );
    expect(
      parseOriginUrlFromGitConfig(
        `[remote "origin"] fetch = +refs/heads/*:refs/remotes/origin/*\n\turl = git@github.com:a/b.git${upstream}`,
      ),
    ).toBe("git@github.com:a/b.git");
  });

  it("falls back to the first remote when there is no origin", () => {
    const config = [
      '[remote "upstream"]',
      "\turl = https://github.com/acme/repo.git",
      '[remote "fork"]',
      "\turl = https://github.com/me/repo.git",
    ].join("\n");
    expect(parseOriginUrlFromGitConfig(config)).toBe("https://github.com/acme/repo.git");
  });
});
