import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/accept-invite', '/api/cron', '/api/health'];

/**
 * First line of defence only — it checks for the presence of a session cookie
 * so unauthenticated users are bounced to /login without a database round trip.
 *
 * It is NOT the authorisation boundary. Every page and server action
 * independently resolves the session and checks permissions server-side, because
 * a cookie's presence proves nothing about its validity.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has('vw_session');
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
