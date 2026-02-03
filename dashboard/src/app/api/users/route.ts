import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 10000) : undefined;
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    let query = db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .offset(offset);

    if (limit !== undefined) {
      query = query.limit(limit) as typeof query;
    }

    const list = await query;

    return NextResponse.json(list);
  } catch (error) {
    console.error('Users API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
