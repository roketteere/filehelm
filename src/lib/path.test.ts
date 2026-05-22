import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { basename as ourBasename } from "@/lib/utils";
import { splitWindowsPath, basename } from "@/lib/path";

// The original test suite predates cross-platform support. The
// `splitWindowsPath` export is still public (for callers that
// pre-know they have a Windows-style path) — these tests pin that
// behaviour. The new `splitPath` cross-platform splitter is covered
// in the OS-aware suite below.

describe("splitWindowsPath", () => {
  it("splits a typical Windows path drive-first", () => {
    const segs = splitWindowsPath("C:\\Development\\Claude\\filehelm");
    expect(segs.map((s) => s.label)).toEqual([
      "C:\\",
      "Development",
      "Claude",
      "filehelm",
    ]);
    expect(segs[0].absPath).toBe("C:\\");
    expect(segs[2].absPath).toBe("C:\\Development\\Claude");
    expect(segs[3].absPath).toBe("C:\\Development\\Claude\\filehelm");
  });

  it("tolerates forward slashes in input", () => {
    const segs = splitWindowsPath("C:/Development/Claude/filehelm");
    expect(segs.map((s) => s.label)).toEqual([
      "C:\\",
      "Development",
      "Claude",
      "filehelm",
    ]);
    expect(segs[1].absPath).toBe("C:\\Development");
  });

  it("handles a UNC share root as a single first segment", () => {
    const segs = splitWindowsPath("\\\\server\\share\\foo\\bar");
    expect(segs[0].label).toBe("\\\\server\\share");
    expect(segs[0].absPath).toBe("\\\\server\\share");
    expect(segs[1].absPath).toBe("\\\\server\\share\\foo");
    expect(segs[2].absPath).toBe("\\\\server\\share\\foo\\bar");
  });

  it("returns just the drive root for the drive itself", () => {
    const segs = splitWindowsPath("C:\\");
    expect(segs.length).toBe(1);
    expect(segs[0].label).toBe("C:\\");
  });

  it("returns an empty array for an empty input", () => {
    expect(splitWindowsPath("")).toEqual([]);
  });

  it("handles a path without a drive (relative) by chaining segments", () => {
    const segs = splitWindowsPath("foo\\bar\\baz");
    expect(segs.map((s) => s.label)).toEqual(["foo", "bar", "baz"]);
    expect(segs[2].absPath).toBe("foo\\bar\\baz");
  });
});

describe("basename", () => {
  it("returns the last segment of a Windows path", () => {
    expect(basename("C:\\Development\\Claude\\filehelm")).toBe("filehelm");
  });
  it("returns the last segment of a forward-slash path", () => {
    expect(basename("C:/Development/Claude/filehelm")).toBe("filehelm");
  });
  it("returns the input verbatim for empty / odd inputs", () => {
    expect(basename("")).toBe("");
  });

  // Sanity: utils.basename is a separate, simpler helper used elsewhere
  // in the codebase. Keeping a tiny check so a future rename doesn't
  // silently break both.
  it("utils.basename trims trailing slashes too", () => {
    expect(ourBasename("C:\\foo\\bar\\")).toBe("bar");
  });
});

// ---- POSIX path coverage (macOS/Linux) ----
//
// `splitPath` picks the right splitter from the cached platform. We
// reset the platform cache between tests and force `navigator.userAgent`
// to a POSIX-flavored string so we exercise the POSIX branch even when
// the vitest host is a Windows machine.

describe("splitPath on POSIX", () => {
  beforeEach(() => {
    // Force the platform module to detect Linux: stub a navigator
    // with a Linux-flavored UA, and reset modules so platform.ts
    // re-runs its detection logic on next import.
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("splits an absolute POSIX path rooted at /", async () => {
    const { splitPath } = await import("@/lib/path");
    const segs = splitPath("/Users/joel/dev/filehelm");
    expect(segs.map((s) => s.label)).toEqual([
      "/",
      "Users",
      "joel",
      "dev",
      "filehelm",
    ]);
    expect(segs[0].absPath).toBe("/");
    expect(segs[1].absPath).toBe("/Users");
    expect(segs[4].absPath).toBe("/Users/joel/dev/filehelm");
  });

  it("normalises stray backslashes from upstream Windows-y input", async () => {
    const { splitPath } = await import("@/lib/path");
    const segs = splitPath("/home/joel\\projects");
    expect(segs.map((s) => s.label)).toEqual(["/", "home", "joel", "projects"]);
  });

  it("returns just the root for /", async () => {
    const { splitPath } = await import("@/lib/path");
    const segs = splitPath("/");
    expect(segs.length).toBe(1);
    expect(segs[0].absPath).toBe("/");
  });

  it("joinPath uses / on POSIX", async () => {
    const { joinPath } = await import("@/lib/platform");
    expect(joinPath("/Users/joel", "dev", "filehelm")).toBe(
      "/Users/joel/dev/filehelm",
    );
  });
});
