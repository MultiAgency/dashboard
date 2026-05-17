# Contributing Guide

Thank you for contributing to the **Agency Dashboard Template**.

This template is maintained by [MultiAgency](https://github.com/MultiAgency) and built on the upstream [everything.dev](https://github.com/NEARBuilders/everything-dev) runtime. Issues and PRs about the template (agency surfaces, modules, dashboard customizations) belong here. Issues and PRs about the underlying runtime/framework belong upstream.

## Quick Setup

```bash
bun install              # Install dependencies
bun run db:migrate       # Apply API schema to ./api.db
bos dev --host remote    # Start development (typical workflow)
```

UI typically runs at http://localhost:3003. API and auth ports may vary by local dev session; check the ready lines in the dev output if ports auto-bump.

**Need more details?** See [README.md](./README.md) for architecture and [AGENTS.md](./AGENTS.md) for the agent operational guide.

## Development Workflow

### Making Changes

- **UI Changes**: Edit `ui/src/` → hot reload automatically → publish with `bos publish --deploy`
- **API Changes**: Edit `api/src/` → hot reload automatically → publish with `bos publish --deploy`
- **Runtime Config**: Edit `bos.config.json` → publish with `bos publish --deploy` (the host is remote — not in this repo)

### Plugin Architecture

Business logic is organized into independent plugins loaded via Module Federation:

- **`api/`** — Owns the agency surface today (applications, projects, contributors, allocations, billings, assignments, settings, treasury, nearn, team, me) plus shared auth middleware. As agency-specific plugins ship, business logic can migrate out of `api/` into its own plugin.
- **`plugins/`** — No plugins currently registered. New plugins live here, each self-contained with its own `contract.ts`, `index.ts`, `rspack.config.js`, and `package.json`. The canonical scaffold lives upstream at [`NEARBuilders/everything-dev/plugins/_template`](https://github.com/NEARBuilders/everything-dev/tree/main/plugins/_template); the dashboard fork has not validated the end-to-end scaffolding flow.

The UI accesses plugin routes via namespaced clients: `apiClient.<pluginName>.<routeName>()`.

The API can compose across plugins in-process via `createPlugin.withPlugins<PluginsClient>()` — it receives typed client factories for all other plugins and calls their routers directly without HTTP roundtrips.

Plugin and API variables are configured in `bos.config.json`:
- API variables: `app.api.variables` → `config.variables` in `initialize`
- Plugin variables: `plugins.{key}.variables` → plugin's own `config.variables` in `initialize`

Plugins are accessible both directly via HTTP (`/api/{key}/*`) and in-process via `services.plugins.{key}()`. The UI uses HTTP; the API uses in-process for composition.

### Environment Configuration

All runtime URLs are configured in `bos.config.json` - no rebuild needed. Use the workspace dev scripts to choose what runs locally:

```bash
bun run dev          # Local UI + API, remote host (typical)
bun run dev:ui       # Local UI only; API runs remote
bun run dev:api      # Local API only; UI runs remote
bun run dev:proxy    # Local UI + API behind a proxy
```

Secrets go in `.env` (see [.env.example](./.env.example) for required variables).

### Project Documentation

- **[README.md](./README.md)** - Architecture, tech stack, and quick start
- **[AGENTS.md](./AGENTS.md)** - Operational guide for AI agents
- **[ui/public/README.md](./ui/public/README.md)** - Public-facing description of the maintainer's reference deployment
- **[ui/public/skill.md](./ui/public/skill.md)** - Agent-oriented usage notes for the deployed site
- **[OPERATOR.md](./OPERATOR.md)** - Operator notes for the workspace

## Git Workflow

### Branch Naming

Create feature branches from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feature/amazing-feature
```

**Branch naming conventions:**
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions/changes

### Semantic Commits

Use [Semantic Commits](https://gist.github.com/joshbuchea/6f47e86d2510bce28f8e7f42ae84c716) for clear history:

```bash
# Format: <type>(<scope>): <subject>
git commit -m "feat(api): add user profile endpoint"
git commit -m "fix(ui): resolve routing issue on mobile"
git commit -m "docs(readme): update setup instructions"
git commit -m "refactor(api): simplify auth middleware"
git commit -m "test(ui): add coverage for login flow"
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `style:` - Code style (formatting, no logic change)
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Tests
- `chore:` - Build/config/tooling changes

### Changesets

We use [Changesets](https://github.com/changesets/changesets) for release notes and version coordination.

**When to add a changeset:**
- Any user-facing change
- Breaking changes
- Skip for docs-only changes, internal refactors, and test-only changes

**Create a changeset:**
```bash
bun run changeset
```

### Pull Request Process

1. **Before creating PR:**
   ```bash
   bun test        # Run all tests
   bun typecheck   # Type check all packages
   bun lint        # Run linting
   ```

2. **Create PR from your fork:**
   - Push branch to your fork: `git push origin feature/amazing-feature`
   - Open PR against `main` branch of upstream repo
   - Use descriptive title following semantic format
   - Fill out PR template if provided

3. **PR requirements:**
   - All tests must pass
   - Type checking must pass
   - Linting must pass
   - Add a changeset when the change is user-facing

4. **After merge:**
   - Delete your branch

## Contributing Code

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create** a feature branch: `git checkout -b feature/amazing-feature`
4. **Make** your changes
5. **Test** thoroughly: `bun test` and `bun typecheck`
6. **Add a changeset** when appropriate: `bun run changeset`
7. **Commit** using [Semantic Commits](https://gist.github.com/joshbuchea/6f47e86d2510bce28f8e7f42ae84c716)
8. **Push** to your fork: `git push origin feature/amazing-feature`
9. **Open** a Pull Request to the main repository

### Code Style

- Follow existing TypeScript patterns and conventions
- Ensure type safety (no `any` types unless absolutely necessary)
- Write descriptive commit messages
- Add tests for new features
- Use semantic Tailwind classes
- No code comments in implementation (code should be self-documenting)

### Linting

We use [Biome](https://biomejs.dev/) for linting and formatting:

```bash
bun lint        # Check linting
bun lint:fix    # Fix auto-fixable issues
bun format      # Format code
```

## Reporting Issues

Use [GitHub Issues](https://github.com/MultiAgency/dashboard/issues) with:

- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected behavior** vs **actual behavior**
- **Environment details** (OS, Node/Bun version, browser, etc.)

For issues with the upstream runtime itself, file at [NEARBuilders/everything-dev](https://github.com/NEARBuilders/everything-dev/issues).

## Getting Help

- Check [AGENTS.md](./AGENTS.md) for agent operational guidance
- Check the [README](./README.md) for architecture and setup
- Check [OPERATOR.md](./OPERATOR.md) for operator-facing notes
- Ask questions in GitHub Issues or Discussions

---

Thank you for your contributions.
