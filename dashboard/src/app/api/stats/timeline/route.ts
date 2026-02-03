import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90);

    const result = await db.execute(sql`
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - (${days} || ' days')::interval,
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      )
      SELECT 
        d.day::text AS date,
        (SELECT COUNT(*)::int FROM users WHERE created_at::date = d.day) AS new_users,
        (SELECT COUNT(*)::int FROM users WHERE blocked_at IS NOT NULL AND blocked_at::date = d.day) AS blocked,
        (SELECT COUNT(DISTINCT user_id)::int FROM challenges c 
         WHERE c.start_date::date <= d.day 
         AND (c.status = 'active' OR c.updated_at::date > d.day)) AS active_challenge_users
      FROM dates d
      ORDER BY d.day
    `);

    const rows = result.rows as { date: string; new_users: number; blocked: number; active_challenge_users: number }[];
    const data = rows.map((r) => ({
      date: r.date,
      newUsers: r.new_users ?? 0,
      blocked: r.blocked ?? 0,
      activeChallengeUsers: r.active_challenge_users ?? 0,
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error('Timeline API error:', error);
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 });
  }
}
