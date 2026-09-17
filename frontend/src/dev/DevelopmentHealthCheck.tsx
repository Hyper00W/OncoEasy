import { useEffect, useState } from "react";

import { ApiError, apiClient } from "../api/client";

type HealthResponse = {
  status: string;
};

type HealthCheckState = "checking" | "connected" | "failed";

export function DevelopmentHealthCheck() {
  const [state, setState] = useState<HealthCheckState>("checking");
  const [message, setMessage] = useState("Checking backend connection...");

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<HealthResponse>("/health")
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.status === "ok") {
          setState("connected");
          setMessage("Backend connection is healthy");
          return;
        }

        setState("failed");
        setMessage("Backend returned an unexpected health response");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState("failed");
        setMessage(
          error instanceof ApiError ? error.message : "Backend connection failed"
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p role="status" data-health-check={state}>
      {message}
    </p>
  );
}