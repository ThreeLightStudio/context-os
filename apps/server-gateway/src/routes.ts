export type GatewayService = "server-context" | "server-mcp" | "server-brain";

export type GatewayRoute = {
  service: GatewayService;
  publicPrefix: string;
  upstreamPrefix: string;
  match: "exact" | "prefix";
  exposure: "public" | "reserved";
};

export const gatewayRoutes: readonly GatewayRoute[] = [
  {
    service: "server-context",
    publicPrefix: "/v1",
    upstreamPrefix: "/v1",
    match: "prefix",
    exposure: "public",
  },
  {
    service: "server-mcp",
    publicPrefix: "/mcp",
    upstreamPrefix: "/mcp",
    match: "exact",
    exposure: "public",
  },
  {
    service: "server-brain",
    publicPrefix: "/brain/v1",
    upstreamPrefix: "/v1",
    match: "prefix",
    exposure: "reserved",
  },
];

export type GatewayResolution =
  | {
      disposition: "forward";
      service: GatewayService;
      pathname: string;
      upstreamPathname: string;
      search: string;
    }
  | {
      disposition: "reserved";
      service: GatewayService;
      pathname: string;
      search: string;
      reason: "local-only";
    }
  | {
      disposition: "not-found";
      pathname: string;
    };

function matchesRoute(pathname: string, route: GatewayRoute): boolean {
  if (route.match === "exact") return pathname === route.publicPrefix;
  const prefix = route.publicPrefix;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function rewritePathname(pathname: string, route: GatewayRoute): string {
  const suffix = pathname.slice(route.publicPrefix.length);
  return `${route.upstreamPrefix}${suffix}` || route.upstreamPrefix;
}

export function resolveGatewayRequest(input: string | URL): GatewayResolution {
  const url = typeof input === "string" ? new URL(input, "http://gateway.invalid") : input;
  const route = gatewayRoutes.find((candidate) => matchesRoute(url.pathname, candidate));

  if (!route) return { disposition: "not-found", pathname: url.pathname };
  if (route.exposure === "reserved") {
    return {
      disposition: "reserved",
      service: route.service,
      pathname: url.pathname,
      search: url.search,
      reason: "local-only",
    };
  }

  return {
    disposition: "forward",
    service: route.service,
    pathname: url.pathname,
    upstreamPathname: rewritePathname(url.pathname, route),
    search: url.search,
  };
}
