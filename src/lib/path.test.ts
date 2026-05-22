import { describe, expect, it } from "vitest";
import { basename as ourBasename } from "@/lib/utils";
import { splitWindowsPath, basename } from "@/lib/path";

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
    // Output always uses backslashes for Explorer interop.
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
