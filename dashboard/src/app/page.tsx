"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type Stats = {
  users: { total: number; active: number; blocked: number };
  challenges: {
    total: number;
    active: number;
    completed: number;
    failed: number;
  };
};

type TimelinePoint = {
  date: string;
  newUsers: number;
  blocked: number;
  activeChallengeUsers: number;
};

type ButtonClicksPoint = {
  date: string;
  buttonClicks: number;
};

type User = {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  blockedAt: string | null;
  createdAt: string;
};

type Challenge = {
  id: number;
  userId: number;
  startDate: string;
  status: string;
  successfulDays: number;
  duration: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  createdAt: string;
};

type Feedback = {
  id: number;
  userId: number;
  text: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  createdAt: string;
};

function StatCard({
  title,
  value,
  sub,
}: {
  title: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4">
      <p className="text-slate-400 text-sm">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [buttonClicks, setButtonClicks] = useState<ButtonClicksPoint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "users" | "challenges" | "feedback">(
    "overview"
  );
  const [activeChallengesOnly, setActiveChallengesOnly] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [s, t, b, u, c, f] = await Promise.all([
          fetchJson("/api/stats"),
          fetchJson("/api/stats/timeline?days=30"),
          fetchJson("/api/stats/buttons?days=30"),
          fetchJson("/api/users"),
          fetchJson("/api/challenges"),
          fetchJson("/api/feedback?limit=20"),
        ]);
        setStats(s);
        setTimeline(t);
        setButtonClicks(b);
        setUsers(u);
        setChallenges(c);
        setFeedback(f);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-slate-400">Загрузка…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
        <p className="text-red-400">Ошибка: {error}</p>
      </div>
    );
  }

  const tabs = [
    { id: "overview" as const, label: "Обзор" },
    { id: "users" as const, label: "Пользователи" },
    { id: "challenges" as const, label: "Челленджи" },
    { id: "feedback" as const, label: "Обратная связь" },
  ];

  return (
    <div>
      <nav className="flex gap-2 mb-8 border-b border-slate-700 pb-2">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === id
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && stats && (
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold mb-4">Пользователи</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard title="Всего" value={stats.users.total} />
              <StatCard title="Активных" value={stats.users.active} />
              <StatCard title="Заблокировали" value={stats.users.blocked} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Челленджи</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <StatCard title="Всего" value={stats.challenges.total} />
              <StatCard title="Активных" value={stats.challenges.active} />
              <StatCard title="Завершено" value={stats.challenges.completed} />
              <StatCard title="Провалено" value={stats.challenges.failed} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Динамика за 30 дней</h2>
            <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString("ru", {
                        day: "numeric",
                        month: "short",
                      })
                    }
                    stroke="#94a3b8"
                    fontSize={12}
                  />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                    }}
                    labelFormatter={(v) =>
                      new Date(v).toLocaleDateString("ru", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="newUsers"
                    name="Новые пользователи"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="blocked"
                    name="Заблокировали"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="activeChallengeUsers"
                    name="С активным челленджем"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-4">Нажатия кнопок за 30 дней</h2>
            <div className="rounded-xl bg-slate-800/30 border border-slate-700 p-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buttonClicks}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString("ru", {
                        day: "numeric",
                        month: "short",
                      })
                    }
                    stroke="#94a3b8"
                    fontSize={12}
                  />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "8px",
                    }}
                    labelFormatter={(v) =>
                      new Date(v).toLocaleDateString("ru", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    }
                  />
                  <Bar
                    dataKey="buttonClicks"
                    name="Нажатий"
                    fill="#a855f7"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}

      {tab === "users" && (
        <div>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/50 border-b border-slate-700">
                  <th className="text-left p-3">ID</th>
                  <th className="text-left p-3">Имя</th>
                  <th className="text-left p-3">Username</th>
                  <th className="text-left p-3">Заблокирован</th>
                  <th className="text-left p-3">Создан</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-800 hover:bg-slate-800/30"
                >
                  <td className="p-3 font-mono">{u.id}</td>
                  <td className="p-3">
                    {u.firstName} {u.lastName ?? ""}
                  </td>
                  <td className="p-3 text-slate-400">@{u.username ?? "—"}</td>
                  <td className="p-3">
                    {u.blockedAt ? (
                      <span className="text-red-400">Да</span>
                    ) : (
                      <span className="text-green-400">Нет</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-500">
                    {new Date(u.createdAt).toLocaleString("ru")}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
            <p className="p-3 text-slate-500 text-xs">
              Всего: {users.length} записей
            </p>
          </div>
        </div>
      )}

      {tab === "challenges" && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activeChallengesOnly}
                onChange={(e) => setActiveChallengesOnly(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-green-500 focus:ring-green-500"
              />
              <span className="text-sm text-slate-300">Только активные челленджи</span>
            </label>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-sm">
              <thead>
              <tr className="bg-slate-800/50 border-b border-slate-700">
                <th className="text-left p-3">ID</th>
                <th className="text-left p-3">Пользователь</th>
                <th className="text-left p-3">Длительность</th>
                <th className="text-left p-3">Статус</th>
                <th className="text-left p-3">Успешных дней</th>
                <th className="text-left p-3">Создан</th>
              </tr>
            </thead>
            <tbody>
              {(activeChallengesOnly
                ? challenges.filter((c) => c.status === "active")
                : challenges
              ).map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-800 hover:bg-slate-800/30"
                >
                  <td className="p-3 font-mono">{c.id}</td>
                  <td className="p-3">
                    {c.firstName} {c.lastName ?? ""}{" "}
                    {c.username && (
                      <span className="text-slate-500">@{c.username}</span>
                    )}
                  </td>
                  <td className="p-3">{c.duration} дн.</td>
                  <td className="p-3">
                    <span
                      className={
                        c.status === "active"
                          ? "text-green-400"
                          : c.status === "completed"
                          ? "text-blue-400"
                          : "text-red-400"
                      }
                    >
                      {c.status === "active"
                        ? "Активен"
                        : c.status === "completed"
                        ? "Завершён"
                        : "Провален"}
                    </span>
                  </td>
                  <td className="p-3">{c.successfulDays}</td>
                  <td className="p-3 text-slate-500">
                    {new Date(c.createdAt).toLocaleString("ru")}
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
            <p className="p-3 text-slate-500 text-xs">
              {activeChallengesOnly
                ? `Показано ${challenges.filter((c) => c.status === "active").length} из ${challenges.length} записей`
                : `Всего: ${challenges.length} записей`}
            </p>
          </div>
        </div>
      )}

      {tab === "feedback" && (
        <div className="space-y-4">
          {feedback.map((f) => (
            <div
              key={f.id}
              className="rounded-xl border border-slate-700 bg-slate-800/30 p-4"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="font-medium">
                  {f.firstName} {f.lastName ?? ""}{" "}
                  {f.username && (
                    <span className="text-slate-500 text-sm">@{f.username}</span>
                  )}
                </span>
                <span className="text-slate-500 text-xs">
                  {new Date(f.createdAt).toLocaleString("ru")}
                </span>
              </div>
              <p className="text-slate-300 whitespace-pre-wrap">{f.text}</p>
            </div>
          ))}
          <p className="text-slate-500 text-xs">Показано 20 последних записей</p>
        </div>
      )}
    </div>
  );
}
