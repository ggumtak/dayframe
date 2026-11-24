import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../supabase/functions/api/handler.ts";
import { ApiProblem } from "../supabase/functions/api/http.ts";
import {
  manifestReply, multipartMixed, readManifestRequest, type StoredUpdate,
} from "../supabase/functions/api/updates.ts";

const runtime = "bf6c4f813ec7c420dc7fdf1b44dea5e5bd95e5cc";
const updateId = "0f8b7c1e-8d0a-4c55-9a43-5a3c2d1e0b9f";
const manifest = JSON.stringify({
  id: updateId, createdAt: "2026-11-24T03:00:00.000Z", runtimeVersion: runtime,
  launchAsset: { hash: "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg", key: "7d7a287d24bc783bd7a49eab0c888a24",
    contentType: "application/javascript", fileExtension: ".bundle",
    url: "https://example.supabase.co/storage/v1/object/public/app-updates/android/" + runtime + "/x.hbc" },
  assets: [], metadata: {}, extra: { scopeKey: "https://example.supabase.co", message: "빠른 추가 개선" },
});
const stored: StoredUpdate = { id: updateId, manifest, signature: null };
const clientHeaders = (extra: Record<string, string> = {}) => new Headers({
  "expo-platform": "android", "expo-runtime-version": runtime, "expo-protocol-version": "1",
  "expo-api-version": "1", accept: "multipart/mixed,application/expo+json,application/json", ...extra,
});

/**
 * Splits a multipart body the way OkHttp's MultipartReader (which the Android client uses) does: parts are
 * delimited by CRLF "--boundary", each part's headers end at a blank line, and the body ends with "--boundary--".
 */
function readParts(body: string, contentType: string) {
  const boundary = /^multipart\/mixed; boundary=([^\s;]+)$/.exec(contentType)?.[1];
  assert.ok(boundary, "multipart/mixed with a boundary: " + contentType);
  assert.ok(body.startsWith("--" + boundary + "\r\n"));
  assert.ok(body.endsWith("\r\n--" + boundary + "--\r\n"));
  return body.slice(0, -("\r\n--" + boundary + "--\r\n").length).split("\r\n--" + boundary + "\r\n")
    .map((chunk, index) => {
      const raw = index === 0 ? chunk.slice(("--" + boundary + "\r\n").length) : chunk;
      const split = raw.indexOf("\r\n\r\n");
      const headers = new Headers(raw.slice(0, split).split("\r\n").map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
      }));
      return { headers, body: raw.slice(split + 4) };
    });
}

test("manifest requests read the expo-updates headers and reject what the protocol does not allow", () => {
  assert.deepEqual(readManifestRequest(clientHeaders({ "expo-current-update-id": updateId.toUpperCase() }), new URLSearchParams()),
    { platform: "android", runtimeVersion: runtime, currentUpdateId: updateId, expectsSignature: false });
  assert.equal(readManifestRequest(clientHeaders({ "expo-expect-signature": 'sig, keyid="k", alg="rsa-v1_5-sha256"' }),
    new URLSearchParams()).expectsSignature, true);
  // A browser or curl can use query parameters instead.
  assert.equal(readManifestRequest(new Headers(), new URLSearchParams({ platform: "ios", "runtime-version": "1.0.0" })).platform, "ios");
  const problem = (headers: Headers) => {
    try {
      readManifestRequest(headers, new URLSearchParams());
    } catch (error) {
      assert.ok(error instanceof ApiProblem);
      return error.code;
    }
    return null;
  };
  assert.equal(problem(clientHeaders({ "expo-platform": "web" })), "INVALID_INPUT");
  assert.equal(problem(clientHeaders({ "expo-runtime-version": "" })), "INVALID_INPUT");
  assert.equal(problem(clientHeaders({ "expo-runtime-version": "1.0 & or=(id.gt.0)" })), "INVALID_INPUT");
  assert.equal(problem(clientHeaders({ "expo-protocol-version": "0" })), "UNSUPPORTED_PROTOCOL");
  // An id that is not a UUID is ignored rather than compared.
  assert.equal(readManifestRequest(clientHeaders({ "expo-current-update-id": "embedded" }), new URLSearchParams()).currentUpdateId, null);
});

test("no update is the protocol's 204 with the protocol headers", () => {
  const request = readManifestRequest(clientHeaders(), new URLSearchParams());
  const none = manifestReply(request, null, "b");
  assert.deepEqual(none, { status: 204, body: null, headers: {
    "expo-protocol-version": "1", "expo-sfv-version": "0", "cache-control": "private, max-age=0" } });
  // Already running the newest update (the client may send the id in upper case).
  const running = readManifestRequest(clientHeaders({ "expo-current-update-id": updateId.toUpperCase() }), new URLSearchParams());
  assert.equal(manifestReply(running, stored, "b").status, 204);
});

