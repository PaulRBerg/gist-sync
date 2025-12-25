import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";
import * as vscode from "vscode";
import { ConfigWriteError, NoWorkspaceError } from "../errors";
import { ConfigService } from "../services/config";

vi.mock("vscode", () => ({
  ConfigurationTarget: {
    Workspace: 2,
  },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
  },
  workspace: {
    getConfiguration: vi.fn(),
    workspaceFolders: undefined,
  },
}));

describe("ConfigService", () => {
  let mockConfig: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      get: vi.fn(),
      update: vi.fn(),
    };
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      mockConfig as unknown as vscode.WorkspaceConfiguration
    );
    // Reset workspace folders
    (
      vscode.workspace as { workspaceFolders: vscode.WorkspaceFolder[] | undefined }
    ).workspaceFolders = undefined;
  });

  describe("getFilesToSync", () => {
    it.effect("should return configured files when set", () =>
      Effect.gen(function* () {
        const files = ["README.md", "CHANGELOG.md", "notes.txt"];
        mockConfig.get.mockReturnValue(files);

        const service = yield* ConfigService;
        const result = yield* service.getFilesToSync;

        expect(result).toEqual(files);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("gistSync");
        expect(mockConfig.get).toHaveBeenCalledWith("files");
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should return default ['TODO.md'] when config is empty", () =>
      Effect.gen(function* () {
        mockConfig.get.mockReturnValue(undefined);

        const service = yield* ConfigService;
        const result = yield* service.getFilesToSync;

        expect(result).toEqual(["TODO.md"]);
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should return default ['TODO.md'] when config is empty array", () =>
      Effect.gen(function* () {
        mockConfig.get.mockReturnValue([]);

        const service = yield* ConfigService;
        const result = yield* service.getFilesToSync;

        expect(result).toEqual(["TODO.md"]);
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should return single configured file", () =>
      Effect.gen(function* () {
        const files = ["NOTES.md"];
        mockConfig.get.mockReturnValue(files);

        const service = yield* ConfigService;
        const result = yield* service.getFilesToSync;

        expect(result).toEqual(files);
      }).pipe(Effect.provide(ConfigService.Default))
    );
  });

  describe("getGistId", () => {
    it.effect("should return Option.some when gist ID is configured", () =>
      Effect.gen(function* () {
        const gistId = "abc123def456";
        mockConfig.get.mockReturnValue(gistId);

        const service = yield* ConfigService;
        const result = yield* service.getGistId;

        expect(Option.isSome(result)).toBe(true);
        expect(Option.getOrThrow(result)).toBe(gistId);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("gistSync");
        expect(mockConfig.get).toHaveBeenCalledWith("gistId");
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should return Option.none when gist ID is not configured", () =>
      Effect.gen(function* () {
        mockConfig.get.mockReturnValue(undefined);

        const service = yield* ConfigService;
        const result = yield* service.getGistId;

        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should return Option.none when gist ID is empty string", () =>
      Effect.gen(function* () {
        mockConfig.get.mockReturnValue("");

        const service = yield* ConfigService;
        const result = yield* service.getGistId;

        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(ConfigService.Default))
    );
  });

  describe("setGistId", () => {
    it.effect("should update configuration with new gist ID", () =>
      Effect.gen(function* () {
        const gistId = "xyz789abc123";
        mockConfig.update.mockResolvedValue(undefined);

        const service = yield* ConfigService;
        yield* service.setGistId(gistId);

        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("gistSync");
        expect(mockConfig.update).toHaveBeenCalledWith(
          "gistId",
          gistId,
          vscode.ConfigurationTarget.Workspace
        );
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should fail with ConfigWriteError when update throws", () =>
      Effect.gen(function* () {
        const gistId = "newgist456";
        const updateError = new Error("Permission denied");
        mockConfig.update.mockRejectedValue(updateError);

        const service = yield* ConfigService;
        const exit = yield* Effect.exit(service.setGistId(gistId));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ConfigWriteError);
            expect((error.value as ConfigWriteError).cause).toBe(updateError);
          }
        }
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should handle multiple updates", () =>
      Effect.gen(function* () {
        mockConfig.update.mockResolvedValue(undefined);

        const service = yield* ConfigService;
        yield* Effect.all([
          service.setGistId("gist-1"),
          service.setGistId("gist-2"),
          service.setGistId("gist-3"),
        ]);

        expect(mockConfig.update).toHaveBeenCalledTimes(3);
        expect(mockConfig.update).toHaveBeenNthCalledWith(
          1,
          "gistId",
          "gist-1",
          vscode.ConfigurationTarget.Workspace
        );
        expect(mockConfig.update).toHaveBeenNthCalledWith(
          2,
          "gistId",
          "gist-2",
          vscode.ConfigurationTarget.Workspace
        );
        expect(mockConfig.update).toHaveBeenNthCalledWith(
          3,
          "gistId",
          "gist-3",
          vscode.ConfigurationTarget.Workspace
        );
      }).pipe(Effect.provide(ConfigService.Default))
    );
  });

  describe("getWorkspaceRoot", () => {
    it.effect("should return workspace info when workspace folder exists", () =>
      Effect.gen(function* () {
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
          index: 0,
          name: "my-project",
          uri: vscode.Uri.file("/path/to/workspace"),
        };

        (vscode.workspace as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [
          mockWorkspaceFolder,
        ];

        const service = yield* ConfigService;
        const result = yield* service.getWorkspaceRoot;

        expect(result).toEqual({
          fsPath: "/path/to/workspace",
          name: "my-project",
          uri: mockWorkspaceFolder.uri,
        });
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should fail with NoWorkspaceError when no workspace folder is open", () =>
      Effect.gen(function* () {
        (vscode.workspace as { workspaceFolders: undefined }).workspaceFolders = undefined;

        const service = yield* ConfigService;
        const exit = yield* Effect.exit(service.getWorkspaceRoot);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(NoWorkspaceError);
            expect((error.value as NoWorkspaceError)._tag).toBe("NoWorkspaceError");
          }
        }
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should fail with NoWorkspaceError when workspaceFolders is empty array", () =>
      Effect.gen(function* () {
        (vscode.workspace as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [];

        const service = yield* ConfigService;
        const exit = yield* Effect.exit(service.getWorkspaceRoot);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(NoWorkspaceError);
          }
        }
      }).pipe(Effect.provide(ConfigService.Default))
    );

    it.effect("should use first workspace folder when multiple exist", () =>
      Effect.gen(function* () {
        const mockWorkspaceFolders: vscode.WorkspaceFolder[] = [
          {
            index: 0,
            name: "first-project",
            uri: vscode.Uri.file("/path/to/first"),
          },
          {
            index: 1,
            name: "second-project",
            uri: vscode.Uri.file("/path/to/second"),
          },
        ];

        (vscode.workspace as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders =
          mockWorkspaceFolders;

        const service = yield* ConfigService;
        const result = yield* service.getWorkspaceRoot;

        expect(result).toEqual({
          fsPath: "/path/to/first",
          name: "first-project",
          uri: mockWorkspaceFolders[0].uri,
        });
      }).pipe(Effect.provide(ConfigService.Default))
    );
  });
});
