import { sql } from 'drizzle-orm';
import { db } from '../database/client.js';

export type DashboardSummary = {
  totalUsers: number;
  totalButtonClicks: number;
  activeChallengesNow: number;
};

export type DashboardPoint = {
  day: string; // YYYY-MM-DD
  usersStarted: number;
  buttonClicks: number;
  activeChallenges: number;
};

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(Math.max(Math.floor(days), 1), 365);
}

function startDateForDays(days: number): Date {
  // inclusive range [from .. today]
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

function buildDayKeys(from: Date, days: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(from);
  for (let i = 0; i < days; i += 1) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(cursor.getUTCDate()).padStart(2, '0');
    keys.push(`${y}-${m}-${dd}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const totalUsersRes = await db.execute<{ totalUsers: number }>(sql`
    select count(*)::int as "totalUsers" from users
  `);

  const totalButtonClicksRes = await db.execute<{ totalButtonClicks: number }>(sql`
    select count(*)::int as "totalButtonClicks" from user_button_logs
  `);

  const activeChallengesNowRes = await db.execute<{ activeChallengesNow: number }>(sql`
    select count(*)::int as "activeChallengesNow" from challenges where status = 'active'
  `);

  return {
    totalUsers: totalUsersRes.rows[0]?.totalUsers ?? 0,
    totalButtonClicks: totalButtonClicksRes.rows[0]?.totalButtonClicks ?? 0,
    activeChallengesNow: activeChallengesNowRes.rows[0]?.activeChallengesNow ?? 0,
  };
}

export async function getDashboardTimeseries(daysRaw: number): Promise<{ days: number; from: string; points: DashboardPoint[] }> {
  const days = clampDays(daysRaw);
  const fromDate = startDateForDays(days);
  const fromISO = fromDate.toISOString().slice(0, 10);

  const usersRes = await db.execute<{ day: string; usersStarted: number }>(sql`
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
           count(*)::int as "usersStarted"
    from users
    where created_at >= ${fromDate}
    group by 1
    order by 1
  `);

  const clicksRes = await db.execute<{ day: string; buttonClicks: number }>(sql`
    select to_char(date_trunc('day', clicked_at), 'YYYY-MM-DD') as day,
           count(*)::int as "buttonClicks"
    from user_button_logs
    where clicked_at >= ${fromDate}
    group by 1
    order by 1
  `);

  // Approximation: "active on day" if status=active now AND day is within [start_date .. start_date+duration)
  const activeRes = await db.execute<{ day: string; activeChallenges: number }>(sql`
    with days as (
      select generate_series(date_trunc('day', ${fromDate}::timestamp), date_trunc('day', now()), interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
           (
             select count(*)::int
             from challenges c
             where c.status = 'active'
               and c.start_date::date <= d.day
               and (c.start_date + (c.duration || ' days')::interval)::date > d.day
           ) as "activeChallenges"
    from days d
    order by d.day
  `);

  const usersMap = new Map(usersRes.rows.map((r) => [r.day, r.usersStarted]));
  const clicksMap = new Map(clicksRes.rows.map((r) => [r.day, r.buttonClicks]));
  const activeMap = new Map(activeRes.rows.map((r) => [r.day, r.activeChallenges]));

  const keys = buildDayKeys(fromDate, days);
  const points: DashboardPoint[] = keys.map((day) => ({
    day,
    usersStarted: usersMap.get(day) ?? 0,
    buttonClicks: clicksMap.get(day) ?? 0,
    activeChallenges: activeMap.get(day) ?? 0,
  }));

  return { days, from: fromISO, points };
}

