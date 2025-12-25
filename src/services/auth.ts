import { Effect } from "effect";
import * as vscode from "vscode";
import { AuthError } from "../errors";

const GITHUB_AUTH_PROVIDER_ID = "github";
const SCOPES = ["gist"];

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
  accessors: true,
  effect: Effect.gen(function* () {
    return {
      getToken: Effect.tryPromise({
        catch: (error) =>
          new AuthError({
            message: error instanceof Error ? error.message : "Authentication failed",
          }),
        try: async () => {
          const session = await vscode.authentication.getSession(GITHUB_AUTH_PROVIDER_ID, SCOPES, {
            createIfNone: true,
          });
          if (!session) {
            throw new Error("GitHub authentication failed");
          }
          return session.accessToken;
        },
      }),
    };
  }),
}) {}
