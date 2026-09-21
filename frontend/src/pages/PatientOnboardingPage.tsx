import { useState } from "react";

import { ApiError } from "../api/client";
import { completePatientOnboarding } from "../auth/auth-api";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";

type Navigate = (path: string) => void;

const diagnosisStages = [
  { value: "EARLY_STAGE", label: "Early stage" },
  { value: "LOCALLY_ADVANCED", label: "Locally advanced" },
  { value: "ADVANCED", label: "Advanced" },
  { value: "NOT_SURE", label: "Not sure yet" }
] as const;

export function PatientOnboardingPage({ navigate }: { navigate: Navigate }) {
  const { user, markOnboardingComplete } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [diagnosisStage, setDiagnosisStage] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (fullName.trim().length < 2 || city.trim().length < 2 || !diagnosisStage) {
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
      <div className="brand-mark">OE</div>
      <Panel>
        <p className="eyebrow">Complete your profile</p>
        <h1>Tell us a little about you</h1>
        <p className="intro">
          These details help us prepare your OncoEasy patient workspace.
        </p>
        <form className="form-stack" onSubmit={handleSubmit}>
          <Field label="Full name" htmlFor="onboarding-name">
            <Input
              id="onboarding-name"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </Field>
          <Field label="Diagnosis stage" htmlFor="onboarding-stage">
            <select
              className="input"
              id="onboarding-stage"
              value={diagnosisStage}
              onChange={(event) => setDiagnosisStage(event.target.value)}
              required
            >
              <option value="">Select a stage</option>
              {diagnosisStages.map((stage) => (
                <option key={stage.value} value={stage.value}>
                  {stage.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="City" htmlFor="onboarding-city">
            <Input
              id="onboarding-city"
              autoComplete="address-level2"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              required
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button type="submit" disabled={isLoading}>
            {isLoading ? <LoadingState label="Saving profile..." /> : "Complete profile"}
          </Button>
        </form>
      </Panel>
      <p className="footer-note">You can update these details later.</p>
    </main>
  );
}

function getOnboardingErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "We could not save your profile. Please try again.";
}
