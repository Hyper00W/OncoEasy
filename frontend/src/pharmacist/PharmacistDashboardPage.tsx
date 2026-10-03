import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { StatusChip } from "../components/StatusChip";
import { Alert, Button, ErrorState, Field, Input, LoadingState } from "../components/ui";
import type { Navigate } from "../components/navigation-types";
import { ArrowRightIcon, ClipboardCheckIcon, PackageIcon } from "../components/icons";
import { formatDateTime } from "../components/status-utils";
import {
  assignDelivery,
  importProducts,
  listImports,
  listReviewQueue,
  type ImportJob
} from "../pharmacy/pharmacy-api";
import { ApiError } from "../api/client";
import {
  loadPharmacistWorkspace,
  type PharmacistWorkspaceData
} from "./pharmacist-dashboard";
import { PharmacistPortalShell } from "./PharmacistPortalShell";

type Tab = "overview" | "verification";

/**
 * Pharmacy fulfillment control center. The PHARMACIST role is authorized to
 * read exactly one operational queue — prescription verification — so the
 * workflow rail shows that stage with real counts and marks the downstream
 * stages as handled by operations rather than inventing numbers. The existing
 * operations tools (product Excel import, local delivery assignment) keep
 * working unchanged.
 */
export function PharmacistDashboardPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  const initialTab: Tab = requestedTab === "verification" ? "verification" : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<PharmacistWorkspaceData | null>(null);
  const [nowStamp, setNowStamp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPharmacistWorkspace()
      .then((workspace) => {
        if (!cancelled) {
          setData(workspace);
          setNowStamp(Date.now());
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(describeError(requestError, "The workspace could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <PharmacistPortalShell navigate={navigate} activePath={`/pharmacist${tab === "overview" ? "" : "?tab=verification"}`}>
      {error && !data ? (
        <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} />
      ) : !data ? (
        <PortalSkeleton />
      ) : (
        <div className="portal-sections">
          <PharmacyHero user={user} count={data.reviewQueue.length} />

          <nav className="pharmacy-tabs" aria-label="Pharmacist sections">
            {(["overview", "verification"] as Tab[]).map((value) => (
              <button
                className={tab === value ? "tab-active" : ""}
                key={value}
                type="button"
                onClick={() => setTab(value)}
              >
                {value === "overview"
                  ? "Overview"
                  : `Verification${` (${data.reviewQueue.length})`}`}
              </button>
            ))}
          </nav>

          {tab === "overview" ? (
            <OverviewSection
              data={data}
              nowStamp={nowStamp}
              onOpenVerification={() => setTab("verification")}
              onReload={() => setReloadToken((token) => token + 1)}
            />
          ) : null}

          {tab === "verification" ? <VerificationInline onReload={() => setReloadToken((token) => token + 1)} /> : null}
        </div>
      )}
    </PharmacistPortalShell>
  );
}

function PharmacyHero({ user, count }: { user: { fullName?: string } | null; count: number }) {
  const firstName = user?.fullName?.split(" ")[0] ?? null;
  return (
    <section className="ops-command-hero" aria-label="Pharmacy fulfillment">
      <p className="ops-hero-eyebrow">OncoEasy Pharmacy Fulfillment</p>
      <h2>
        {firstName ? `${firstName}, your counter is ` : "Your counter is "}
        {count > 0 ? "holding prescriptions for review." : "clear — no prescriptions waiting."}
      </h2>
      {count > 0 ? (
        <p>
          {count} prescription{count === 1 ? "" : "s"} awaiting verification. Verification unlocks
          patient checkout, so it always comes first.
        </p>
      ) : (
        <p>
          When patients upload prescriptions they appear here for verification before any order can
          move.
        </p>
      )}
    </section>
  );
}

function OverviewSection({
  data,
  nowStamp,
  onOpenVerification,
  onReload
}: {
  data: PharmacistWorkspaceData;
  /** Captured when the workspace loads — keeps render pure. */
  nowStamp: number | null;
  onOpenVerification: () => void;
  onReload: () => void;
}) {
  const pending = data.reviewQueue.length;
  const oldestFirst = [...data.reviewQueue].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const waiting = oldestFirst[0];
  const waitingHours =
    waiting !== undefined && nowStamp !== null
      ? Math.max(0, Math.round((nowStamp - new Date(waiting.createdAt).getTime()) / 3_600_000))
      : 0;

  return (
    <>
      {/* Workflow rail: the one stage this role owns is real and hot; the
          downstream stages belong to operations (OPS_ADMIN) and are labeled
          honestly rather than given invented counts. */}
      <section className="ops-flow" aria-label="Fulfillment workflow">
        <button
          className={`ops-stage${pending > 0 ? " is-hot" : " is-idle"}`}
          type="button"
          onClick={onOpenVerification}
          style={{ animationDelay: "0ms" }}
        >
          <span className="ops-stage-step">Stage 1</span>
          <span className="ops-stage-value">{pending}</span>
          <span className="ops-stage-label">Awaiting verification</span>
        </button>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 2</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Approved for checkout</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 3</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Ready to pack</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 4</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Dispatched</span>
        </div>
        <div className="ops-stage is-idle">
          <span className="ops-stage-step">Stage 5</span>
          <span className="ops-stage-value">—</span>
          <span className="ops-stage-label">Delivered</span>
        </div>
      </section>

      {pending > 0 ? (
        <p className="ops-flow-note">
          Stages 2–5 run in the operations console (OPS_ADMIN) once verification clears — this
          workspace stays focused on the queue your role owns.
        </p>
      ) : null}

      <div className="ops-zone-title">
        <h2>Verification queue</h2>
        <button className="link-button" type="button" onClick={onOpenVerification}>
          Open queue →
        </button>
      </div>
      <section className="ops-card" aria-label="Verification queue">
        {pending === 0 ? (
          <div className="ops-empty" role="status">
            <p>The queue is clear. No prescriptions are pending review right now.</p>
            <button className="link-button" type="button" onClick={onOpenVerification}>
              Open the verification view
            </button>
          </div>
        ) : (
          <>
            <div className="ops-card-head">
              <h2>
                <span className="ops-card-icon" aria-hidden="true"><ClipboardCheckIcon size={16} /></span>
                Oldest waiting first
                <span className="ops-card-kicker">
                  {waitingHours > 0
                    ? `longest waiting ${waitingHours}h`
                    : "everything arrived recently"}
                </span>
              </h2>
            </div>
            <ul className="ops-list">
              {oldestFirst.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <span className="ops-list-title">
                    {item.documentName}
                    <span className="ops-list-meta">Uploaded {formatDateTime(item.createdAt)}</span>
                  </span>
                  <StatusChip status={item.status} />
                </li>
              ))}
            </ul>
            {pending > 5 ? (
              <p className="ops-card-sub" style={{ marginBottom: 0, marginTop: 12 }}>
                And {pending - 5} more in the queue.
              </p>
            ) : null}
          </>
        )}
      </section>

      <OperationsPanel onReload={onReload} />
    </>
  );
}

/**
 * Preserves the existing pharmacist operations tools: product Excel import
 * and local delivery assignment (Phase 1.7.13 / 1.7.14 endpoints).
 */
function OperationsPanel({ onReload }: { onReload: () => void }) {
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [deliveryId, setDeliveryId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignNotice, setAssignNotice] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  function loadImports(): void {
    listImports()
      .then((response) => setImports(response.items))
      .catch(() => undefined);
  }

  useEffect(() => {
    loadImports();
  }, []);

  function upload(event: React.FormEvent): void {
    event.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setImportError(null);
    importProducts(file)
      .then((result) => {
        setImportNotice(
          `Import ${formatStatusLabelSafe(result.status)}: ${result.createdProducts} created, ${result.updatedProducts} updated, ${result.invalidRows} invalid.`
        );
        setFile(null);
        loadImports();
        onReload();
      })
      .catch((requestError: unknown) => setImportError(describeError(requestError, "The import failed.")))
      .finally(() => setUploading(false));
  }

  function assign(): void {
    if (assigning) return;
    setAssigning(true);
    setAssignError(null);
    assignDelivery(deliveryId.trim(), agentId.trim())
      .then(() => {
        setAssignNotice("Delivery assigned to the agent.");
        setDeliveryId("");
        setAgentId("");
      })
      .catch((requestError: unknown) => setAssignError(describeError(requestError, "The delivery could not be assigned.")))
      .finally(() => setAssigning(false));
  }

  return (
    <>
      <div className="ops-zone-title">
        <h2>Counter operations</h2>
      </div>
      <div className="portal-columns">
        <section className="ops-card" aria-label="Product Excel import">
          <div className="ops-card-head">
            <h2>
              <span className="ops-card-icon" aria-hidden="true"><PackageIcon size={16} /></span>
              Product Excel import
            </h2>
          </div>
          <form className="form-stack" onSubmit={upload}>
            <Field label="XLSX file" htmlFor="product-import">
              <Input
                id="product-import"
                type="file"
                accept=".xlsx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </Field>
            {importNotice ? <div className="success-message" role="status">{importNotice}</div> : null}
            {importError ? <Alert>{importError}</Alert> : null}
            <Button type="submit" disabled={!file || uploading}>
              {uploading ? <LoadingState label="Importing..." /> : "Import products"}
            </Button>
          </form>
          <h3 className="section-heading">Import history</h3>
          {imports.length === 0 ? (
            <p className="ops-empty">No imports yet.</p>
          ) : (
            <ul className="ops-list">
              {imports.slice(0, 5).map((item) => (
                <li key={item.importJobId}>
                  <span className="ops-list-title">
                    {item.fileName || "Unnamed file"}
                    <span className="ops-list-meta">
                      {item.createdProducts} created • {item.updatedProducts} updated
                    </span>
                  </span>
                  <StatusChip status={item.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ops-card" aria-label="Assign local delivery">
          <div className="ops-card-head">
            <h2>
              <span className="ops-card-icon" aria-hidden="true"><ArrowRightIcon size={16} /></span>
              Assign local delivery
            </h2>
          </div>
          <p className="ops-card-sub">
            Use the delivery ID and active delivery-agent user ID from the backend workflow.
          </p>
          <div className="form-stack">
            <Field label="Delivery ID" htmlFor="delivery-id">
              <Input id="delivery-id" value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} autoComplete="off" />
            </Field>
            <Field label="Agent user ID" htmlFor="agent-id">
              <Input id="agent-id" value={agentId} onChange={(event) => setAgentId(event.target.value)} autoComplete="off" />
            </Field>
            {assignNotice ? <div className="success-message" role="status">{assignNotice}</div> : null}
            {assignError ? <Alert>{assignError}</Alert> : null}
            <Button type="button" disabled={!deliveryId.trim() || !agentId.trim() || assigning} onClick={assign}>
              {assigning ? <LoadingState label="Assigning..." /> : "Assign delivery"}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

/**
 * Verification queue tab: same data source as the overview with a link into
 * the full review workflow (secure document, approve/query/reject).
 */
function VerificationInline({ onReload }: { onReload: () => void }) {
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof listReviewQueue>>["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReviewQueue()
      .then((response) => {
        if (!cancelled) {
          setQueue(response.items);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(describeError(requestError, "The verification queue could not be loaded."));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onReload]);

  return (
    <section className="ops-card" aria-label="Verification queue">
      <div className="ops-card-head">
        <h2>
          Awaiting verification
          {queue.length > 0 ? <span className="dash-count">{queue.length}</span> : null}
        </h2>
      </div>
      {loading ? (
        <LoadingState label="Loading queue..." />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : queue.length === 0 ? (
        <div className="ops-empty" role="status">
          <p>The queue is clear. No prescriptions pending review.</p>
        </div>
      ) : (
        <ul className="ops-list">
          {queue.map((item) => (
            <li key={item.id}>
              <span className="ops-list-title">
                {item.documentName}
                <span className="ops-list-meta">
                  Patient {item.patientId?.slice(0, 8)} • uploaded {formatDateTime(item.createdAt)}
                </span>
              </span>
              <StatusChip status={item.status} />
            </li>
          ))}
        </ul>
      )}
      <p className="ops-card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        Open the full verification view to review documents and approve, query, or reject.
      </p>
    </section>
  );
}

function PortalSkeleton() {
  return (
    <div className="portal-sections" aria-hidden="true">
      <div className="skeleton skeleton-hero" />
      <div className="ops-flow">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="ops-stage" key={index}>
            <span className="skeleton skeleton-text" style={{ width: "45%" }} />
            <span className="skeleton skeleton-text" style={{ width: "35%", height: 30 }} />
            <span className="skeleton skeleton-text" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
      <div className="skeleton skeleton-card" />
    </div>
  );
}

function formatStatusLabelSafe(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
