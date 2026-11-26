# Platform stack tests

`platform-stack.test.ts` runs the dashboard's own platform services (`api/src/services/platform`) against the
MultiAgency platform's isolated stack: its real gateway and agent servers, with a simulated provider, chain and wallet.
It checks what the in-process fake (`api/tests/fakes/platform-app.ts`) can't: the gateway's real request shapes,
consent checks and timing. It never reaches staging or production.

It is skipped unless `PLATFORM_STACK_STATE` names a running stack, so `pnpm run test` and CI don't run it. Run it before
merging a change to `api/src/services/platform` or the `@multiagency/sdk` version.

1. In a checkout of `MultiAgency/platform` (Node 24.22 or later), start the stack with this deployment's name:

   ```sh
   pnpm test:e2e:stack --app multiagency-dashboard --no-browser
   ```

   It prints `Isolated stack ready: <stack>/state.json` and issues the app credential at startup.

2. From `api/` in this repository, trusting only that stack's certificate:

   ```sh
   PLATFORM_STACK_STATE=<stack>/state.json \
   NODE_EXTRA_CA_CERTS=<stack>/environment/localhost.crt \
   pnpm exec vitest run tests/e2e/platform-stack.test.ts
   ```

3. Stop the stack by creating the file `<stack>/stop`.

The owner's signatures come from the stack's `signOwner` control, which refuses the platform's sign-in text. Each run
uses a new Organization ID, so it can be repeated against the same stack.
