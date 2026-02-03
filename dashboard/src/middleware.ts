import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateBasicAuth, getAuthResponse } from '@/lib/auth';

export function middleware(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!validateBasicAuth(authHeader)) {
    return getAuthResponse();
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
