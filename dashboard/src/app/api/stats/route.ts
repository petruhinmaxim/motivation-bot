import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, challenges, userFeedback } from '@/lib/schema';
import { sql, count, eq, isNull } from 'drizzle-orm';

export async function GET() {
  try {
    const [totalUsers] = await db.select({ count: count() }).from(users);
    const [activeUsers] = await db
      .select({ count: count() })
      .from(users)
      .where(isNull(users.blockedAt));
    const [blockedUsers] = await db
      .select({ count: count() })
      .from(users)
      .where(sql`${users.blockedAt} IS NOT NULL`);

    const [totalChallenges] = await db.select({ count: count() }).from(challenges);
    const [activeChallenges] = await db
      .select({ count: count() })
      .from(challenges)
      .where(eq(challenges.status, 'active'));
    const [completedChallenges] = await db
      .select({ count: count() })
      .from(challenges)
      .where(eq(challenges.status, 'completed'));
    const [failedChallenges] = await db
      .select({ count: count() })
      .from(challenges)
      .where(eq(challenges.status, 'failed'));

    const [feedbackCount] = await db.select({ count: count() }).from(userFeedback);

    const durationStats = await db
      .select({
        duration: challenges.duration,
        count: count(),
      })
      .from(challenges)
      .groupBy(challenges.duration);

    return NextResponse.json({
      users: {
        total: totalUsers?.count ?? 0,
        active: activeUsers?.count ?? 0,
        blocked: blockedUsers?.count ?? 0,
      },
      challenges: {
        total: totalChallenges?.count ?? 0,
        active: activeChallenges?.count ?? 0,
        completed: completedChallenges?.count ?? 0,
        failed: failedChallenges?.count ?? 0,
      },
      feedback: { total: feedbackCount?.count ?? 0 },
      byDuration: durationStats.reduce(
        (acc, { duration, count }) => ({ ...acc, [duration]: count }),
        {} as Record<number, number>
      ),
    });
  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
