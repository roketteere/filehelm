// Lightweight GitHub REST client. Public-API only; optional bearer
// token from localStorage["filehelm.githubToken"] for higher rate
// limits (auth = 5000 req/hr vs 60 unauth).

const BASE = "https://api.github.com";
const TOKEN_KEY = "filehelm.githubToken";

export interface RepoMeta {
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  html_url: string;
  language: string | null;
  size_kb: number;
  stargazers: number;
  forks: number;
  topics: string[];
  is_private: boolean;
  pushed_at: string;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

export interface GithubError {
  status: number;
  message: string;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Parse common GitHub URL shapes into `{owner, repo}`.
 *
 * Accepts:
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo.git
 *   - github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *   - owner/repo (shorthand)
 */
export function parseRepoUrl(input: string): { owner: string; repo: string } | null {
  if (!input) return null;
  const s = input.trim();

  // owner/repo shorthand
  const short = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/);
  if (short) return { owner: short[1], repo: short[2].replace(/\.git$/, "") };

  // SSH form
  const ssh = s.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2].replace(/\.git$/, "") };

  // HTTPS / bare github.com forms
  const url = s.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
  const m = url.match(/^([^/]+)\/([^/?#]+)/);
  if (m) {
    return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
  }
  return null;
}

async function api<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
      // ignore
    }
    const err: GithubError = { status: res.status, message };
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function getRepo(owner: string, repo: string): Promise<RepoMeta> {
  const r = await api<{
    name: string;
    full_name: string;
    description: string | null;
    default_branch: string;
    html_url: string;
    language: string | null;
    size: number;
    stargazers_count: number;
    forks_count: number;
    topics?: string[];
    private: boolean;
    pushed_at: string;
    owner: { login: string };
  }>(`/repos/${owner}/${repo}`);

  return {
    owner: r.owner.login,
    name: r.name,
    full_name: r.full_name,
    description: r.description,
    default_branch: r.default_branch,
    html_url: r.html_url,
    language: r.language,
    size_kb: r.size,
    stargazers: r.stargazers_count,
    forks: r.forks_count,
    topics: r.topics ?? [],
    is_private: r.private,
    pushed_at: r.pushed_at,
  };
}

/** Returns the README rendered as raw markdown text (UTF-8). */
export async function getReadme(owner: string, repo: string, ref?: string): Promise<string> {
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const r = await api<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/readme${params}`,
  );
  if (r.encoding !== "base64") return r.content;
  // Browser-native base64 decode; works for UTF-8 byte streams.
  const binary = atob(r.content.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Recursive tree of every path in the repo at `ref`. */
export async function getTree(owner: string, repo: string, ref: string): Promise<TreeEntry[]> {
  const r = await api<{
    tree: Array<{ path: string; type: "blob" | "tree" | "commit"; size?: number }>;
    truncated: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return r.tree.map((t) => ({ path: t.path, type: t.type, size: t.size }));
}

export function isRateLimitError(err: unknown): boolean {
  const e = err as GithubError | null;
  return !!e && (e.status === 403 || e.status === 429);
}
