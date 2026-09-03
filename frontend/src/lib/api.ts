export type ApiError = { message: string; details?: string; status: number };

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers:
        options.body instanceof FormData
          ? undefined
          : { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      ...options,
    });
  } catch {
    throw {
      message: "We couldn't reach the server. Check your connection and try again.",
      status: 0,
    } as ApiError;
  }

  if (response.status === 401 && !path.includes('/auth/')) {
    window.dispatchEvent(new CustomEvent('hulk:signed-out'));
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : await response.text();

  if (!response.ok) {
    throw {
      message: (payload as any)?.error ?? 'Something went wrong. Try again.',
      details: (payload as any)?.details,
      status: response.status,
    } as ApiError;
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: any) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: any) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, file: File) => {
    const data = new FormData();
    data.append('file', file);
    return request<T>(path, { method: 'POST', body: data });
  },
};

export function errorText(err: unknown): string {
  const e = err as ApiError;
  return e?.message ?? 'Something went wrong. Try again.';
}
