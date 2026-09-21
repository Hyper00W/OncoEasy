import { useEffect, useState, type PropsWithChildren } from "react";

import { AUTHENTICATION_INVALIDATED_EVENT } from "../api/client";
import { getPatientProfile } from "./auth-api";
import {
  clearAuthSession,
  readAuthSession,
  writeAuthSession
} from "./storage";
import { AuthContext } from "./AuthContext";
import type { AuthSession } from "./types";

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(readAuthSession);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession(): Promise<void> {
      const currentSession = readAuthSession();
      if (!currentSession || currentSession.user.role !== "PATIENT") {
        if (!cancelled) setIsReady(true);
        return;
      }

      try {
        const profile = await getPatientProfile();
        if (!cancelled) {
          setSession((current) => current ? { ...current, user: profile.user, onboardingRequired: !profile.onboardingCompleted } : current);
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && "status" in error && (error as { status?: unknown }).status === 401) {
          clearAuthSession();
          setSession(null);
        }
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    void hydrateSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleAuthenticationInvalidated(): void {
      clearAuthSession();
      setSession(null);
    }

    window.addEventListener(AUTHENTICATION_INVALIDATED_EVENT, handleAuthenticationInvalidated);
    return () => window.removeEventListener(AUTHENTICATION_INVALIDATED_EVENT, handleAuthenticationInvalidated);
  }, []);

  function signIn(nextSession: AuthSession): void {
    writeAuthSession(nextSession);
    setSession(nextSession);
  }

  function signOut(): void {
    clearAuthSession();
    setSession(null);
  }

  function markOnboardingComplete(): void {
    setOnboardingRequired(false);
  }

  function setOnboardingRequired(required: boolean): void {
    setSession((currentSession) => {
      if (!currentSession) return null;
      const updatedSession = { ...currentSession, onboardingRequired: required };
      writeAuthSession(updatedSession);
      return updatedSession;
    });
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        isReady,
        user: session?.user ?? null,
        isAuthenticated: session !== null,
        signIn,
        signOut,
        markOnboardingComplete,
        setOnboardingRequired
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
