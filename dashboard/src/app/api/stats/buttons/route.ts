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
        (SELECT COUNT(*)::int FROM user_button_logs WHERE clicked_at::date = d.day) AS button_clicks
      FROM dates d
      ORDER BY d.day
    `);

    const rows = result.rows as { date: string; button_clicks: number }[];
    const data = rows.map((r) => ({
      date: r.date,
      buttonClicks: r.button_clicks ?? 0,
    }));

    return NextResponse.json(data);
  } catch (error) {
    console.error('Buttons stats API error:', error);
    return NextResponse.json({ error: 'Failed to fetch button stats' }, { status: 500 });
  }
}
