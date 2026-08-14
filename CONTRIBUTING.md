# Contributing

## Setup

Use Node.js 22 or newer and pnpm 11.

```sh
pnpm install
pnpm verify
```

Keep changes scoped to the relevant app. Run the app-specific build and tests
before opening a pull request. Do not commit API tokens, `.dev.vars`, `.env`
files, captured context, `.wrangler` state, or generated `dist` output.

## Pull requests

Describe the affected client/server, the user-visible behavior, and the
verification commands you ran. Do not include private captures or production
configuration in screenshots, logs, or examples.
