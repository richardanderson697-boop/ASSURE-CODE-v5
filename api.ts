// ============================================================
// ASSURE CODE DASHBOARD — API Client
// Typed wrappers for the NestJS API Gateway.
// All requests include JWT from Supabase session.
// ============================================================

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // In production: get JWT from Supabase session cookie
  // For now we read from localStorage (Next.js client only)
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('assure_jwt')
    : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `API error ${res.status}`);
  }

  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────

export async function exchangeToken(supabaseAccessToken: string) {
  return apiFetch<{ access_token: string }>('/auth/token', {
    method: 'POST',
    body: JSON.stringify({ supabaseAccessToken }),
  });
}

// ── Specs ─────────────────────────────────────────────────────

export async function listSpecs(page = 1, limit = 20) {
  return apiFetch<{ data: any[]; total: number; page: number }>(`/specs?page=${page}&limit=${limit}`);
}

export async function getSpec(specVersionId: string) {
  return apiFetch<any>(`/specs/${specVersionId}`);
}

export async function getSpecVersionChain(specVersionId: string) {
  return apiFetch<any[]>(`/specs/${specVersionId}/history`);
}

export async function getSpecDiffs(fromVersionId: string, toVersionId: string) {
  return apiFetch<any[]>(`/specs/diffs?from=${fromVersionId}&to=${toVersionId}`);
}

export async function createSpec(payload: {
  projectIdea: string;
  jurisdictions: string[];
  frameworks: string[];
}) {
  return apiFetch<{ jobId: string; streamUrl: string }>('/compliance/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Compliance Jobs (SSE streaming) ───────────────────────────

export function streamJobStatus(
  jobId: string,
  onUpdate: (event: { status: string; progress: number; message?: string }) => void,
  onComplete: (result: any) => void,
): () => void {
  const url = `${API_URL}/compliance/jobs/${jobId}/stream`;
  const token = typeof window !== 'undefined' ? localStorage.getItem('assure_jwt') : null;

  // EventSource doesn't support custom headers — pass token as query param
  const es = new EventSource(`${url}?token=${token ?? ''}`);

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.status === 'completed' || data.status === 'failed') {
      es.close();
      onComplete(data);
    } else {
      onUpdate(data);
    }
  };

  es.onerror = () => es.close();

  return () => es.close();
}

// ── Regulations ───────────────────────────────────────────────

export async function listRegulationImpactLog(workspaceId?: string) {
  const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
  return apiFetch<any[]>(`/regulations/impact-log${qs}`);
}

// ── Workspace ─────────────────────────────────────────────────

export async function listMembers() {
  return apiFetch<any[]>('/workspace/members');
}

export async function inviteMember(email: string, role: string) {
  return apiFetch<any>('/workspace/members/invite', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(memberId: string) {
  return apiFetch<void>(`/workspace/members/${memberId}`, { method: 'DELETE' });
}

// ── Scraper Platform ──────────────────────────────────────────

const SCRAPER_URL = process.env.NEXT_PUBLIC_SCRAPER_URL ?? 'http://localhost:8000';

export async function listScraperJobs() {
  const res = await fetch(`${SCRAPER_URL}/api/v1/jobs`);
  return res.json();
}

export async function getScraperJob(jobId: string) {
  const res = await fetch(`${SCRAPER_URL}/api/v1/jobs/${jobId}`);
  return res.json();
}
