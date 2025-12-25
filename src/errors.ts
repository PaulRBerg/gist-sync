import { Data } from "effect";

export class AuthError extends Data.TaggedError("AuthError")<{ message: string }> {}
export class NoWorkspaceError extends Data.TaggedError("NoWorkspaceError")<Record<string, never>> {}
export class NoFilesFoundError extends Data.TaggedError("NoFilesFoundError")<
  Record<string, never>
> {}
export class ConfigWriteError extends Data.TaggedError("ConfigWriteError")<{
  cause: unknown;
}> {}
export class HttpError extends Data.TaggedError("HttpError")<{
  status: number;
  statusText: string;
  body: string;
  endpoint: string;
}> {}
export class GistNotFoundError extends Data.TaggedError("GistNotFoundError")<{
  gistId: string;
}> {}
export class TimeoutError extends Data.TaggedError("TimeoutError")<{
  operation: string;
  durationMs: number;
}> {}

export type AppError =
  | AuthError
  | NoWorkspaceError
  | NoFilesFoundError
  | ConfigWriteError
  | HttpError
  | GistNotFoundError
  | TimeoutError;

/**
 * Map errors to user-facing messages
 */
export function renderError(error: AppError): string {
  switch (error._tag) {
    case "AuthError":
      return `Authentication failed: ${error.message}`;
    case "NoWorkspaceError":
      return "No workspace folder open";
    case "NoFilesFoundError":
      return "No configured files found in workspace";
    case "ConfigWriteError":
      return "Failed to update configuration";
    case "HttpError":
      return `HTTP ${error.status} error at ${error.endpoint}: ${error.statusText}`;
    case "GistNotFoundError":
      return `Gist not found: ${error.gistId}. It may have been deleted.`;
    case "TimeoutError":
      return `Operation "${error.operation}" timed out after ${error.durationMs}ms`;
  }
}
