const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function getToken(): string | null {
  return localStorage.getItem("session");
}

export function setToken(token: string) {
  localStorage.setItem("session", token);
}

export function clearToken() {
  localStorage.removeItem("session");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = (body as { error?: string }).error ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}
