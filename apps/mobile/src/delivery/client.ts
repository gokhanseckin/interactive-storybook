import AsyncStorage from "@react-native-async-storage/async-storage";
import { CatalogSchema, ManifestSchema, type Manifest } from "@story/contracts";
export const API = (process.env.EXPO_PUBLIC_CONTENT_API_URL ?? "").replace(
  /\/$/,
  "",
);
let staffToken: string | undefined;
export async function staffLogin(email: string, password: string) {
  const response = await request("/login", { email, password, mobile: true });
  staffToken = response.token;
}
export async function staffLogout() {
  try {
    if (staffToken) await request("/logout", {});
  } finally {
    staffToken = undefined;
  }
}
export async function request(path: string, body?: unknown) {
  if (!API) throw new Error("Content service is not configured");
  const res = await fetch(API + "/api" + path, {
    method: body ? "POST" : "GET",
    credentials: "omit",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(staffToken ? { Authorization: `Bearer ${staffToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Content request failed (${res.status})`);
  return res.json();
}
export async function catalog(refresh = true) {
  if (refresh)
    try {
      const data = CatalogSchema.parse(await request("/catalog"));
      await AsyncStorage.setItem("@story/catalog", JSON.stringify(data));
      return data;
    } catch {
      /* Cached metadata is sufficient for offline discovery. */
    }
  const raw = await AsyncStorage.getItem("@story/catalog");
  try {
    return CatalogSchema.parse(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}
export async function manifest(id: string): Promise<Manifest> {
  const key = "@story/manifest/" + id;
  const raw = await AsyncStorage.getItem(key);
  if (raw) {
    try {
      const parsed = ManifestSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      /* Recover corrupt cached metadata from the service. */
    }
  }
  const m = ManifestSchema.parse(
    await request("/releases/" + encodeURIComponent(id)),
  );
  await AsyncStorage.setItem(key, JSON.stringify(m));
  return m;
}
let labProxy: string | undefined;
export function useDeliveryLabProxy() {
  if (__DEV__) labProxy = process.env.EXPO_PUBLIC_DELIVERY_LAB_PROXY;
}
export async function delivery(m: Manifest, assetId: string) {
  const result = (await (m.releaseId.startsWith("preview-")
    ? request(`/stories/${m.storyId}/delivery`, {
        assetId,
        revision: m.revision,
      })
    : request("/delivery", { releaseId: m.releaseId, assetId }))) as {
    url: string;
    expires: number;
  };
  if (labProxy) {
    const url = new URL(result.url),
      proxy = new URL(labProxy);
    url.host = proxy.host;
    url.protocol = proxy.protocol;
    result.url = url.toString();
  }
  return result;
}
