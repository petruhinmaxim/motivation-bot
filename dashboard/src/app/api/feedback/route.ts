import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userFeedback, users } from '@motivation-bot/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const list = await db
      .select({
        id: userFeedback.id,
        userId: userFeedback.userId,
        text: userFeedback.text,
        createdAt: userFeedback.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(userFeedback)
      .innerJoin(users, eq(userFeedback.userId, users.id))
      .orderBy(desc(userFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(list);
  } catch (error) {
    console.error('Feedback API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feedback' },
      { status: 500 }
    );
  }
}
