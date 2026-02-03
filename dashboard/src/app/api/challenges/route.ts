import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { challenges, users } from '@/lib/schema';
import { desc, eq, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const status = searchParams.get('status');

    const whereClause = status ? eq(challenges.status, status) : sql`1=1`;

    const list = await db
      .select({
        id: challenges.id,
        userId: challenges.userId,
        startDate: challenges.startDate,
        status: challenges.status,
        restartCount: challenges.restartCount,
        daysWithoutWorkout: challenges.daysWithoutWorkout,
        successfulDays: challenges.successfulDays,
        duration: challenges.duration,
        reminderStatus: challenges.reminderStatus,
        reminderTime: challenges.reminderTime,
        createdAt: challenges.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(challenges)
      .innerJoin(users, eq(challenges.userId, users.id))
      .where(whereClause)
      .orderBy(desc(challenges.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(list);
  } catch (error) {
    console.error('Challenges API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch challenges' },
      { status: 500 }
    );
  }
}