test("a newer update is a multipart/mixed body whose manifest part is byte-identical and carries the signature", async () => {
  const request = readManifestRequest(clientHeaders({ "expo-current-update-id": "11111111-1111-4111-8111-111111111111" }), new URLSearchParams());
  const signature = 'sig="c2lnbmF0dXJl+/=", keyid="dayframe-0123456789ab", alg="rsa-v1_5-sha256"';
  const reply = manifestReply(request, { ...stored, signature }, "dayframe-boundary");
  assert.equal(reply.status, 200);
  assert.equal(reply.headers["expo-protocol-version"], "1");
  assert.equal(reply.headers["expo-sfv-version"], "0");
  assert.equal(reply.headers["cache-control"], "private, max-age=0");
  const parts = readParts(reply.body!, reply.headers["content-type"]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].headers.get("content-disposition"), 'form-data; name="manifest"');
  assert.equal(parts[0].headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(parts[0].headers.get("expo-signature"), signature);
  assert.equal(parts[0].body, manifest);
  // An independent multipart parser (undici's, which is strict about CRLF and boundaries) agrees.
  const form = await new Response(reply.body, {
    headers: { "content-type": reply.headers["content-type"].replace("multipart/mixed", "multipart/form-data") },
  }).formData();
  assert.equal(form.get("manifest"), manifest);
  // Unsigned updates carry no signature header, and a client that demands one gets a clear error.
  assert.equal(readParts(manifestReply(request, stored, "b").body!, "multipart/mixed; boundary=b")[0].headers.has("expo-signature"), false);
  const strict = readManifestRequest(clientHeaders({ "expo-expect-signature": "sig" }), new URLSearchParams());
  assert.throws(() => manifestReply(strict, stored, "b"), { code: "UNSIGNED_UPDATE" });
});

test("multipart formatting refuses bodies and headers that would break the framing", () => {
  assert.throws(() => multipartMixed([{ headers: {}, body: "x\r\n--b--" }], "b"), /boundary occurs/);
  assert.throws(() => multipartMixed([{ headers: { "expo-signature": "a\r\nx-injected: 1" }, body: "{}" }], "b"), /line breaks/);
  assert.throws(() => multipartMixed([], "has space"), /Invalid multipart boundary/);
  assert.equal(multipartMixed([{ headers: { a: "1" }, body: "{}" }], "b"), "--b\r\na: 1\r\n\r\n{}\r\n--b--\r\n");
});

test("the manifest route is anonymous, reads app_updates with the service role and serves the newest row", async () => {
  const seen: URL[] = [];
  let rows: StoredUpdate[] = [stored];
  const handler = createHandler({ url: "https://supabase.invalid", key: "anon-key", serviceKey: "service-key", fetch: async (input, init) => {
    const url = new URL(String(input));
    seen.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(url.pathname, "/rest/v1/app_updates");
    assert.equal(headers.get("apikey"), "service-key");
    assert.equal(headers.get("Authorization"), "Bearer service-key");
    return Response.json(rows);
  } });
  const get = (headers: Headers, method = "GET") =>
    handler(new Request("https://edge.invalid/functions/v1/api/v1/updates/manifest", { method, headers }));

  const found = await get(clientHeaders());
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("expo-protocol-version"), "1");
  assert.equal(found.headers.get("cache-control"), "private, max-age=0");
  assert.match(found.headers.get("content-type") ?? "", /^multipart\/mixed; boundary=dayframe-[0-9a-f-]{36}$/);
  assert.equal(readParts(await found.text(), found.headers.get("content-type")!)[0].body, manifest);
  assert.deepEqual(Object.fromEntries(seen[0].searchParams), {
    select: "id,manifest,signature", platform: "eq.android", runtime_version: "eq." + runtime,
    order: "created_at.desc,id.desc", limit: "1",
  });

  const current = await get(clientHeaders({ "expo-current-update-id": updateId }));
  assert.equal(current.status, 204);
  assert.equal(current.headers.get("expo-protocol-version"), "1");
  assert.equal(await current.text(), "");
  rows = [];
  assert.equal((await get(clientHeaders())).status, 204);

  const calls = seen.length;
  assert.equal((await get(clientHeaders({ "expo-platform": "" }))).status, 400);
  assert.equal((await get(clientHeaders(), "POST")).status, 405);
  assert.equal(seen.length, calls, "invalid requests never reach the database");

  const unconfigured = createHandler({ url: "https://supabase.invalid", key: "anon-key", fetch: async () => assert.fail("no request") });
  const response = await unconfigured(new Request("https://edge.invalid/api/v1/updates/manifest", { headers: clientHeaders() }));
  assert.equal(response.status, 503);
});
