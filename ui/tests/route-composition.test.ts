import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { type AnyRoute, createMemoryHistory, createRouter } from "@tanstack/react-router";
import {
  constructTree,
  type PluginManifest,
  type RouteOptionsBundle,
} from "every-plugin/ui/manifest";
import { describe, expect, test } from "vitest";
import { sessionQueryKey } from "@/lib/auth";
import manifest from "../src/manifest.gen.json";
import { Route as RootRoute } from "../src/routes/__root";
import { Route as PublicRoute } from "../src/routes/_public";

const ROUTES_DIR = join(import.meta.dirname, "../src/routes");

const V1_URLS = [
  "/",
  "/apply",
  "/contact",
  "/register",
  "/reset-password",
  "/sign-in",
  "/team",
  "/treasury",
  "/admin",
  "/client",
  "/platform",
  "/dashboard",
  "/notifications",
  "/profile",
  "/welcome",
  "/accept-invitation/$id",
  "/docs/$slug",
  "/work/$slug",
  "/docs/",
  "/work/",
  "/client/$engagementId",
  "/admin/members",
  "/admin/settings",
  "/client/reports",
  "/platform/members",
  "/work-orders/$id",
  "/admin/",
  "/client/",
  "/platform/",
  "/admin/contributors/$nearAccount",
  "/admin/engagements/$engagementId",
  "/admin/projects/$slug",
  "/admin/work-orders/$id",
  "/client/$engagementId/billings",
  "/client/$engagementId/ideas",
  "/client/$engagementId/plan",
  "/client/$engagementId/prepayments",
  "/client/$engagementId/reports",
  "/admin/applications/",
  "/admin/billings/",
  "/admin/budgets/",
  "/admin/contributors/",
  "/admin/engagements/",
  "/admin/projects/",
  "/admin/reports/",
  "/admin/work-orders/",
  "/client/$engagementId/",
  "/client/projects/",
  "/client/$engagementId/projects/$slug",
  "/client/projects/$engagementId/$slug",
  "/client/$engagementId/projects/",
];

const routes = (manifest as unknown as PluginManifest).routes;

const realOptions: Record<string, RouteOptionsBundle> = {
  _public: PublicRoute.options as RouteOptionsBundle,
};

const AUTH_PLUGIN_ROUTES = [
  {
    id: "_public/login",
    type: "route",
    path: "/login",
    parentId: "_public",
    file: "_public/login.tsx",
  },
  {
    id: "_public/login/device/",
    type: "route",
    path: "/device/",
    parentId: "_public/login",
    file: "_public/login/device/index.tsx",
  },
] as PluginManifest["routes"];

function plugin(key: string, records: PluginManifest["routes"]) {
  return {
    key,
    manifest: { ...manifest, name: key, routes: records } as PluginManifest,
    routeConfig: {
      routeConfigLoaders: Object.fromEntries(
        records.map((r) => [r.id, async () => (key === "ui" && realOptions[r.id]) || {}]),
      ),
    },
  };
}

async function compose(records: PluginManifest["routes"]) {
  const plugins = { ui: plugin("ui", records), auth: plugin("auth", AUTH_PLUGIN_ROUTES) };
  const { routeTree } = await constructTree({
    name: "dashboard",
    plugins: [
      { key: "ui", mfName: "ui" },
      { key: "auth", mfName: "auth" },
    ],
    rootOptions: RootRoute.options as RouteOptionsBundle,
    resolve: async (ref) => plugins[ref.key as keyof typeof plugins],
  });
  return routeTree;
}

function fullPaths(route: AnyRoute): string[] {
  const children = (route.children ?? []) as AnyRoute[];
  return [route.fullPath, ...children.flatMap(fullPaths)];
}

async function composedPaths(records: PluginManifest["routes"]): Promise<Set<string>> {
  const routeTree = await compose(records);
  createRouter({ routeTree });
  return new Set(fullPaths(routeTree));
}

async function navigate(path: string, cachedSession: unknown) {
  const queryClient = new QueryClient();
  if (cachedSession !== undefined) queryClient.setQueryData(sessionQueryKey, cachedSession);
  const router = createRouter({
    routeTree: await compose(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, session: null } as never,
  });
  await router.load();
  return router.state.location;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routeFiles(join(dir, entry.name))
      : [relative(ROUTES_DIR, join(dir, entry.name))],
  );
}

describe("route composition", () => {
  test("every v1 URL still composes", async () => {
    const composed = await composedPaths(routes);
    expect(V1_URLS.filter((url) => !composed.has(url))).toEqual([]);
  });

  test("a layout written as route.tsx would drop its segment from every child URL", async () => {
    const asRouteTsx = routes.map((r) =>
      r.id === "_authenticated/platform" ? { ...r, type: "layout" as const } : r,
    );
    const composed = await composedPaths(asRouteTsx);
    expect(composed.has("/platform/members")).toBe(false);
    expect(composed.has("/members")).toBe(true);
  });

  test("layouts with a URL segment are sibling files, never route.tsx", () => {
    expect(routeFiles(ROUTES_DIR).filter((file) => file.endsWith("route.tsx"))).toEqual([]);
  });
});

describe("sign-in gate", () => {
  const user = { id: "u1", name: "Ada", email: "ada@example.com", role: "user" };

  test("a session signed into after page load passes the gate on in-app navigation", async () => {
    const location = await navigate("/dashboard", { user, session: { id: "s1", userId: "u1" } });
    expect(location.pathname).toBe("/dashboard");
  });

  test("a signed-out deep link goes to /sign-in with its redirect kept", async () => {
    const location = await navigate("/dashboard", null);
    expect(location.pathname).toBe("/sign-in");
    expect(location.search).toMatchObject({ redirect: "/dashboard" });
  });

  test("the auth plugin's device sign-in stays reachable under /login", async () => {
    const location = await navigate("/login/device/", null);
    expect(location.pathname).toBe("/login/device/");
  });
});
