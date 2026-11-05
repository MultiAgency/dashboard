import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkWorkflows } from "./check-workflows.ts";

const SHA = "b86f6407cdb75441c7176065a157c4d832f42562";

function workflows(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "workflows-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
  return directory;
}

test("the template wrappers from bos upgrade are refused", () => {
  const directory = workflows({
    "staging.yml": `jobs:
  deploy-staging:
    uses: NEARBuilders/everything-dev/.github/workflows/consumer-staging.yml@v2.0.0-rc.25
    with:
      working_directory: .
    secrets: inherit
`,
    "ci.yml": `jobs:
  ci:
    uses: NEARBuilders/everything-dev/.github/workflows/consumer-ci.yml@v2.0.0-rc.25
    secrets: inherit
  child-ci:
    uses: ./.github/workflows/ci-child.yml
`,
  });
  assert.deepEqual(checkWorkflows(directory), [
    `ci.yml: passes every repository secret (secrets: inherit)`,
    `ci.yml: NEARBuilders/everything-dev/.github/workflows/consumer-ci.yml is pinned to "v2.0.0-rc.25", not a commit SHA`,
    `staging.yml: passes every repository secret (secrets: inherit)`,
    `staging.yml: NEARBuilders/everything-dev/.github/workflows/consumer-staging.yml is pinned to "v2.0.0-rc.25", not a commit SHA`,
  ]);
});

test("a staging workflow on production's Railway token is refused", () => {
  const directory = workflows({
    "staging.yml": `env:
  RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}
`,
  });
  assert.deepEqual(checkWorkflows(directory), [
    `staging.yml: reads secrets.RAILWAY_TOKEN, production's Railway token`,
  ]);
});

const WORKSPACE_TOKEN = `staging.yml: uses a workspace-scoped Railway token (RAILWAY_API_TOKEN), which reaches every project in the workspace, production included`;

for (const [name, text] of [
  [
    "an env key",
    `env:
  RAILWAY_TOKEN: \${{ secrets.RAILWAY_STAGING_TOKEN }}
  RAILWAY_API_TOKEN: \${{ secrets.RAILWAY_STAGING_API_TOKEN }}
`,
  ],
  [
    "a quoted env key",
    `env:
  "RAILWAY_API_TOKEN": \${{ secrets.RAILWAY_STAGING_API_TOKEN }}
`,
  ],
  [
    "a GITHUB_ENV write",
    `steps:
  - run: echo "RAILWAY_API_TOKEN=\${{ secrets.RAILWAY_STAGING_API_TOKEN }}" >> "$GITHUB_ENV"
`,
  ],
  [
    "an inline assignment",
    `steps:
  - run: RAILWAY_API_TOKEN=\${{ secrets.RAILWAY_STAGING_API_TOKEN }} pnpm run bos deploy --env staging
`,
  ],
  [
    "a workspace token secret under another name",
    `env:
  RAILWAY_DEPLOY_KEY: \${{ secrets.RAILWAY_STAGING_API_TOKEN }}
`,
  ],
] as const) {
  test(`a staging workflow with a workspace-scoped Railway token in ${name} is refused`, () => {
    assert.deepEqual(checkWorkflows(workflows({ "staging.yml": text })), [WORKSPACE_TOKEN]);
  });
}

test("the template's automatic production deploy is refused", () => {
  const directory = workflows({
    "deploy.yml": `on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    uses: NEARBuilders/everything-dev/.github/workflows/consumer-deploy.yml@${SHA}
    secrets: inherit
`,
  });
  assert.deepEqual(checkWorkflows(directory), [
    `deploy.yml: passes every repository secret (secrets: inherit)`,
    `deploy.yml: deploys production on workflow_run; production deploys run by hand (workflow_dispatch only)`,
  ]);
});

test("a production deploy on push, inline or listed, is refused", () => {
  for (const on of ["on: push", "on: [push, workflow_dispatch]"]) {
    assert.deepEqual(checkWorkflows(workflows({ "deploy.yml": `${on}\n` })), [
      `deploy.yml: deploys production on push; production deploys run by hand (workflow_dispatch only)`,
    ]);
  }
});

test("our workflows pass", () => {
  const directory = workflows({
    "staging.yml": `env:
  BOS_STORAGE_API_KEY: \${{ secrets.BOS_STAGING_STORAGE_API_KEY }}
  RAILWAY_TOKEN: \${{ secrets.RAILWAY_STAGING_TOKEN }}
`,
    "ci.yml": `jobs:
  ci:
    uses: NEARBuilders/everything-dev/.github/workflows/consumer-ci.yml@${SHA} # v2.0.0-rc.27
  child-ci:
    uses: ./.github/workflows/ci-child.yml
`,
    "deploy.yml": `on:
  workflow_dispatch:
    inputs:
      smoke:
        type: boolean
        default: true

jobs:
  deploy:
    environment: production
    env:
      RAILWAY_TOKEN: \${{ secrets.RAILWAY_TOKEN }}
`,
  });
  assert.deepEqual(checkWorkflows(directory), []);
});
