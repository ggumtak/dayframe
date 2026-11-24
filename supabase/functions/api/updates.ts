// Expo Updates protocol, version 1, as the expo-updates client of Expo SDK 58 speaks it
// (https://docs.expo.dev/technical-specs/expo-updates-1/; client: expo-updates/android/.../loader/FileDownloader.kt).
// Pure formatting and parsing only; routes.ts reads the stored update.
import { ApiProblem } from "./http.ts";

export type UpdatePlatform = "android" | "ios";

export interface ManifestRequest {
  platform: UpdatePlatform;
  runtimeVersion: string;
  /** The update the client is running now (lower case), when it says. */
  currentUpdateId: string | null;
  /** The client sent `expo-expect-signature`: it has a code signing certificate and rejects unsigned manifests. */
  expectsSignature: boolean;
}

/** One published update, as stored by the publish workflow in `app_updates`. */
export interface StoredUpdate {
  id: string;
  /** The manifest JSON exactly as signed and served. */
  manifest: string;
  /** The value of the manifest part's `expo-signature` header, or null when the update is unsigned. */
  signature: string | null;
}

export interface ManifestReply {
  status: 200 | 204;
  headers: Record<string, string>;
  body: string | null;
}

const runtimePattern = /^[A-Za-z0-9._+-]{1,100}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Headers every protocol response carries, including the "no update" one. */
export const protocolHeaders: Readonly<Record<string, string>> = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

/**
 * Reads the client's request headers. The query parameters `platform` and `runtime-version` stand in for the
 * headers so the endpoint can be tried from a browser or curl.
 */
export function readManifestRequest(headers: Headers, query: URLSearchParams): ManifestRequest {
  const platform = (headers.get("expo-platform") ?? query.get("platform") ?? "").trim().toLowerCase();
  if (platform !== "android" && platform !== "ios") {
    throw new ApiProblem(400, "INVALID_INPUT", "Send expo-platform: android or ios", ["expo-platform"]);
  }
  const runtimeVersion = (headers.get("expo-runtime-version") ?? query.get("runtime-version") ?? "").trim();
  if (!runtimePattern.test(runtimeVersion)) {
    throw new ApiProblem(400, "INVALID_INPUT", "Send the app's expo-runtime-version", ["expo-runtime-version"]);
  }
  const protocol = headers.get("expo-protocol-version");
  if (protocol !== null && protocol.trim() !== "1") {
    throw new ApiProblem(400, "UNSUPPORTED_PROTOCOL", "Only expo-updates protocol version 1 is served", ["expo-protocol-version"]);
  }
  const current = headers.get("expo-current-update-id")?.trim() ?? "";
  return {
    platform, runtimeVersion,
    currentUpdateId: uuidPattern.test(current) ? current.toLowerCase() : null,
    expectsSignature: headers.has("expo-expect-signature"),
  };
}

/**
 * The response for the newest update of the client's platform and runtime. "No update" is the protocol's
 * 204 (`expo-protocol-version: 1`, no body), sent when nothing is published for this runtime or the client
 * already runs the newest update.
 */
export function manifestReply(request: ManifestRequest, latest: StoredUpdate | null, boundary: string): ManifestReply {
  if (!latest || latest.id.toLowerCase() === request.currentUpdateId) {
    return { status: 204, headers: { ...protocolHeaders }, body: null };
  }
  if (request.expectsSignature && !latest.signature) {
    // A signing client would reject it anyway; saying why beats the client's generic "no signature".
    throw new ApiProblem(409, "UNSIGNED_UPDATE", "The newest update is unsigned, but this app only accepts signed updates");
  }
  const partHeaders: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": 'form-data; name="manifest"',
    ...(latest.signature ? { "expo-signature": latest.signature } : {}),
  };
  return {
    status: 200,
    headers: { ...protocolHeaders, "content-type": "multipart/mixed; boundary=" + boundary },
    body: multipartMixed([{ headers: partHeaders, body: latest.manifest }], boundary),
  };
}

/** RFC 2046 multipart body with CRLF line breaks, the form OkHttp's MultipartReader and NSURLSession expect. */
export function multipartMixed(parts: Array<{ headers: Record<string, string>; body: string }>, boundary: string): string {
  if (!/^[0-9A-Za-z'()+_,.\/:=?-]{1,70}$/.test(boundary)) throw new Error("Invalid multipart boundary");
  let text = "";
  for (const part of parts) {
    if (part.body.includes("--" + boundary)) throw new Error("Multipart boundary occurs in a part body");
    if (Object.values(part.headers).some((value) => /[\r\n]/.test(value))) throw new Error("Header values cannot contain line breaks");
    text += "--" + boundary + "\r\n"
      + Object.entries(part.headers).map(([name, value]) => name + ": " + value + "\r\n").join("")
      + "\r\n" + part.body + "\r\n";
  }
  return text + "--" + boundary + "--\r\n";
}
