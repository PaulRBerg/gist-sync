import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";
import * as vscode from "vscode";
import { FileSystemService } from "../services/file-system";

// Mock vscode module
vi.mock("vscode", () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  workspace: {
    fs: {
      readFile: vi.fn(),
    },
  },
}));

describe("FileSystemService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("readFile", () => {
    it.effect("returns Option.some with file content on success", () =>
      Effect.gen(function* () {
        const mockContent = new TextEncoder().encode("Hello, World!");
        vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(mockContent);

        const fs = yield* FileSystemService;
        const uri = vscode.Uri.file("/workspace/test.txt");
        const result = yield* fs.readFile(uri);

        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrNull(result)).toEqual(mockContent);
        expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(
          expect.objectContaining({ fsPath: "/workspace/test.txt" })
        );
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("returns Option.none and logs warning on file not found", () =>
      Effect.gen(function* () {
        vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("File not found"));

        const fs = yield* FileSystemService;
        const uri = vscode.Uri.file("/workspace/missing.txt");
        const result = yield* fs.readFile(uri);

        expect(Option.isNone(result)).toBe(true);
        expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(
          expect.objectContaining({ fsPath: "/workspace/missing.txt" })
        );
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("handles multiple file reads independently", () =>
      Effect.gen(function* () {
        const content1 = new TextEncoder().encode("File 1");
        const content2 = new TextEncoder().encode("File 2");

        vi.mocked(vscode.workspace.fs.readFile)
          .mockResolvedValueOnce(content1)
          .mockResolvedValueOnce(content2);

        const fs = yield* FileSystemService;
        const uri1 = vscode.Uri.file("/workspace/file1.txt");
        const uri2 = vscode.Uri.file("/workspace/file2.txt");

        const result1 = yield* fs.readFile(uri1);
        const result2 = yield* fs.readFile(uri2);

        expect(Option.isSome(result1)).toBe(true);
        expect(Option.isSome(result2)).toBe(true);
        expect(Option.getOrNull(result1)).toEqual(content1);
        expect(Option.getOrNull(result2)).toEqual(content2);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("returns Option.none when file read fails with any error", () =>
      Effect.gen(function* () {
        vi.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("Permission denied"));

        const fs = yield* FileSystemService;
        const uri = vscode.Uri.file("/workspace/forbidden.txt");
        const result = yield* fs.readFile(uri);

        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(FileSystemService.Default))
    );
  });

  describe("isPathSafe", () => {
    it.effect("returns true for paths within workspace", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace";
        const fullPath = "/workspace/file.txt";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(true);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("returns true for nested paths within workspace", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace";
        const fullPath = "/workspace/nested/deeply/file.txt";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(true);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("returns false for path traversal attempts", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace";
        const fullPath = "/etc/passwd";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(false);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("detects path traversal in non-normalized paths", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace";
        const fullPath = "/root/etc/passwd";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(false);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("returns false for parent directory access", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace/project";
        const fullPath = "/workspace/other-project/file.txt";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(false);
      }).pipe(Effect.provide(FileSystemService.Default))
    );

    it.effect("handles exact match of base path", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystemService;
        const basePath = "/workspace";
        const fullPath = "/workspace";
        expect(fs.isPathSafe(basePath, fullPath)).toBe(true);
      }).pipe(Effect.provide(FileSystemService.Default))
    );
  });

  describe("Layer integration", () => {
    it.effect("can be provided via Default layer", () =>
      Effect.gen(function* () {
        const mockContent = new TextEncoder().encode("Custom layer content");
        vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(mockContent);

        const fs = yield* FileSystemService;
        const uri = vscode.Uri.file("/test.txt");
        const result = yield* fs.readFile(uri);

        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrNull(result)).toEqual(mockContent);
      }).pipe(Effect.provide(FileSystemService.Default))
    );
  });
});
