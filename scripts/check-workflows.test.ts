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
  });
  assert.deepEqual(checkWorkflows(directory), []);
});
