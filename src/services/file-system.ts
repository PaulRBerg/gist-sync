import { Effect, Option } from "effect";
import * as vscode from "vscode";

export class FileSystemService extends Effect.Service<FileSystemService>()("FileSystemService", {
  accessors: true,
  effect: Effect.gen(function* () {
    return {
      // Sync check if path is safe (no traversal outside workspace)
      isPathSafe: (basePath: string, fullPath: string): boolean => fullPath.startsWith(basePath),
      // Read file, return Option.none() and log warning on failure
      readFile: (uri: vscode.Uri) =>
        Effect.tryPromise({
          catch: () => null, // Will be handled below
          try: () => vscode.workspace.fs.readFile(uri),
        }).pipe(
          Effect.map((content) => Option.some(content)),
          Effect.catchAll(() =>
            Effect.logWarning(`File not found: ${uri.fsPath}`).pipe(
              Effect.map(() => Option.none<Uint8Array>())
            )
          )
        ),
    };
  }),
}) {}
