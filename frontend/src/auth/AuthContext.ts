import { createContext, useContext } from "react";

import type { AuthSession, AuthUser } from "./types";

export type AuthContextValue = {
  session: AuthSession | null;
  isReady: boolean;
  user: AuthUser | null;
  isAuthenticated: boolean;
  signIn: (session: AuthSession) => void;
  signOut: () => void;
  markOnboardingComplete: () => void;
  setOnboardingRequired: (required: boolean) => void;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
