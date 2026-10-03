import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { getPatientProfile, loginWithPassword, requestPatientOtp, verifyPatientOtp } from "../auth/auth-api";
import {
  clearPendingDevOtp,
  clearPendingPhone,
  readPendingDevOtp,
  readPendingPhone,
  writePendingDevOtp,
  writePendingPhone
} from "../auth/storage";
import { useAuth } from "../auth/AuthContext";
import type { AuthResponse, AuthSession } from "../auth/types";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
import { ArrowLeftIcon } from "../components/icons";

type Navigate = (path: string) => void;

/**
 * Accessible top-left back control for auth screens. Returns to the previous
 * in-app page when there is one; deep links / fresh tabs fall back to the
 * public homepage (or an explicit route). Same history heuristic as the
 * shared BackLink primitive, so behavior is identical across the product.
 */
function AuthBackLink({ navigate, fallback = "/", label = "Back" }: { navigate: Navigate; fallback?: string; label?: string }) {
  function handleClick(): void {
    if (window.history.length > 1 && window.history.state?.idx > 0) {
      window.history.back();
      return;
    }
    navigate(fallback);
  }

  return (
    <button type="button" className="auth-back-link" onClick={handleClick}>
      <ArrowLeftIcon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function WelcomePage({ navigate }: { navigate: Navigate }) {
  return (
    <AuthLayout
      navigate={navigate}
      eyebrow="Secure access"
      title="Welcome to OncoEasy"
      description="Choose how you sign in. Patients verify with a phone code; healthcare professionals use a work email and password."
      showBack
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
          Healthcare Professional
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
      // Dev/test only: surface the backend-echoed OTP on the next screen when
      // the backend runs in test mode. Undefined in every other environment.
      writePendingDevOtp(response.testOtp ?? null);
      navigate("/auth/patient/otp");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      navigate={navigate}
      eyebrow="Patient access"
      title="Enter your phone number"
      description="We will send a one-time code to verify your access."
      backAction={() => navigate("/auth")}
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

const OTP_LENGTH = 4;
const RESEND_SECONDS = 60;

export function PatientOtpPage({ navigate }: { navigate: Navigate }) {
  const { setOnboardingRequired, signIn } = useAuth();
  const phone = readPendingPhone();
  // Four separate inputs: one digit per box with auto-advance, backspace
  // retreat, arrow navigation, and full-string paste support. The string is
  // still the single source of truth for submission.
  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(""));
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  /**
   * Dev/test convenience only: the backend echoes the OTP in the request
   * response when it runs with NODE_ENV=test, so local development needs no
   * SMS provider. Shown only when the frontend dev server runs in dev mode
   * AND the backend actually returned a testOtp (production backends never
   * do). No OTP is fabricated client-side.
   */
  const [devTestOtp, setDevTestOtp] = useState<string | null>(() =>
    import.meta.env.DEV ? readPendingDevOtp() : null
  );
  const isDevFrontend = import.meta.env.DEV;

  const otp = digits.join("");

  useEffect(() => {
    if (!phone) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phone]);

  // Focus the first empty digit on mount (auto-advance entry point).
  useEffect(() => {
    if (phone) inputsRef.current[0]?.focus();
  }, [phone]);

  if (!phone) {
    return <RedirectToPhone navigate={navigate} />;
  }

  const verifiedPhone = phone;

  function setDigit(index: number, raw: string): void {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      setDigits((current) => current.map((d, i) => (i === index ? "" : d)));
      return;
    }

    setDigits((current) => {
      const next = [...current];
      // Support typing or pasting multiple characters starting at index.
      for (let offset = 0; offset < clean.length && index + offset < OTP_LENGTH; offset += 1) {
        next[index + offset] = clean[offset];
      }
      return next;
    });

    const focusIndex = Math.min(index + clean.length, OTP_LENGTH - 1);
    inputsRef.current[focusIndex]?.focus();
    if (focusIndex === OTP_LENGTH - 1 && index + clean.length >= OTP_LENGTH) {
      inputsRef.current[focusIndex]?.select();
    }
  }

  function handleDigitKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Backspace") {
      event.preventDefault();
      setDigits((current) => {
        const next = [...current];
        if (next[index]) {
          next[index] = "";
        } else if (index > 0) {
          next[index - 1] = "";
          inputsRef.current[index - 1]?.focus();
        }
        return next;
      });
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputsRef.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = Array(OTP_LENGTH).fill("");
    pasted.split("").forEach((digit, i) => {
      next[i] = digit;
    });
    setDigits(next);
    inputsRef.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

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
      clearPendingDevOtp();
      navigate(profile.onboardingCompleted ? "/patient" : "/patient/onboarding");
    } catch (verificationError) {
      setError(getErrorMessage(verificationError));
      // A failed code means the digits are wrong; clear and refocus entry.
      setDigits(Array(OTP_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend(): Promise<void> {
    setError(null);
    setIsLoading(true);

    try {
      const response = await requestPatientOtp(verifiedPhone);
      setDevTestOtp(response.testOtp ?? null);
      setDigits(Array(OTP_LENGTH).fill(""));
      setSecondsLeft(RESEND_SECONDS);
      inputsRef.current[0]?.focus();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout
      navigate={navigate}
      eyebrow="Patient access"
      title="Enter your 4-digit code"
      description={`Code sent to ${verifiedPhone}. It expires after 60 seconds.`}
      backAction={() => navigate("/auth/patient/phone")}
    >
      <form className="form-stack" onSubmit={handleVerify}>
        <div className="field">
          <label id="otp-group-label" htmlFor="otp-0">
            Verification code
          </label>
          <div
            className="otp-group"
            role="group"
            aria-labelledby="otp-group-label"
            aria-describedby="otp-hint"
          >
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputsRef.current[index] = element;
                }}
                id={index === 0 ? "otp-0" : undefined}
                className="input otp-digit"
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
                maxLength={OTP_LENGTH}
                value={digit}
                disabled={isLoading}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => handleDigitKeyDown(index, event)}
                onPaste={handlePaste}
                onFocus={(event) => event.target.select()}
              />
            ))}
          </div>
          <span className="field-hint" id="otp-hint" role="status">
            {secondsLeft > 0
              ? `Expires in ${secondsLeft} seconds`
              : "This code has expired — request a new one below."}
          </span>
          {isDevFrontend && devTestOtp ? (
            <p className="dev-otp-hint" data-dev-otp="true">
              <strong>Development OTP: {devTestOtp}</strong> — shown because the backend is
              running in test mode (NODE_ENV=test). Never displayed in production.
            </p>
          ) : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={isLoading || otp.length !== OTP_LENGTH}>
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
      navigate={navigate}
      eyebrow="Professional access"
      title="Healthcare professional sign in"
      description="Sign in with your work email. Your account's role determines your workspace."
      backAction={() => navigate("/auth")}
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

/**
 * Phase 6.11: dedicated management-portal login. Lives behind the management
 * URL ("/admin/login") — never linked from the public website. No role
 * selection: the backend determines whether the account is OWNER, OPS_ADMIN,
 * or a non-management role (which is rejected here with a clear message).
 */
export function ManagementLoginPage({ navigate }: { navigate: Navigate }) {
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

      if (response.user.role !== "OWNER" && response.user.role !== "OPS_ADMIN") {
        // A non-management account reached the management URL. Do not create
        // a session in the management portal; the public login is the right
        // surface for doctors and pharmacists.
        setError(
          "This account does not have management access. Healthcare professionals sign in from the main website."
        );
        setIsLoading(false);
        return;
      }

      signIn(toAuthSession(response));
      clearPendingPhone();
      navigate("/admin");
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-page auth-split">
      <div className="auth-split-form">
        <div className="auth-topbar">
          <img
            className="auth-brand-logo"
            src="/assets/branding/oncoeasy-logo-light.png"
            alt="OncoEasy"
            width={161}
            height={40}
            loading="eager"
            decoding="async"
          />
        </div>
        <Panel className="management-login-panel">
          <p className="eyebrow">OncoEasy Management</p>
          <h1>Management sign in</h1>
          <p className="intro">
            Sign in to manage your organization's pharmacy and patient-care
            operations.
          </p>
          <form className="form-stack" onSubmit={handleSubmit}>
            <Field label="Work email" htmlFor="management-email">
              <Input
                id="management-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="management-password">
              <Input
                id="management-password"
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
        </Panel>
        <p className="footer-note">Authorized management access only.</p>
      </div>
      <aside className="auth-split-visual" aria-hidden="true">
        <img
          src="/assets/auth/auth-illustration.png"
          alt=""
          width={1160}
          height={1355}
          loading="eager"
          decoding="async"
        />
      </aside>
    </main>
  );
}

function AuthLayout({
  navigate,
  eyebrow,
  title,
  description,
  backAction,
  showBack,
  children
}: {
  navigate: Navigate;
  eyebrow: string;
  title: string;
  description: string;
  backAction?: () => void;
  /** Explicitly request the homepage-fallback back control (Welcome page). */
  showBack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page auth-split">
      <div className="auth-split-form">
        <div className="auth-topbar">
          {showBack || backAction ? (
            backAction ? (
              <button type="button" className="auth-back-link" onClick={backAction}>
                <ArrowLeftIcon size={16} aria-hidden="true" />
                <span>Back</span>
              </button>
            ) : (
              <AuthBackLink navigate={navigate} fallback="/" />
            )
          ) : null}
          <img
            className="auth-brand-logo"
            src="/assets/branding/oncoeasy-logo-light.png"
            alt="OncoEasy"
            width={161}
            height={40}
            loading="eager"
            decoding="async"
          />
        </div>
        <Panel>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="intro">{description}</p>
          {children}
        </Panel>
        <p className="footer-note">OncoEasy authentication foundation</p>
      </div>
      <aside className="auth-split-visual" aria-hidden="true">
        <img
          src="/assets/auth/auth-illustration.png"
          alt=""
          width={1160}
          height={1355}
          loading="eager"
          decoding="async"
        />
      </aside>
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
    DELIVERY_AGENT: "/delivery-agent/pharmacy",
    OWNER: "/admin"
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
