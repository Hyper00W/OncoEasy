import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { getPatientProfile, loginWithPassword, requestPatientOtp, verifyPatientOtp } from "../auth/auth-api";
import { useAuth } from "../auth/AuthContext";
import {
  clearPendingPhone,
  readPendingPhone,
  writePendingPhone
} from "../auth/storage";
import type { AuthResponse, AuthSession } from "../auth/types";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

export function WelcomePage({ navigate }: { navigate: Navigate }) {
  return (
    <AuthLayout
      eyebrow="Secure access"
      title="Welcome to OncoEasy"
      description="Choose the sign-in method for your care or professional workspace."
    >
      <div className="choice-list">
        <Button type="button" onClick={() => navigate("/auth/patient/phone")}>
          Continue as patient
        </Button>
        <Button
          className="button-secondary"
          type="button"
          onClick={() => navigate("/auth/professional")}
        >
          Professional or admin sign in
        </Button>
      </div>
    </AuthLayout>
  );
}

export function PatientPhonePage({ navigate }: { navigate: Navigate }) {
  const [phone, setPhone] = useState(readPendingPhone() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const normalizedPhone = phone.trim();
      const response = await requestPatientOtp(normalizedPhone);
      writePendingPhone(response.phone);
      navigate("/auth/patient/otp");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Patient access"
      title="Enter your phone number"
      description="We will send a one-time code to verify your access."
      backAction={() => navigate("/")}
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <Field
          label="Phone number"
          htmlFor="patient-phone"
          hint="Use international format, for example +1 555 123 4567."
        >
          <Input
            id="patient-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <LoadingState label="Requesting code..." /> : "Send code"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function PatientOtpPage({ navigate }: { navigate: Navigate }) {
  const { setOnboardingRequired, signIn } = useAuth();
  const phone = readPendingPhone();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    if (!phone) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phone]);

  if (!phone) {
    return <RedirectToPhone navigate={navigate} />;
  }

  const verifiedPhone = phone;

  async function handleVerify(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await verifyPatientOtp(verifiedPhone, otp);
      signIn(toAuthSession(response));
      const profile = await getPatientProfile();
      setOnboardingRequired(!profile.onboardingCompleted);
      clearPendingPhone();
      navigate(profile.onboardingCompleted ? "/patient" : "/patient/onboarding");
    } catch (verificationError) {
      setError(getErrorMessage(verificationError));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend(): Promise<void> {
    setError(null);
    setIsLoading(true);

    try {
      await requestPatientOtp(verifiedPhone);
      setOtp("");
      setSecondsLeft(60);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Patient access"
      title="Enter your 4-digit code"
      description={`Code sent to ${verifiedPhone}. It expires after 60 seconds.`}
      backAction={() => navigate("/auth/patient/phone")}
    >
      <form className="form-stack" onSubmit={handleVerify}>
        <Field label="Verification code" htmlFor="patient-otp" hint={`${secondsLeft} seconds remaining`}>
          <Input
            id="patient-otp"
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{4}"
            maxLength={4}
            placeholder="0000"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 4))}
            required
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={isLoading || otp.length !== 4}>
          {isLoading ? <LoadingState label="Verifying..." /> : "Verify and continue"}
        </Button>
        <Button
          className="button-link"
          type="button"
          disabled={isLoading || secondsLeft > 0}
          onClick={handleResend}
        >
          {secondsLeft > 0 ? `Resend available in ${secondsLeft}s` : "Resend code"}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ProfessionalLoginPage({ navigate }: { navigate: Navigate }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await loginWithPassword(email.trim(), password);
      completeAuthentication(response, signIn, navigate);
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Professional access"
      title="Sign in to your workspace"
      description="For doctors, pharmacists, and OncoEasy operations administrators."
      backAction={() => navigate("/")}
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <Field label="Email address" htmlFor="professional-email">
          <Input
            id="professional-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="professional-password">
          <Input
            id="professional-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={isLoading}>
          {isLoading ? <LoadingState label="Signing in..." /> : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({
  eyebrow,
  title,
  description,
  backAction,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  backAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="brand-mark">OE</div>
      <Panel>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="intro">{description}</p>
        {children}
        {backAction ? (
          <Button className="button-link" type="button" onClick={backAction}>
            Back
          </Button>
        ) : null}
      </Panel>
      <p className="footer-note">OncoEasy authentication foundation</p>
    </main>
  );
}

function RedirectToPhone({ navigate }: { navigate: Navigate }) {
  useEffect(() => {
    clearPendingPhone();
    navigate("/auth/patient/phone");
  }, [navigate]);

  return <div className="route-loading">Returning to phone sign in...</div>;
}

function completeAuthentication(
  response: AuthResponse,
  signIn: (session: AuthSession) => void,
  navigate: Navigate
): void {
  signIn(toAuthSession(response));
  clearPendingPhone();
  navigate(pathForRole(response.user.role, response.onboardingRequired));
}

function toAuthSession(response: AuthResponse): AuthSession {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user: response.user,
    onboardingRequired: response.onboardingRequired
  };
}

function pathForRole(
  role: AuthResponse["user"]["role"],
  onboardingRequired = false
): string {
  const paths = {
    PATIENT: onboardingRequired ? "/patient/onboarding" : "/patient",
    DOCTOR: "/doctor",
    PHARMACIST: "/pharmacist",
    OPS_ADMIN: "/admin",
    DELIVERY_AGENT: "/delivery-agent/pharmacy"
  } as const;

  return paths[role];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "OTP_EXPIRED") return "That code has expired. Request a new code.";
    if (error.code === "ACCOUNT_NOT_APPROVED") return "Your account is still awaiting approval.";
    if (error.code === "ACCOUNT_INACTIVE") return "This account is inactive. Contact your administrator.";
    return error.message;
  }

  return "We could not complete that request. Please try again.";
}
