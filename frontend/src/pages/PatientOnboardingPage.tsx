import { useState } from "react";

import { ApiError } from "../api/client";
import { completePatientOnboarding } from "../auth/auth-api";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

const diagnosisStages = [
  { value: "EARLY_STAGE", label: "Early stage", hint: "Diagnosed at an early stage" },
  { value: "LOCALLY_ADVANCED", label: "Locally advanced", hint: "Spread nearby, still treatable locally" },
  { value: "ADVANCED", label: "Advanced", hint: "Spread further or metastatic" },
  { value: "NOT_SURE", label: "Not sure yet", hint: "You can pick this now and update later" }
] as const;

const STEPS = ["Your name", "Diagnosis stage", "Your city"] as const;

/**
 * Patient onboarding as a calm three-step wizard. Only the fields the backend
 * onboarding contract requires (fullName, diagnosisStage, city) are collected —
 * nothing clinical beyond the stage enum the API defines.
 */
export function PatientOnboardingPage({ navigate }: { navigate: Navigate }) {
  const { user, markOnboardingComplete } = useAuth();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState(user?.fullName && user.fullName !== "Pending onboarding" ? user.fullName : "");
  const [diagnosisStage, setDiagnosisStage] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const stepValid = [
    fullName.trim().length >= 2,
    diagnosisStage !== "",
    city.trim().length >= 2
  ];

  function goNext(): void {
    setError(null);
    if (!stepValid[step]) {
      setError(step === 1 ? "Choose the option closest to your situation." : "This field is needed to continue.");
      return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (stepValid.some((valid) => !valid)) {
      setError("Enter your full name, diagnosis stage, and city to continue.");
      return;
    }

    setIsLoading(true);
    try {
      await completePatientOnboarding({
        fullName: fullName.trim(),
        diagnosisStage,
        city: city.trim()
      });
      markOnboardingComplete();
      navigate("/patient");
    } catch (onboardingError) {
      setError(getOnboardingErrorMessage(onboardingError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <img
        className="auth-brand-logo"
        src="/assets/branding/oncoeasy-logo-light.png"
        alt="OncoEasy"
        width={161}
        height={40}
        loading="eager"
        decoding="async"
      />
      <Panel>
        <p className="eyebrow">Complete your profile</p>
        <h1>Tell us a little about you</h1>
        <p className="intro">
          These details help us prepare your OncoEasy patient workspace. It takes under a minute.
        </p>

        <ol className="onboarding-progress" aria-label="Onboarding progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={`onboarding-progress-step${index === step ? " is-current" : ""}${index < step ? " is-done" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              <span className="onboarding-progress-dot" aria-hidden="true">
                {index < step ? "✓" : index + 1}
              </span>
              <span className="onboarding-progress-label">{label}</span>
            </li>
          ))}
        </ol>

        <form className="form-stack" onSubmit={handleSubmit}>
          {step === 0 ? (
            <Field label="Full name" htmlFor="onboarding-name" hint="How our care team should address you.">
              <Input
                id="onboarding-name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoFocus
                required
              />
            </Field>
          ) : null}

          {step === 1 ? (
            <fieldset className="onboarding-choices">
              <legend>Where are you in treatment?</legend>
              <p className="field-hint">
                This helps us organise medicines and support around your stage. There are no wrong
                answers, and you can change it later.
              </p>
              <div className="onboarding-choice-list" role="radiogroup" aria-label="Diagnosis stage">
                {diagnosisStages.map((stage) => (
                  <label
                    key={stage.value}
                    className={`onboarding-choice${diagnosisStage === stage.value ? " is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="diagnosis-stage"
                      value={stage.value}
                      checked={diagnosisStage === stage.value}
                      onChange={() => {
                        setDiagnosisStage(stage.value);
                        setError(null);
                      }}
                    />
                    <span>
                      <strong>{stage.label}</strong>
                      <small>{stage.hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {step === 2 ? (
            <Field label="City" htmlFor="onboarding-city" hint="Used for delivery and clinic availability.">
              <Input
                id="onboarding-city"
                autoComplete="address-level2"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                autoFocus
                required
              />
            </Field>
          ) : null}

          {error ? <Alert>{error}</Alert> : null}

          <div className="onboarding-actions">
            {step > 0 ? (
              <Button className="button-secondary" type="button" onClick={() => setStep((current) => current - 1)}>
                Back
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <LoadingState label="Saving profile..." /> : "Complete profile"}
              </Button>
            )}
          </div>
        </form>
      </Panel>
      <p className="footer-note">You can update these details later. We never ask for medical records here.</p>
    </main>
  );
}

function getOnboardingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "We could not save your profile. Please try again.";
}
