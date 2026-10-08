export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `Ошибка сервера: ${response.status}`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = 'Проверьте границы CUT-интервалов.';
    } catch {
      if (response.status === 502 || response.status === 504) detail = 'Backend недоступен. Проверьте, что API запущен на порту 8000.';
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export function postJson<T>(url: string, value: unknown): Promise<T> {
  return apiRequest<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}
