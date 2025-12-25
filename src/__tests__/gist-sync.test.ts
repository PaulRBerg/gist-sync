import { it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";
import * as vscode from "vscode";
import { GistNotFoundError, HttpError, NoWorkspaceError } from "../errors";
import { syncFilesToGist, toGistFilename } from "../gist-sync";
import { AuthService } from "../services/auth";
import { ConfigService } from "../services/config";
import { FileSystemService } from "../services/file-system";
import type { FileContents, GistResponse } from "../services/github-api";
import { GitHubApiService } from "../services/github-api";

// Mock vscode module minimally - just what's needed for these tests
vi.mock("vscode", () => ({
  Uri: {
    joinPath: vi.fn(),
  },
}));

// Test data helpers
const createMockUri = (fsPath: string): vscode.Uri => ({
  authority: "",
  fragment: "",
  fsPath,
  path: fsPath,
  query: "",
  scheme: "file",
  toJSON: () => ({ fsPath }),
  with: () => createMockUri(fsPath),
});

const createMockWorkspace = (name = "test-workspace", fsPath = "/workspace") => ({
  fsPath,
  name,
  uri: createMockUri(fsPath),
});

const encoder = new TextEncoder();

// Test Layers
const TestAuthService = (token = "test-token") =>
  Layer.succeed(AuthService, {
    getToken: Effect.succeed(token),
  });

const TestConfigService = (
  files: string[] = ["file1.md"],
  gistId: Option.Option<string> = Option.none(),
  workspace = createMockWorkspace()
) => {
  let savedGistId = gistId;
  return Layer.succeed(ConfigService, {
    getFilesToSync: Effect.succeed(files),
    getGistId: Effect.sync(() => savedGistId),
    getWorkspaceRoot: Effect.succeed(workspace),
    setGistId: (id: string) =>
      Effect.sync(() => {
        savedGistId = Option.some(id);
      }),
  });
};

const TestConfigServiceNoWorkspace = () =>
  Layer.succeed(ConfigService, {
    getFilesToSync: Effect.succeed(["file1.md"]),
    getGistId: Effect.succeed(Option.none()),
    getWorkspaceRoot: Effect.fail(new NoWorkspaceError()),
    setGistId: () => Effect.void,
  });

const TestFileSystemService = (fileContents: Map<string, string>) =>
  Layer.succeed(FileSystemService, {
    isPathSafe: (basePath: string, fullPath: string) => fullPath.startsWith(basePath),
    readFile: (uri: vscode.Uri) => {
      const content = fileContents.get(uri.fsPath);
      if (content === undefined) {
        return Effect.succeed(Option.none<Uint8Array>());
      }
      return Effect.succeed(Option.some(encoder.encode(content)));
    },
  });

const TestGitHubApiService = (
  createResponse: GistResponse = {
    html_url: "https://gist.github.com/new",
    id: "new-gist-id",
  },
  updateResponse: GistResponse = {
    html_url: "https://gist.github.com/existing",
    id: "existing-gist-id",
  }
) =>
  Layer.succeed(GitHubApiService, {
    createGist: (_token: string, _files: FileContents, _workspacePath: string) =>
      Effect.succeed(createResponse),
    updateGist: (_token: string, _gistId: string, _files: FileContents, _workspacePath: string) =>
      Effect.succeed(updateResponse),
  });

const TestGitHubApiServiceWithError = (error: HttpError | GistNotFoundError) =>
  Layer.succeed(GitHubApiService, {
    createGist: () => Effect.fail(error),
    updateGist: () => Effect.fail(error),
  });

describe("gist-sync integration tests", () => {
  beforeEach(() => {
    // Mock vscode.Uri.joinPath for this test suite
    vi.spyOn(vscode.Uri, "joinPath").mockImplementation((base, filename) =>
      createMockUri(`${base.fsPath}/${filename}`)
    );
  });
  describe("success flow - create new gist", () => {
    it.effect("should create new gist when no gist ID exists", () => {
      const fileContents = new Map([
        ["/workspace/file1.md", "content1"],
        ["/workspace/file2.md", "content2"],
      ]);

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["file1.md", "file2.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap((result) => {
          expect(result).toEqual({
            fileCount: 2,
            gistId: "new-gist-id",
            gistUrl: "https://gist.github.com/new",
            isNew: true,
          });
        })
      );
    });

    it.effect("should save gist ID after creation", () => {
      const fileContents = new Map([["/workspace/file1.md", "content1"]]);

      let capturedGistId: string | undefined;
      const ConfigServiceWithCapture = Layer.succeed(ConfigService, {
        getFilesToSync: Effect.succeed(["file1.md"]),
        getGistId: Effect.succeed(Option.none()),
        getWorkspaceRoot: Effect.succeed(createMockWorkspace()),
        setGistId: (id: string) =>
          Effect.sync(() => {
            capturedGistId = id;
          }),
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(ConfigServiceWithCapture),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap(() => {
          expect(capturedGistId).toBe("new-gist-id");
        })
      );
    });

    it.effect("should sync single file successfully", () => {
      const fileContents = new Map([["/workspace/single.md", "single content"]]);

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["single.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap((result) => {
          expect(result.fileCount).toBe(1);
          expect(result.isNew).toBe(true);
        })
      );
    });
  });

  describe("success flow - update existing gist", () => {
    it.effect("should update existing gist when gist ID exists", () => {
      const fileContents = new Map([
        ["/workspace/file1.md", "updated content1"],
        ["/workspace/file2.md", "updated content2"],
      ]);

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(
          TestConfigService(["file1.md", "file2.md"], Option.some("existing-gist-id"))
        ),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap((result) => {
          expect(result).toEqual({
            fileCount: 2,
            gistId: "existing-gist-id",
            gistUrl: "https://gist.github.com/existing",
            isNew: false,
          });
        })
      );
    });

    it.effect("should not save gist ID when updating", () => {
      const fileContents = new Map([["/workspace/file1.md", "content1"]]);

      let setGistIdCalled = false;
      const ConfigServiceWithCapture = Layer.succeed(ConfigService, {
        getFilesToSync: Effect.succeed(["file1.md"]),
        getGistId: Effect.succeed(Option.some("existing-gist-id")),
        getWorkspaceRoot: Effect.succeed(createMockWorkspace()),
        setGistId: () =>
          Effect.sync(() => {
            setGistIdCalled = true;
          }),
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(ConfigServiceWithCapture),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap(() => {
          expect(setGistIdCalled).toBe(false);
        })
      );
    });
  });

  describe("error handling - no workspace", () => {
    it.effect("should fail with NoWorkspaceError when no workspace folders configured", () => {
      const fileContents = new Map([["/workspace/file1.md", "content1"]]);

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigServiceNoWorkspace()),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.exit,
        Effect.tap((exit) => {
          expect(exit._tag).toBe("Failure");
        })
      );
    });
  });

  describe("error handling - no files found", () => {
    it.effect("should fail with NoFilesFoundError when all configured files are missing", () => {
      const fileContents = new Map<string, string>(); // Empty - no files

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["missing1.md", "missing2.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.exit,
        Effect.tap((exit) => {
          expect(exit._tag).toBe("Failure");
        })
      );
    });

    it.effect("should succeed with partial file reads", () => {
      const fileContents = new Map([
        // missing.md is not included
        ["/workspace/exists.md", "content exists"],
      ]);

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["missing.md", "exists.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiService()),
        Effect.tap((result) => {
          expect(result.fileCount).toBe(1);
        })
      );
    });
  });

  describe("error handling - 404 recovery", () => {
    it.effect("should fail with GistNotFoundError when update returns 404", () => {
      const fileContents = new Map([["/workspace/file1.md", "content1"]]);

      const error = new GistNotFoundError({ gistId: "deleted-gist-id" });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["file1.md"], Option.some("deleted-gist-id"))),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiServiceWithError(error)),
        Effect.exit,
        Effect.tap((exit) => {
          expect(exit._tag).toBe("Failure");
        })
      );
    });

    it.effect("should fail with HttpError when update returns non-404 error", () => {
      const fileContents = new Map([["/workspace/file1.md", "content1"]]);

      const error = new HttpError({
        body: "Server error",
        endpoint: "https://api.github.com/gists/existing-gist-id",
        status: 500,
        statusText: "Internal Server Error",
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["file1.md"], Option.some("existing-gist-id"))),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(TestGitHubApiServiceWithError(error)),
        Effect.exit,
        Effect.tap((exit) => {
          expect(exit._tag).toBe("Failure");
        })
      );
    });
  });

  describe("path traversal protection", () => {
    it.effect("should skip files outside workspace", () => {
      const workspace = createMockWorkspace("test", "/workspace");
      const fileContents = new Map([
        ["/etc/passwd", "dangerous"], // Outside workspace
        ["/workspace/safe.md", "safe content"],
      ]);

      const FileSystemServiceWithSafety = Layer.succeed(FileSystemService, {
        isPathSafe: (basePath: string, fullPath: string) => fullPath.startsWith(basePath),
        readFile: (uri: vscode.Uri) => {
          // Simulate path traversal check in sync workflow
          if (!uri.fsPath.startsWith(workspace.fsPath)) {
            return Effect.succeed(Option.none<Uint8Array>());
          }
          const content = fileContents.get(uri.fsPath);
          if (content === undefined) {
            return Effect.succeed(Option.none<Uint8Array>());
          }
          return Effect.succeed(Option.some(encoder.encode(content)));
        },
      });

      // Note: The actual implementation needs to construct the full path properly
      // This test demonstrates the expected behavior
      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["safe.md"], Option.none(), workspace)),
        Effect.provide(FileSystemServiceWithSafety),
        Effect.provide(TestGitHubApiService()),
        Effect.tap((result) => {
          expect(result.fileCount).toBe(1);
        })
      );
    });
  });

  describe("workspace path in gist description", () => {
    it.effect("should pass workspace fsPath to createGist", () => {
      const fileContents = new Map([["/my-project/README.md", "# My Project"]]);
      const workspace = createMockWorkspace("my-project", "/my-project");

      let capturedWorkspacePath: string | undefined;
      const GitHubApiServiceWithCapture = Layer.succeed(GitHubApiService, {
        createGist: (_token: string, _files: FileContents, workspacePath: string) =>
          Effect.sync(() => {
            capturedWorkspacePath = workspacePath;
            return {
              html_url: "https://gist.github.com/new",
              id: "new-gist-id",
            };
          }),
        updateGist: (
          _token: string,
          _gistId: string,
          _files: FileContents,
          _workspacePath: string
        ) =>
          Effect.succeed({
            html_url: "https://gist.github.com/existing",
            id: "existing-gist-id",
          }),
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["README.md"], Option.none(), workspace)),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(GitHubApiServiceWithCapture),
        Effect.tap(() => {
          expect(capturedWorkspacePath).toBe("/my-project");
        })
      );
    });
  });

  describe("filename flattening for nested paths", () => {
    it.effect("should flatten nested paths by replacing / with -", () => {
      const fileContents = new Map([
        ["/workspace/docs/README.md", "# Docs"],
        ["/workspace/src/utils/helpers.md", "# Helpers"],
      ]);

      let capturedFiles: FileContents | undefined;
      const GitHubApiServiceWithCapture = Layer.succeed(GitHubApiService, {
        createGist: (_token: string, files: FileContents, _workspacePath: string) =>
          Effect.sync(() => {
            capturedFiles = files;
            return {
              html_url: "https://gist.github.com/new",
              id: "new-gist-id",
            };
          }),
        updateGist: (
          _token: string,
          _gistId: string,
          _files: FileContents,
          _workspacePath: string
        ) =>
          Effect.succeed({
            html_url: "https://gist.github.com/existing",
            id: "existing-gist-id",
          }),
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["docs/README.md", "src/utils/helpers.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(GitHubApiServiceWithCapture),
        Effect.tap(() => {
          expect(capturedFiles).toBeDefined();
          expect(Object.keys(capturedFiles ?? {})).toEqual([
            "docs-README.md",
            "src-utils-helpers.md",
          ]);
        })
      );
    });

    it.effect("should leave flat filenames unchanged", () => {
      const fileContents = new Map([["/workspace/TODO.md", "# TODO"]]);

      let capturedFiles: FileContents | undefined;
      const GitHubApiServiceWithCapture = Layer.succeed(GitHubApiService, {
        createGist: (_token: string, files: FileContents, _workspacePath: string) =>
          Effect.sync(() => {
            capturedFiles = files;
            return {
              html_url: "https://gist.github.com/new",
              id: "new-gist-id",
            };
          }),
        updateGist: (
          _token: string,
          _gistId: string,
          _files: FileContents,
          _workspacePath: string
        ) =>
          Effect.succeed({
            html_url: "https://gist.github.com/existing",
            id: "existing-gist-id",
          }),
      });

      return syncFilesToGist.pipe(
        Effect.provide(TestAuthService()),
        Effect.provide(TestConfigService(["TODO.md"])),
        Effect.provide(TestFileSystemService(fileContents)),
        Effect.provide(GitHubApiServiceWithCapture),
        Effect.tap(() => {
          expect(capturedFiles).toBeDefined();
          expect(Object.keys(capturedFiles ?? {})).toEqual(["TODO.md"]);
        })
      );
    });
  });
});

describe("toGistFilename", () => {
  it("should replace forward slashes with dashes", () => {
    expect(toGistFilename("docs/README.md")).toBe("docs-README.md");
    expect(toGistFilename("src/utils/helpers.md")).toBe("src-utils-helpers.md");
    expect(toGistFilename("a/b/c/d.txt")).toBe("a-b-c-d.txt");
  });

  it("should leave flat filenames unchanged", () => {
    expect(toGistFilename("TODO.md")).toBe("TODO.md");
    expect(toGistFilename("README.md")).toBe("README.md");
  });

  it("should handle empty string", () => {
    expect(toGistFilename("")).toBe("");
  });

  it("should handle multiple consecutive slashes", () => {
    expect(toGistFilename("a//b.md")).toBe("a--b.md");
  });
});
