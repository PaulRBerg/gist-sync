import { Effect, Option } from "effect";
import * as vscode from "vscode";
import type { AppError } from "./errors";
import { NoFilesFoundError } from "./errors";
import { AuthService } from "./services/auth";
import { ConfigService } from "./services/config";
import { FileSystemService } from "./services/file-system";
import type { FileContents } from "./services/github-api";
import { GitHubApiService } from "./services/github-api";

/**
 * Convert a file path to a valid Gist filename.
 * GitHub Gist doesn't support nested paths, so we flatten them.
 * Example: "docs/TODO.md" -> "docs-TODO.md"
 */
export const toGistFilename = (filePath: string): string => {
  return filePath.replace(/\//g, "-");
};

export interface SyncResult {
  gistUrl: string;
  gistId: string;
  fileCount: number;
  isNew: boolean;
}

export const syncFilesToGist: Effect.Effect<
  SyncResult,
  AppError,
  AuthService | ConfigService | FileSystemService | GitHubApiService
> = Effect.gen(function* () {
  // 1. Get workspace root
  const workspace = yield* ConfigService.getWorkspaceRoot;

  // 2. Get files to sync
  const filenames = yield* ConfigService.getFilesToSync;

  // 3. Yield FileSystemService instance
  const fs = yield* FileSystemService;

  // 4. Read files (filter invalid paths, log warnings)
  const files: FileContents = {};

  for (const filename of filenames) {
    const uri = vscode.Uri.joinPath(workspace.uri, filename);

    // Check path traversal
    if (!fs.isPathSafe(workspace.fsPath, uri.fsPath)) {
      yield* Effect.logWarning(`Skipping file outside workspace: ${filename}`);
      continue;
    }

    // Read file (logs warning and returns None on failure)
    const content = yield* fs.readFile(uri);

    if (Option.isSome(content)) {
      const gistFilename = toGistFilename(filename);
      files[gistFilename] = { content: new TextDecoder().decode(content.value) };
    }
  }

  // 5. Validate at least one file
  if (Object.keys(files).length === 0) {
    return yield* new NoFilesFoundError({});
  }

  // 6. Add title file with sync metadata (first file becomes Gist title)
  const titleFilename = `${workspace.name} | gist-sync`;
  const metadata = [
    `Synced: ${new Date().toISOString()}`,
    `Files: ${Object.keys(files).join(", ")}`,
  ].join("\n");
  const filesWithTitle: FileContents = {
    [titleFilename]: { content: metadata },
    ...files,
  };

  // 7. Get auth token
  const token = yield* AuthService.getToken;

  // 8. Get existing gist ID
  const existingGistId = yield* ConfigService.getGistId;

  // 9. Create or update
  const result = yield* Option.match(existingGistId, {
    onNone: () =>
      Effect.gen(function* () {
        const response = yield* GitHubApiService.createGist(token, filesWithTitle, workspace.name);
        yield* ConfigService.setGistId(response.id);
        return {
          fileCount: Object.keys(files).length,
          gistId: response.id,
          gistUrl: response.html_url,
          isNew: true,
        };
      }),
    onSome: (gistId) =>
      Effect.gen(function* () {
        const response = yield* GitHubApiService.updateGist(
          token,
          gistId,
          filesWithTitle,
          workspace.name
        );
        return {
          fileCount: Object.keys(files).length,
          gistId: response.id,
          gistUrl: response.html_url,
          isNew: false,
        };
      }),
  });

  return result;
});
