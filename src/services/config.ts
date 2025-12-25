import { Effect, Option } from "effect";
import * as vscode from "vscode";
import { ConfigWriteError, NoWorkspaceError } from "../errors";

const CONFIG_SECTION = "gistSync";

export class ConfigService extends Effect.Service<ConfigService>()("ConfigService", {
  accessors: true,
  effect: Effect.gen(function* () {
    return {
      getFilesToSync: Effect.sync(() => {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const files = config.get<string[]>("files");
        return files && files.length > 0 ? files : ["TODO.md"];
      }),

      getGistId: Effect.sync(() => {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const gistId = config.get<string>("gistId");
        return gistId && gistId.length > 0 ? Option.some(gistId) : Option.none();
      }),

      getWorkspaceRoot: Effect.sync(() => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          return Option.none();
        }
        return Option.some({
          fsPath: workspaceFolder.uri.fsPath,
          name: workspaceFolder.name,
          uri: workspaceFolder.uri,
        });
      }).pipe(
        Effect.flatMap((opt) =>
          Option.match(opt, {
            onNone: () => Effect.fail(new NoWorkspaceError({})),
            onSome: Effect.succeed,
          })
        )
      ),

      setFilesToSync: (files: string[]) =>
        Effect.tryPromise({
          catch: (error) => new ConfigWriteError({ cause: error }),
          try: async () => {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
            await config.update("files", files, vscode.ConfigurationTarget.Workspace);
          },
        }),

      setGistId: (gistId: string) =>
        Effect.tryPromise({
          catch: (error) => new ConfigWriteError({ cause: error }),
          try: async () => {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
            await config.update("gistId", gistId, vscode.ConfigurationTarget.Workspace);
          },
        }),
    };
  }),
}) {}
