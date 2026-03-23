import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

export type AuthDestination = "/" | "/login" | "/onboarding";
export const NATIVE_AUTH_CALLBACK_URL = "gocashtracker://auth/callback";

export async function getOperatorIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("operators")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return data?.id ?? null;
}

export async function resolveAuthDestination(session: Session | null): Promise<{
  destination: AuthDestination;
  operatorId: string | null;
}> {
  if (!session) {
    return { destination: "/login", operatorId: null };
  }

  const operatorId = await getOperatorIdForUser(session.user.id);

  return {
    destination: operatorId ? "/" : "/onboarding",
    operatorId,
  };
}

export function getAuthRedirectUrl(): string {
  if (Capacitor.isNativePlatform()) {
    return NATIVE_AUTH_CALLBACK_URL;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback/`;
  }

  return "/auth/callback/";
}

export function isNativeAuthCallback(url: string): boolean {
  return url.startsWith("gocashtracker://auth/");
}

function getAuthParams(url: string): URLSearchParams {
  const parsedUrl = new URL(url);
  const mergedParams = new URLSearchParams(parsedUrl.search);
  const hashParams = new URLSearchParams(
    parsedUrl.hash.startsWith("#") ? parsedUrl.hash.slice(1) : parsedUrl.hash
  );

  for (const [key, value] of hashParams.entries()) {
    if (!mergedParams.has(key)) {
      mergedParams.set(key, value);
    }
  }

  return mergedParams;
}

export async function completeAuthFromUrl(url: string): Promise<Session | null> {
  const params = getAuthParams(url);
  const errorDescription = params.get("error_description") ?? params.get("error");

  if (errorDescription) {
    throw new Error(errorDescription);
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) throw error;

    return data.session;
  }

  const code = params.get("code");

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) throw error;

    return data.session;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

export async function startGoogleSignIn(): Promise<void> {
  const redirectTo = getAuthRedirectUrl();

  if (Capacitor.isNativePlatform()) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data?.url) throw new Error("Could not start Google sign-in.");

    await Browser.open({ url: data.url });
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error) throw error;
}

export async function signOutCurrentUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();

  if (error) throw error;
}
