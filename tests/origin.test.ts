import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sameOrigin } from "@/lib/http";

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
});
afterEach(() => vi.unstubAllEnvs());

const request = (
  url: string,
  origin?: string,
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method: "POST",
    headers: { ...(origin === undefined ? {} : { origin }), ...headers },
  });

it("accepts Railway's public HTTPS origin behind an internal HTTP listener", () => {
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "campus-snacks.up.railway.app");
  expect(() =>
    sameOrigin(
      request(
        "http://0.0.0.0:8080/api/pay",
        "https://campus-snacks.up.railway.app",
      ),
    ),
  ).not.toThrow();
});

it("uses the explicit custom origin ahead of the Railway default", () => {
  vi.stubEnv("APP_ORIGIN", "https://snacks.example.com");
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "campus-snacks.up.railway.app");
  expect(() =>
    sameOrigin(
      request("http://0.0.0.0:8080/api/pay", "https://snacks.example.com"),
    ),
  ).not.toThrow();
  expect(() =>
    sameOrigin(
      request(
        "http://0.0.0.0:8080/api/pay",
        "https://campus-snacks.up.railway.app",
      ),
    ),
  ).toThrow("own origin");
});

it.each([
  undefined,
  "null",
  "https://evil.example",
  "http://campus-snacks.up.railway.app",
])(
  "rejects missing, opaque, foreign or wrong-scheme origin %s even with forged forwarded headers",
  (origin) => {
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "campus-snacks.up.railway.app");
    expect(() =>
      sameOrigin(
        request("http://0.0.0.0:8080/api/pay", origin, {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
          forwarded: "host=evil.example;proto=https",
        }),
      ),
    ).toThrow("own origin");
  },
);

it.each([
  "not an origin",
  "http://snacks.example.com",
  "https://user:password@snacks.example.com",
  "https://snacks.example.com/path",
  "https://snacks.example.com?query=value",
  "https://snacks.example.com#fragment",
])("fails closed for invalid configured origin %s", (origin) => {
  vi.stubEnv("APP_ORIGIN", origin);
  expect(() =>
    sameOrigin(request("http://localhost/api/pay", "http://localhost")),
  ).toThrow("Configure APP_ORIGIN");
});

it.each([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://snacks.example.com",
])(
  "preserves direct-origin matching for %s without proxy configuration",
  (origin) => {
    expect(() =>
      sameOrigin(request(`${origin}/api/pay`, origin)),
    ).not.toThrow();
    expect(() =>
      sameOrigin(request(`${origin}/api/pay`, "https://evil.example")),
    ).toThrow("own origin");
  },
);
