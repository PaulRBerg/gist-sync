import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, vi, it as vitestIt } from "vitest";
import type { FileContents, GistResponse } from "../services/github-api";
import { GitHubApiService } from "../services/github-api";

// Regex for matching gist description with timestamp
const GIST_DESCRIPTION_REGEX =
  /"description":".*my-workspace \| synced via gist-sync extension \| \d{4}-\d{2}-\d{2}@\d{2}:\d{2}:\d{2}"/;

// Helper to run Effect and verify it fails with expected error
function expectFailure<A, E>(exit: Exit.Exit<A, E>, verify: (error: E) => void): void {
  if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
    verify(exit.cause.error);
  } else {
    throw new Error("Effect did not fail as expected");
  }
}

describe("GitHubApiService", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  describe("createGist", () => {
    const token = "ghp_test_token_123";
    const workspacePath = "/Users/test/my-workspace";
    const files: FileContents = {
      "file1.txt": { content: "Hello" },
      "file2.md": { content: "# World" },
    };

    it.effect("makes POST request with correct headers and body", () =>
      Effect.gen(function* () {
        const mockResponse: GistResponse = {
          html_url: "https://gist.github.com/user/abc123",
          id: "abc123",
        };

        mockFetch.mockResolvedValue({
          json: async () => mockResponse,
          ok: true,
          status: 201,
        });

        const api = yield* GitHubApiService;
        const result = yield* api.createGist(token, files, workspacePath);

        expect(result).toEqual(mockResponse);
        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.github.com/gists",
          expect.objectContaining({
            body: expect.stringMatching(GIST_DESCRIPTION_REGEX),
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            method: "POST",
          })
        );
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("returns GistResponse on success", () =>
      Effect.gen(function* () {
        const mockResponse: GistResponse = {
          html_url: "https://gist.github.com/user/xyz789",
          id: "xyz789",
        };

        mockFetch.mockResolvedValue({
          json: async () => mockResponse,
          ok: true,
          status: 201,
        });

        const api = yield* GitHubApiService;
        const result = yield* api.createGist(token, files, workspacePath);

        expect(result.id).toBe("xyz789");
        expect(result.html_url).toBe("https://gist.github.com/user/xyz789");
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with HttpError on 401 Unauthorized", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "Bad credentials",
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.createGist(token, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            body: "Bad credentials",
            endpoint: "https://api.github.com/gists",
            status: 401,
            statusText: "Unauthorized",
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with HttpError on 500 Internal Server Error", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Server error",
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.createGist(token, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            status: 500,
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with HttpError on network error", () =>
      Effect.gen(function* () {
        mockFetch.mockRejectedValue(new Error("Network failure"));

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.createGist(token, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            status: 0,
            statusText: "Network failure",
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    vitestIt("handles timeout with TimeoutError", async () => {
      vi.useFakeTimers();

      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                json: async () => ({ html_url: "https://gist.github.com/late", id: "late" }),
                ok: true,
              });
            }, 35_000); // 35 seconds, exceeds 30 second timeout
          })
      );

      const program = Effect.gen(function* () {
        const api = yield* GitHubApiService;
        return yield* api.createGist(token, files, workspacePath);
      });

      const effectPromise = Effect.runPromiseExit(
        program.pipe(Effect.provide(GitHubApiService.Default))
      ).then((exit) => {
        expectFailure(exit, (error) => {
          // biome-ignore lint/suspicious/noMisplacedAssertion: assertion is inside vitestIt callback
          expect(error).toMatchObject({
            _tag: "TimeoutError",
            durationMs: 30_000,
            operation: "createGist",
          });
        });
      });

      // Advance timers to trigger timeout
      await vi.advanceTimersByTimeAsync(31_000);

      await effectPromise;

      vi.useRealTimers();
    });
  });

  describe("updateGist", () => {
    const token = "ghp_test_token_456";
    const gistId = "existing_gist_id";
    const workspacePath = "/Users/test/my-workspace";
    const files: FileContents = {
      "updated.txt": { content: "Updated content" },
    };

    it.effect("makes PATCH request with correct headers and updates description", () =>
      Effect.gen(function* () {
        const mockResponse: GistResponse = {
          html_url: "https://gist.github.com/user/existing_gist_id",
          id: gistId,
        };

        mockFetch.mockResolvedValue({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        });

        const api = yield* GitHubApiService;
        const result = yield* api.updateGist(token, gistId, files, workspacePath);

        expect(result).toEqual(mockResponse);
        expect(mockFetch).toHaveBeenCalledWith(
          `https://api.github.com/gists/${gistId}`,
          expect.objectContaining({
            body: expect.stringMatching(GIST_DESCRIPTION_REGEX),
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            method: "PATCH",
          })
        );
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("returns GistResponse on success", () =>
      Effect.gen(function* () {
        const mockResponse: GistResponse = {
          html_url: "https://gist.github.com/user/updated123",
          id: "updated123",
        };

        mockFetch.mockResolvedValue({
          json: async () => mockResponse,
          ok: true,
          status: 200,
        });

        const api = yield* GitHubApiService;
        const result = yield* api.updateGist(token, gistId, files, workspacePath);

        expect(result.id).toBe("updated123");
        expect(result.html_url).toBe("https://gist.github.com/user/updated123");
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with GistNotFoundError on 404", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "Not Found",
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.updateGist(token, gistId, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "GistNotFoundError",
            gistId,
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with HttpError on 401", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "Bad credentials",
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.updateGist(token, gistId, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            status: 401,
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    it.effect("fails with HttpError on 500", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "Server error",
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.updateGist(token, gistId, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            status: 500,
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );

    vitestIt("handles timeout with TimeoutError", async () => {
      vi.useFakeTimers();

      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                json: async () => ({ html_url: "https://gist.github.com/late", id: "late" }),
                ok: true,
              });
            }, 35_000);
          })
      );

      const program = Effect.gen(function* () {
        const api = yield* GitHubApiService;
        return yield* api.updateGist(token, gistId, files, workspacePath);
      });

      const effectPromise = Effect.runPromiseExit(
        program.pipe(Effect.provide(GitHubApiService.Default))
      ).then((exit) => {
        expectFailure(exit, (error) => {
          // biome-ignore lint/suspicious/noMisplacedAssertion: assertion is inside vitestIt callback
          expect(error).toMatchObject({
            _tag: "TimeoutError",
            durationMs: 30_000,
            operation: "updateGist",
          });
        });
      });

      await vi.advanceTimersByTimeAsync(31_000);

      await effectPromise;

      vi.useRealTimers();
    });

    it.effect("handles invalid JSON response", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          json: () => {
            throw new Error("Invalid JSON");
          },
          ok: true,
          status: 200,
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.updateGist(token, gistId, files, workspacePath));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            statusText: "Invalid JSON",
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );
  });

  describe("AbortController integration", () => {
    vitestIt("can be interrupted via Effect.interrupt", async () => {
      vi.useFakeTimers();

      const abortSpy = vi.fn();
      const originalAbortController = global.AbortController;

      // Mock AbortController to spy on abort calls
      global.AbortController = class MockAbortController {
        signal = { aborted: false };
        abort() {
          abortSpy();
          this.signal.aborted = true;
        }
      } as any;

      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                json: async () => ({ html_url: "https://gist.github.com/late", id: "late" }),
                ok: true,
              });
            }, 35_000);
          })
      );

      const program = Effect.gen(function* () {
        const api = yield* GitHubApiService;
        return yield* api.createGist("token", {}, "workspace");
      });

      const fiber = Effect.runFork(program.pipe(Effect.provide(GitHubApiService.Default)));

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(31_000);
      await Effect.runPromise(fiber.await);

      // Verify abort was called
      // biome-ignore lint/suspicious/noMisplacedAssertion: assertion is inside vitestIt callback
      expect(abortSpy).toHaveBeenCalled();

      // Restore
      global.AbortController = originalAbortController;
      vi.useRealTimers();
    });
  });

  describe("error response body handling", () => {
    it.effect("handles error when reading response body fails", () =>
      Effect.gen(function* () {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          text: () => {
            throw new Error("Cannot read body");
          },
        });

        const api = yield* GitHubApiService;
        const exit = yield* Effect.exit(api.createGist("token", {}, "workspace"));

        expectFailure(exit, (error) => {
          expect(error).toMatchObject({
            _tag: "HttpError",
            body: "",
            status: 400,
            statusText: "Failed to read response body",
          });
        });
      }).pipe(Effect.provide(GitHubApiService.Default))
    );
  });
});
