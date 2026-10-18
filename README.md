# hello-pretext

A demo of text flowing around circular obstacles, built with [@chenglou/pretext](https://github.com/chenglou/pretext).

```bash
bun install
bun dev
```

http://localhost:3000

## Validation

```bash
bun install --frozen-lockfile
bunx --no-install playwright install chromium
bun run typecheck
bun run test
bun run build
```

The tests use Chromium to exercise text layout and the demo.
On Linux, use `bunx --no-install playwright install --with-deps chromium` to install the required system dependencies as well.
