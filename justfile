import "node_modules/@sablier/devkit/just/base.just"

# Build extension with esbuild
@build *args:
    bunx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node {{ args }}
alias b := build

# Watch mode for development
@watch:
    just build --watch
alias w := watch

# Run tests
@test:
    bun vitest run
alias t := test

# Test watch mode
@test-watch:
    bun vitest
alias tw := test-watch

# Package extension as VSIX
@package:
    just build --minify
    bunx @vscode/vsce package --no-dependencies
alias p := package