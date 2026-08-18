import { describe, expect, it } from "vitest";
import { gatewayRoutes, resolveGatewayRequest } from "../src/routes.js";

describe("Context OS external entry-point contract", () => {
  it.each([
    ["/v1/records", "server-context", "/v1/records"],
    ["/v1/records/record-1?limit=10", "server-context", "/v1/records/record-1"],
    ["/mcp", "server-mcp", "/mcp"],
  ])("forwards %s to %s", (input, service, upstreamPathname) => {
    expect(resolveGatewayRequest(input)).toMatchObject({
      disposition: "forward",
      service,
      upstreamPathname,
    });
  });

  it("preserves query parameters while routing Context requests", () => {
    expect(resolveGatewayRequest("https://context.example.com/v1/records?limit=10&cursor=next")).toEqual({
      disposition: "forward",
      service: "server-context",
      pathname: "/v1/records",
      upstreamPathname: "/v1/records",
      search: "?limit=10&cursor=next",
    });
  });

  it("reserves Brain paths without exposing a public upstream", () => {
    expect(resolveGatewayRequest("/brain/v1/actions")).toEqual({
      disposition: "reserved",
      service: "server-brain",
      pathname: "/brain/v1/actions",
      search: "",
      reason: "local-only",
    });
  });

  it("rejects paths outside the public contract", () => {
    expect(resolveGatewayRequest("/mcp/v1/tools")).toEqual({ disposition: "not-found", pathname: "/mcp/v1/tools" });
    expect(resolveGatewayRequest("/private/server-context")).toEqual({
      disposition: "not-found",
      pathname: "/private/server-context",
    });
  });

  it("does not encode internal hosts or ports in the public route contract", () => {
    expect(JSON.stringify(gatewayRoutes)).not.toMatch(/127\.0\.0\.1|localhost|:\\d{2,5}/);
  });
});
