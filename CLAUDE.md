# Development Instructions

AI agents working on this VSCode extension must follow these guidelines.

References:

- **Project overview**: @README.md
- **Dependencies**: @package.json
- **Commands**: @justfile

## Lint Rules

After generating code, run these commands **in order**.

**File argument rules:**

- Changed fewer than 10 files? → Pass specific paths or globs
- Changed 10+ files? → Omit file arguments to process all files

**Command sequence:**

1. **`bunx biome lint <files>`** — lint TS/JSON (skip if none changed)

2. **`bunx tsc --noEmit`** — verify TypeScript types (always run on entire project)

**Examples:**

```bash
# Fewer than 10 files: use specific paths and/or globs
bunx biome lint src/extension.ts src/services/**/*

# 10+ files: run default command
bunx biome lint

# TypeScript check runs on entire project
bunx tsc --noEmit
```

If any command fails, analyze the errors and fix only those related to files you changed. Ignore pre-existing errors in
other files.

## Commands

### Dependency Management

```bash
ni                   # Install all dependencies
ni package-name      # Add dependency
ni -D package-name   # Add dev dependency
nun package-name     # Remove dependency
```

### Development

```bash
just build           # Bundle extension with esbuild
just watch           # Development mode with hot rebuild
just test            # Run Vitest
just test-watch      # Vitest watch mode
```

## Code Standards

### Effect-TS

Uses Effect for functional error handling. Key files:

- `src/errors.ts` — discriminated error types with `_tag`
- `src/services/` — Effect services with `.Default` layers

### TypeScript

- Prefer `type` over `interface`
- Avoid `any`; use `unknown` if type is truly unknown

### Naming Conventions

- **Directories**: `kebab-case` (e.g., `__tests__`)
- **Files**: `kebab-case` for services/utilities (e.g., `github-api.ts`)
- **Tests**: `*.test.ts` in `src/__tests__/`

## Testing

- Vitest with Node environment
- Mock `vscode` module via `vi.mock("vscode", ...)`
- Tests in `src/__tests__/`

## Structure

```
src/
├── extension.ts       # Entry point, command registration
├── gist-sync.ts       # Core orchestration (Effect workflow)
├── errors.ts          # Discriminated error types
├── status-bar.ts      # Status bar UI management
├── services/
│   ├── auth.ts        # GitHub OAuth via VSCode API
│   ├── config.ts      # Configuration service
│   ├── file-system.ts # File operations with path safety
│   └── github-api.ts  # GitHub Gist API client
└── __tests__/         # Unit + integration tests
```

## Extension Lifecycle

- Activates on startup (onStartupFinished)
- Registers `gistSync.syncToGist` command
- Files to sync configured via `gistSync.files` setting
- Gist ID stored per-workspace in `.vscode/settings.json`
