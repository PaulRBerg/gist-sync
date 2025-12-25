import { Duration, Effect } from "effect";
import { GistNotFoundError, HttpError, TimeoutError } from "../errors";

const GIST_API_BASE = "https://api.github.com/gists";
const FETCH_TIMEOUT = Duration.seconds(30);

const buildGistDescription = (workspaceName: string): string => `${workspaceName} | gist-sync`;

export type FileContents = Record<string, { content: string }>;

export interface GistResponse {
  id: string;
  html_url: string;
}

// Helper: create interruptible fetch with AbortController
const fetchWithAbort = (url: string, options: RequestInit): Effect.Effect<Response, HttpError> =>
  Effect.async<Response, HttpError>((resume) => {
    const controller = new AbortController();

    fetch(url, { ...options, signal: controller.signal })
      .then((response) => resume(Effect.succeed(response)))
      .catch((error) =>
        resume(
          Effect.fail(
            new HttpError({
              body: "",
              endpoint: url,
              status: 0,
              statusText: error instanceof Error ? error.message : "Network error",
            })
          )
        )
      );

    // Return cleanup function that aborts the fetch
    return Effect.sync(() => controller.abort());
  });

// Helper: add timeout to effect
const withTimeout = <A, E>(
  effect: Effect.Effect<A, E>,
  operation: string
): Effect.Effect<A, E | TimeoutError> =>
  Effect.timeoutFail(effect, {
    duration: FETCH_TIMEOUT,
    onTimeout: () => new TimeoutError({ durationMs: Duration.toMillis(FETCH_TIMEOUT), operation }),
  });

// Helper: build headers
const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
});

// Helper: parse response
const parseResponse = (
  response: Response,
  endpoint: string
): Effect.Effect<GistResponse, HttpError> =>
  Effect.gen(function* () {
    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        catch: () =>
          new HttpError({
            body: "",
            endpoint,
            status: response.status,
            statusText: "Failed to read response body",
          }),
        try: () => response.text(),
      });
      return yield* Effect.fail(
        new HttpError({
          body,
          endpoint,
          status: response.status,
          statusText: response.statusText,
        })
      );
    }
    return yield* Effect.tryPromise({
      catch: () =>
        new HttpError({
          body: "",
          endpoint,
          status: response.status,
          statusText: "Invalid JSON",
        }),
      try: () => response.json() as Promise<GistResponse>,
    });
  });

export class GitHubApiService extends Effect.Service<GitHubApiService>()("GitHubApiService", {
  accessors: true,
  effect: Effect.gen(function* () {
    return {
      createGist: (token: string, files: FileContents, workspacePath: string) =>
        withTimeout(
          Effect.gen(function* () {
            const response = yield* fetchWithAbort(GIST_API_BASE, {
              body: JSON.stringify({
                description: buildGistDescription(workspacePath),
                files,
                public: false,
              }),
              headers: headers(token),
              method: "POST",
            });
            return yield* parseResponse(response, GIST_API_BASE);
          }),
          "createGist"
        ),

      updateGist: (token: string, gistId: string, files: FileContents, workspacePath: string) =>
        withTimeout(
          Effect.gen(function* () {
            const endpoint = `${GIST_API_BASE}/${gistId}`;
            const response = yield* fetchWithAbort(endpoint, {
              body: JSON.stringify({
                description: buildGistDescription(workspacePath),
                files,
              }),
              headers: headers(token),
              method: "PATCH",
            });
            return yield* parseResponse(response, endpoint);
          }),
          "updateGist"
        ).pipe(
          // Map 404 to GistNotFoundError
          Effect.catchTag(
            "HttpError",
            (error): Effect.Effect<GistResponse, GistNotFoundError | HttpError> =>
              error.status === 404
                ? Effect.fail(new GistNotFoundError({ gistId }))
                : Effect.fail(error)
          )
        ),
    };
  }),
}) {}
