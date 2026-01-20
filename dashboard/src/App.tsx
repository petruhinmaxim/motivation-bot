import React from 'react';
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchSummary, fetchTimeseries, type DashboardPoint } from './api';
import { KpiCard } from './components/KpiCard';
import { ChartCard } from './components/ChartCard';

function formatDayLabel(day: string) {
  // "YYYY-MM-DD" -> "DD.MM"
  const [y, m, d] = day.split('-');
  return `${d}.${m}`;
}

export function App() {
  const [days, setDays] = React.useState<number>(30);
  const [summary, setSummary] = React.useState<{ totalUsers: number; totalButtonClicks: number; activeChallengesNow: number } | null>(null);
  const [points, setPoints] = React.useState<DashboardPoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchSummary(), fetchTimeseries(days)])
      .then(([s, ts]) => {
        if (cancelled) return;
        setSummary(s);
        setPoints(ts.points);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Unknown error');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-lg font-semibold tracking-tight">Dashboard</div>
            <div className="text-xs text-slate-400">Motivation Bot</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400">Период</div>
            <select
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
              <option value={180}>180 дней</option>
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <div className="rounded-2xl border border-red-900/60 bg-red-950/30 p-4 text-red-200">
            Ошибка загрузки: {error}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Пользователи (всего)" value={summary?.totalUsers ?? (loading ? '…' : '0')} />
          <KpiCard label="Нажатия кнопок (всего)" value={summary?.totalButtonClicks ?? (loading ? '…' : '0')} />
          <KpiCard label="Активные челленджи (сейчас)" value={summary?.activeChallengesNow ?? (loading ? '…' : '0')} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <ChartCard title="Пользователи, запустившие бота — по дням">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                <XAxis dataKey="day" tickFormatter={formatDayLabel} stroke="#64748b" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#0b1220', border: '1px solid #1f2937', borderRadius: 12, color: '#e2e8f0' }}
                  labelFormatter={(label) => `Дата: ${label}`}
                />
                <Line type="monotone" dataKey="usersStarted" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Нажатия кнопок — по дням">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                <XAxis dataKey="day" tickFormatter={formatDayLabel} stroke="#64748b" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{ background: '#0b1220', border: '1px solid #1f2937', borderRadius: 12, color: '#e2e8f0' }}
                  labelFormatter={(label) => `Дата: ${label}`}
                />
                <Line type="monotone" dataKey="buttonClicks" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="lg:col-span-2">
            <ChartCard title="Активные челленджи — по дням">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
                  <XAxis dataKey="day" tickFormatter={formatDayLabel} stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: '#0b1220', border: '1px solid #1f2937', borderRadius: 12, color: '#e2e8f0' }}
                    labelFormatter={(label) => `Дата: ${label}`}
                  />
                  <Line type="monotone" dataKey="activeChallenges" stroke="#a78bfa" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Примечание: график “активные челленджи по дням” построен по текущим активным челленджам и их длительности.
        </div>
      </main>
    </div>
  );
}

