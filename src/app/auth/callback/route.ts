import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

const OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function isOtpType(value: string): value is EmailOtpType {
  return (OTP_TYPES as string[]).includes(value);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  // Supabase reports a failed/expired link by redirecting back here with an error.
  const linkError = searchParams.get('error_description') ?? searchParams.get('error');
  if (linkError) {
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  const supabase = await createClient();

  if (code) {
    // PKCE flow
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=link_invalid`);
    }
  } else if (token_hash && type && isOtpType(type)) {
    // Magic link / OTP flow
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=link_invalid`);
    }
  } else {
    // Nothing to verify — don't drop the user on the dashboard looking signed out.
    return NextResponse.redirect(`${origin}/login?error=link_invalid`);
  }

  return NextResponse.redirect(`${origin}/`);
}
