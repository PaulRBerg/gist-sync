import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import { beforeEach, describe, expect, vi } from "vitest";
import * as vscode from "vscode";
import { AuthError } from "../errors";
import { AuthService } from "../services/auth";

vi.mock("vscode", () => ({
  authentication: {
    getSession: vi.fn(),
  },
}));

describe("AuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getToken", () => {
    it.effect("should return access token on successful authentication", () =>
      Effect.gen(function* () {
        const mockSession: vscode.AuthenticationSession = {
          accessToken: "test-github-token-123",
          account: {
            id: "user-123",
            label: "testuser",
          },
          id: "session-123",
          scopes: ["gist"],
        };

        vi.mocked(vscode.authentication.getSession).mockResolvedValue(mockSession);

        const service = yield* AuthService;
        const result = yield* service.getToken;

        expect(result).toBe("test-github-token-123");
        expect(vscode.authentication.getSession).toHaveBeenCalledWith("github", ["gist"], {
          createIfNone: true,
        });
      }).pipe(Effect.provide(AuthService.Default))
    );

    it.effect("should fail with AuthError when session is null", () =>
      Effect.gen(function* () {
        vi.mocked(vscode.authentication.getSession).mockResolvedValue(null);

        const service = yield* AuthService;
        const exit = yield* Effect.exit(service.getToken);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(AuthError);
            expect((error.value as AuthError).message).toBe("GitHub authentication failed");
          }
        }
      }).pipe(Effect.provide(AuthService.Default))
    );

    it.effect("should fail with AuthError when getSession throws", () =>
      Effect.gen(function* () {
        vi.mocked(vscode.authentication.getSession).mockRejectedValue(new Error("Network error"));

        const service = yield* AuthService;
        const exit = yield* Effect.exit(service.getToken);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(AuthError);
            expect((error.value as AuthError).message).toBe("Network error");
          }
        }
      }).pipe(Effect.provide(AuthService.Default))
    );

    it.effect("should fail with AuthError when getSession throws non-Error", () =>
      Effect.gen(function* () {
        vi.mocked(vscode.authentication.getSession).mockRejectedValue(
          "Authentication cancelled by user"
        );

        const service = yield* AuthService;
        const exit = yield* Effect.exit(service.getToken);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(AuthError);
            expect((error.value as AuthError).message).toBe("Authentication failed");
          }
        }
      }).pipe(Effect.provide(AuthService.Default))
    );

    it.effect("should request correct scopes from GitHub provider", () =>
      Effect.gen(function* () {
        const mockSession: vscode.AuthenticationSession = {
          accessToken: "token",
          account: { id: "1", label: "user" },
          id: "session-1",
          scopes: ["gist"],
        };

        vi.mocked(vscode.authentication.getSession).mockResolvedValue(mockSession);

        const service = yield* AuthService;
        yield* service.getToken;

        expect(vscode.authentication.getSession).toHaveBeenCalledWith("github", ["gist"], {
          createIfNone: true,
        });
      }).pipe(Effect.provide(AuthService.Default))
    );
  });
});
