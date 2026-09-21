import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, LoadingState, Panel } from "../components/ui";
import {
  chatStatuses,
  getAdminChatSession,
  listAdminChatSessions,
  type ChatSession,
  type ChatSessionStatus
} from "../chat/chat-api";

type Navigate = (path: string) => void;
type EscalatedFilter = "ALL" | "ESCALATED" | "NOT_ESCALATED";

type AdminChatQuery = {
  page: number;
  status: ChatSessionStatus | "";
  escalated: EscalatedFilter;
};

const pageSize = 10;

export function AdminChatPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize, total: 0, totalPages: 1 });
  const [selected, setSelected] = useState<ChatSession | null>(null);
  const [statusFilter, setStatusFilter] = useState<ChatSessionStatus | "">("");
  const [escalatedFilter, setEscalatedFilter] = useState<EscalatedFilter>("ALL");
  const [query, setQuery] = useState<AdminChatQuery>({ page: 1, status: "", escalated: "ALL" });
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAdminChatSessions({
      page: query.page,
      pageSize,
      status: query.status || undefined,
      escalated: query.escalated === "ALL" ? undefined : query.escalated === "ESCALATED"
    })
      .then((response) => {
        setSessions(response.items);
        setPagination(response.pagination);
        setError(null);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, [query]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function runQuery(next: AdminChatQuery): void {
    setError(null);
    setLoading(true);
    setQuery(next);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runQuery({ page: 1, status: statusFilter, escalated: escalatedFilter });
  }

  function openSession(sessionId: string): void {
    setOpening(true);
    setError(null);
    getAdminChatSession(sessionId)
      .then((session) => {
        setSelected(session);
        setSessions((current) => current.map((item) => (item.sessionId === session.sessionId ? session : item)));
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setOpening(false));
  }

  if (!user) return null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Operations admin</p>
          <h1>Chat escalations</h1>
          <p className="intro">Review conversational-router sessions and follow up on requests flagged for human support. This view is read-only.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section className="consultation-grid">
        <Panel>
          <h2>Sessions</h2>
          <form className="form-stack" onSubmit={applyFilters}>
            <Field label="Status" htmlFor="chat-admin-status">
              <select className="input" id="chat-admin-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ChatSessionStatus | "")}>
                <option value="">All statuses</option>
                {chatStatuses.map((value) => <option key={value} value={value}>{formatLabel(value)}</option>)}
              </select>
            </Field>
            <Field label="Escalation" htmlFor="chat-admin-escalated">
              <select className="input" id="chat-admin-escalated" value={escalatedFilter} onChange={(event) => setEscalatedFilter(event.target.value as EscalatedFilter)}>
                <option value="ALL">All sessions</option>
                <option value="ESCALATED">Escalated only</option>
                <option value="NOT_ESCALATED">Not escalated</option>
              </select>
            </Field>
            <Button type="submit">Apply filters</Button>
          </form>

          {loading ? (
            <LoadingState label="Loading sessions..." />
          ) : sessions.length === 0 ? (
            <p className="empty-state">No chat sessions match the current filters.</p>
          ) : (
            <div className="stack-list">
              {sessions.map((session) => (
                <button className="list-row list-row-button" type="button" key={session.sessionId} onClick={() => openSession(session.sessionId)}>
                  <div>
                    <strong>{`Patient ${session.patientId.slice(0, 8)}`}</strong>
                    <span className="muted">{formatLabel(session.intent)} • {formatDate(session.updatedAt)}</span>
                  </div>
                  <span className="status">{session.escalated ? "Escalated" : formatLabel(session.status)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="button-row">
            <Button className="button-secondary" type="button" disabled={loading || pagination.page <= 1} onClick={() => runQuery({ ...query, page: pagination.page - 1 })}>Previous</Button>
            <span className="field-hint">Page {pagination.page} of {Math.max(pagination.totalPages, 1)} • {pagination.total} session(s)</span>
            <Button className="button-secondary" type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => runQuery({ ...query, page: pagination.page + 1 })}>Next</Button>
          </div>
        </Panel>

        {opening ? <LoadingState label="Loading session..." /> : null}

        {selected ? (
          <Panel>
            <div className="detail-header">
              <div>
                <h2>Session {selected.sessionId.slice(0, 8)}</h2>
                <p className="muted">
                  Status: {formatLabel(selected.status)} • Intent: {formatLabel(selected.intent)}
                  {selected.escalated ? " • Escalated for human support" : ""}
                </p>
              </div>
              <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <div className="stack-list">
              <p className="list-row"><strong>Patient ID</strong><span>{selected.patientId}</span></p>
              <p className="list-row"><strong>Created</strong><span>{formatDate(selected.createdAt)}</span></p>
              <p className="list-row"><strong>Updated</strong><span>{formatDate(selected.updatedAt)}</span></p>
              {selected.closedAt ? <p className="list-row"><strong>Closed</strong><span>{formatDate(selected.closedAt)}</span></p> : null}
            </div>
            <div className="chat-transcript">
              {selected.messages.length === 0 ? (
                <p className="empty-state">No messages in this session.</p>
              ) : (
                selected.messages.map((message) => (
                  <div className={`chat-message chat-message-${message.sender.toLowerCase()}`} key={message.messageId}>
                    <span className="chat-sender">{formatLabel(message.sender)}</span>
                    <p>{message.content}</p>
                    {message.intent ? <span className="field-hint">Detected intent: {formatLabel(message.intent)}</span> : null}
                  </div>
                ))
              )}
            </div>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The chat sessions request could not be completed.";
}
