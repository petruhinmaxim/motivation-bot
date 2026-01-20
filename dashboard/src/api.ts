export type DashboardSummary = {
  totalUsers: number;
  totalButtonClicks: number;
  activeChallengesNow: number;
};

export type DashboardPoint = {
  day: string;
  usersStarted: number;
  buttonClicks: number;
  activeChallenges: number;
};

export type DashboardTimeseries = {
  days: number;
  from: string;
  points: DashboardPoint[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchSummary(): Promise<DashboardSummary> {
  return getJson<DashboardSummary>('/api/dashboard/summary');
}

export function fetchTimeseries(days: number): Promise<DashboardTimeseries> {
  return getJson<DashboardTimeseries>(`/api/dashboard/timeseries?days=${encodeURIComponent(days)}`);
}

