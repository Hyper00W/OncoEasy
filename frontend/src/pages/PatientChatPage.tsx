import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, LoadingState, Panel } from "../components/ui";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
  type ChatSession
} from "../chat/chat-api";

type Navigate = (path: string) => void;

export function PatientChatPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selected, setSelected] = useState<ChatSession | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    listChatSessions()
      .then((response) => {
        if (cancelled) return;
        setSessions(response);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [selected?.messages.length]);

  function leave(): void {
    signOut();
    navigate("/");
  }

  function loadSession(sessionId: string): void {
    setOpening(true);
    setError(null);
    getChatSession(sessionId)
      .then((session) => {
        setSelected(session);
        setSessions((current) => current.map((item) => (item.sessionId === session.sessionId ? session : item)));
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setOpening(false));
  }

  function startSession(): void {
    setCreating(true);
    setError(null);
    createChatSession()
      .then((session) => {
        setSessions((current) => [session, ...current]);
        setSelected(session);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setCreating(false));
  }

  function send(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const content = messageInput.trim();
    if (!content || !selected) return;

    setSending(true);
    setError(null);
    sendChatMessage(selected.sessionId, content)
      .then((result) => {
        setSelected(result.session);
        setSessions((current) => current.map((item) => (item.sessionId === result.session.sessionId ? result.session : item)));
        setMessageInput("");
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSending(false));
  }

  function retry(): void {
    setError(null);
    setLoading(true);
    setRetryToken((current) => current + 1);
  }

  if (!user) return null;

  const closed = selected?.status === "CLOSED";
  const lastRoute = selected?.messages.length
    ? [...selected.messages].reverse().find((message) => message.sender === "ROUTER")
    : null;

  return (
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Patient support</p>
          <h1>Chat router</h1>
          <p className="intro">Ask where to find things and get pointed to the right OncoEasy section. This is not a medical service; medical requests are passed to human support.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? (
        <>
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </>
      ) : null}

      <section className="consultation-grid">
        <Panel>
          <div className="detail-header">
            <h2>Your conversations</h2>
            <Button type="button" disabled={creating} onClick={startSession}>{creating ? "Starting..." : "New conversation"}</Button>
          </div>
          {loading ? (
            <LoadingState label="Loading conversations..." />
          ) : sessions.length === 0 ? (
            <p className="empty-state">No conversations yet. Start one to find your way around OncoEasy.</p>
          ) : (
            <div className="stack-list">
              {sessions.map((session) => (
                <button className="list-row list-row-button" type="button" key={session.sessionId} onClick={() => loadSession(session.sessionId)}>
                  <div>
                    <strong>{sessionPreview(session)}</strong>
                    <span className="muted">{formatDate(session.updatedAt)} • {formatLabel(session.intent)}</span>
                  </div>
                  <span className="status">{formatLabel(session.status)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        {opening ? <LoadingState label="Loading conversation..." /> : null}

        {selected ? (
          <Panel>
            <div className="detail-header">
              <div>
                <h2>Conversation</h2>
                <p className="muted">
                  Status: {formatLabel(selected.status)} • Last intent: {formatLabel(selected.intent)}
                  {selected.escalated ? " • Flagged for human support" : ""}
                </p>
              </div>
              <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close</Button>
            </div>

            <div className="chat-transcript" ref={transcriptRef}>
              {selected.messages.length === 0 ? (
                <p className="empty-state">No messages yet. Send a message below.</p>
              ) : (
                selected.messages.map((message) => (
                  <div className={`chat-message chat-message-${message.sender.toLowerCase()}`} key={message.messageId}>
                    <span className="chat-sender">{message.sender === "PATIENT" ? "You" : "OncoEasy router"}</span>
                    <p>{message.content}</p>
                    {message.sender === "ROUTER" && message.intent ? (
                      <span className="field-hint">Detected intent: {formatLabel(message.intent)}</span>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {selected.escalated && (lastRoute?.intent ?? selected.intent) === "HUMAN_SUPPORT" ? (
              <Alert>This request needs a person. The OncoEasy team does not provide medical advice through chat; a support professional will follow up.</Alert>
            ) : null}

            <form className="form-stack" onSubmit={send}>
              <Field label="Message" htmlFor="chat-message" hint="Try asking where to book a lab test or how to find articles.">
                <textarea
                  className="input textarea"
                  id="chat-message"
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  disabled={closed || sending}
                  maxLength={2000}
                />
              </Field>
              <div className="button-row">
                <Button type="submit" disabled={closed || sending || !messageInput.trim()}>
                  {sending ? "Sending..." : "Send message"}
                </Button>
                {closed ? <span className="field-hint">This conversation is closed.</span> : null}
              </div>
            </form>
          </Panel>
        ) : null}
      </section>
    </main>
  );
}

function sessionPreview(session: ChatSession): string {
  const firstPatient = session.messages.find((message) => message.sender === "PATIENT");
  const text = (firstPatient?.content ?? "New conversation").trim().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

function formatLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The chat request could not be completed.";
}
