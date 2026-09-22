import {
  ScanResponse,
  AnalyzeResponse,
  RecoverResponse,
  Transaction,
  Decision,
  Intervention,
  AuditEvent,
  Opportunity,
  PolicyLimits,
  SimulateResponse,
  ForceRetryBlockResponse,
  InterventionsResponse,
  EscalationsResponse,
  AnalyticsResponse,
  CopilotResponse,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

async function fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(errorBody.detail || `API Error ${response.status}`);
  }

  return response.json();
}

export const api = {
  getHealth: () => fetchJson<{ status: string }>('/api/health'),

  scanRevenue: (n_total: number = 10000, seed: number = 42) =>
    fetchJson<ScanResponse>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ n_total, seed }),
    }),

  analyzeRevenue: () =>
    fetchJson<AnalyzeResponse>('/api/analyze', {
      method: 'POST',
    }),

  recoverRevenue: () =>
    fetchJson<RecoverResponse>('/api/recover', {
      method: 'POST',
    }),

  getTransactions: (limit: number = 100, leak_type?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (leak_type) params.append('leak_type', leak_type);
    return fetchJson<Transaction[]>(`/api/transactions?${params.toString()}`);
  },

  getTransactionById: (id: string) => fetchJson<Transaction>(`/api/transactions/${id}`),

  getOpportunities: (limit: number = 20) =>
    fetchJson<Opportunity[]>(`/api/opportunities?limit=${limit}`),

  getDecisionById: (id: string) => fetchJson<Decision>(`/api/decisions/${id}`),

  executeIntervention: (target_id: string, idempotency_key?: string) => {
    const headers: Record<string, string> = {};
    if (idempotency_key) {
      headers['Idempotency-Key'] = idempotency_key;
    }
    return fetchJson<Intervention>(`/api/interventions/${target_id}/execute`, {
      method: 'POST',
      headers,
    });
  },

  getAuditLog: (limit: number = 200, leak_type?: string, status?: string) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (leak_type) params.append('leak_type', leak_type);
    if (status) params.append('status', status);
    return fetchJson<{ total: number; entries: AuditEvent[] }>(`/api/audit?${params.toString()}`);
  },

  getPolicies: () =>
    fetchJson<{ active_policy: PolicyLimits; policy_version: string; description: string }>('/api/policies'),

  simulatePolicy: (customLimits: Partial<PolicyLimits>) =>
    fetchJson<SimulateResponse>('/api/simulate', {
      method: 'POST',
      body: JSON.stringify(customLimits),
    }),

  forceRetryBlockDemo: () =>
    fetchJson<ForceRetryBlockResponse>('/api/demo/force-retry-block', {
      method: 'POST',
    }),

  getInterventions: (limit: number = 100) =>
    fetchJson<InterventionsResponse>(`/api/interventions?limit=${limit}`),

  getEscalations: (limit: number = 50) =>
    fetchJson<EscalationsResponse>(`/api/escalations?limit=${limit}`),

  getAnalytics: () =>
    fetchJson<AnalyticsResponse>('/api/analytics'),

  queryCopilot: (query: string, transaction_id?: string) =>
    fetchJson<CopilotResponse>('/api/copilot/query', {
      method: 'POST',
      body: JSON.stringify({ query, transaction_id }),
    }),
};
