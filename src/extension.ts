import * as path from "node:path";
import { Effect, Layer } from "effect";
import * as vscode from "vscode";
import type { AppError, GistNotFoundError, NoFilesFoundError } from "./errors";
import { renderError } from "./errors";
import type { SyncResult } from "./gist-sync";
import { syncFilesToGist } from "./gist-sync";
import { AuthService } from "./services/auth";
import { ConfigService } from "./services/config";
import { FileSystemService } from "./services/file-system";
import { GitHubApiService } from "./services/github-api";
import {
  createStatusBar,
  hideStatusBar,
  setStatusError,
  setStatusIdle,
  setStatusSuccess,
  setStatusSyncing,
  showStatusBar,
} from "./status-bar";

// Compose all live layers
const MainLive = Layer.mergeAll(
  AuthService.Default,
  ConfigService.Default,
  FileSystemService.Default,
  GitHubApiService.Default
);

// Prompt user to create new gist after 404
const promptCreateNew = Effect.promise(async () => {
  const action = await vscode.window.showErrorMessage(
    "Gist not found. It may have been deleted.",
    "Create New Gist"
  );
  return action === "Create New Gist";
});

// Show success message and optionally open gist
const showSuccess = (result: SyncResult) =>
  Effect.promise(async () => {
    const fileCount = result.fileCount;
    const action = await vscode.window.showInformationMessage(
      `${fileCount} file${fileCount > 1 ? "s" : ""} synced to Gist successfully!`,
      "Open Gist"
    );
    if (action === "Open Gist") {
      vscode.env.openExternal(vscode.Uri.parse(result.gistUrl));
    }
  });

// Handle 404: prompt user to create new gist
const handleGistNotFound = (
  statusBar: vscode.StatusBarItem,
  error: GistNotFoundError,
  isRetry: boolean
): Effect.Effect<
  SyncResult,
  AppError,
  AuthService | ConfigService | FileSystemService | GitHubApiService
> => {
  // Don't loop forever on retry
  if (isRetry) {
    return Effect.fail(error);
  }

  return promptCreateNew.pipe(
    Effect.flatMap((confirmed) => {
      if (!confirmed) {
        // User declined - re-throw to show error message
        return Effect.fail(error);
      }
      // Clear gist ID and retry
      return ConfigService.setGistId("").pipe(
        Effect.tap(() => Effect.sync(() => setStatusIdle(statusBar))),
        Effect.flatMap(() => syncFilesToGist)
      );
    })
  );
};

// Get configured status bar extensions
const getStatusBarExtensions = (): string[] => {
  return (
    vscode.workspace.getConfiguration("gistSync").get<string[]>("statusBarExtensions") ?? [".md"]
  );
};

// Check if file matches configured extensions (case-insensitive)
const fileMatchesExtensions = (fileName: string, extensions: string[]): boolean => {
  const lowerFileName = fileName.toLowerCase();
  return extensions.some((ext) => lowerFileName.endsWith(ext.toLowerCase()));
};

// Handle no files found: prompt to add current file
const handleNoFilesFound = (
  statusBar: vscode.StatusBarItem,
  error: NoFilesFoundError
): Effect.Effect<
  SyncResult,
  AppError,
  AuthService | ConfigService | FileSystemService | GitHubApiService
> => {
  const editor = vscode.window.activeTextEditor;
  const extensions = getStatusBarExtensions();

  // Check if current file matches configured extensions
  if (editor && fileMatchesExtensions(editor.document.fileName, extensions)) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const relativePath = workspaceFolder
      ? vscode.workspace.asRelativePath(editor.document.uri)
      : path.basename(editor.document.fileName);

    return Effect.promise(async () => {
      const action = await vscode.window.showInformationMessage(
        `Add "${relativePath}" to sync list?`,
        "Add File",
        "Cancel"
      );
      return action === "Add File" ? relativePath : null;
    }).pipe(
      Effect.flatMap((filePath) => {
        if (!filePath) {
          return Effect.fail(error);
        }
        // Append file to existing config and retry sync
        return ConfigService.getFilesToSync.pipe(
          Effect.flatMap((existingFiles) => {
            const updatedFiles = existingFiles.includes(filePath)
              ? existingFiles
              : [...existingFiles, filePath];
            return ConfigService.setFilesToSync(updatedFiles);
          }),
          Effect.tap(() => Effect.sync(() => setStatusIdle(statusBar))),
          Effect.flatMap(() => syncFilesToGist)
        );
      })
    );
  }

  // No matching file open - show guidance with configured extensions
  const extList = extensions.join(", ");
  return Effect.sync(() => {
    setStatusError(statusBar);
    vscode.window.showErrorMessage(
      `Open a file with extension ${extList} to sync, or configure files in settings.`
    );
  }).pipe(Effect.flatMap(() => Effect.fail(error)));
};

// Main sync effect with 404 recovery
const syncWithRecovery = (
  statusBar: vscode.StatusBarItem,
  isRetry = false
): Effect.Effect<void, never, never> =>
  syncFilesToGist.pipe(
    // Handle no files found: prompt to add current file
    Effect.catchTag("NoFilesFoundError", (error) => handleNoFilesFound(statusBar, error)),
    // Handle 404 recovery
    Effect.catchTag("GistNotFoundError", (error) => handleGistNotFound(statusBar, error, isRetry)),
    // Success handling
    Effect.tap((result) => showSuccess(result)),
    Effect.tap(() => Effect.sync(() => setStatusSuccess(statusBar))),
    // Error handling
    Effect.catchAll((error) =>
      Effect.sync(() => {
        setStatusError(statusBar);
        vscode.window.showErrorMessage(`Gist Sync failed: ${renderError(error)}`);
      })
    ),
    // Provide layers
    Effect.provide(MainLive),
    // Ensure void return
    Effect.asVoid
  );

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = createStatusBar();

  // Update status bar visibility based on active editor
  const updateStatusBarVisibility = () => {
    const editor = vscode.window.activeTextEditor;
    const extensions = getStatusBarExtensions();

    if (editor && fileMatchesExtensions(editor.document.fileName, extensions)) {
      showStatusBar(statusBar);
    } else {
      hideStatusBar(statusBar);
    }
  };

  // Set initial visibility
  updateStatusBarVisibility();

  // Listen for editor changes
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(updateStatusBarVisibility);

  // Listen for config changes to update status bar visibility
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("gistSync.statusBarExtensions")) {
      updateStatusBarVisibility();
    }
  });

  const syncCommand = vscode.commands.registerCommand("gistSync.syncToGist", () => {
    setStatusSyncing(statusBar);
    Effect.runPromise(syncWithRecovery(statusBar));
  });

  context.subscriptions.push(syncCommand, statusBar, editorChangeListener, configChangeListener);
}

export function deactivate(): void {
  // Cleanup handled by context.subscriptions
}
