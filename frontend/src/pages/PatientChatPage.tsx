import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, ChatBubble, LoadingState, PageHero } from "../components/ui";
import { MessageCircleIcon } from "../components/icons";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  sendChatMessage,
  type ChatIntent,
  type ChatMessage,
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
  void leave;

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
    if (creating) return; // one session creation at a time
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
  const needsHumanFollowUp = Boolean(
    selected?.escalated && (lastRoute?.intent ?? selected?.intent) === "HUMAN_SUPPORT"
  );

  return (
    <PatientPageShell navigate={navigate} activePath="/patient/chat" className="chat-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}>
      <PageHero
        tone="blue"
        eyebrow="Patient support"
        title="How can we help you today?"
        description="Ask where to find things and get pointed to the right OncoEasy section. This is not a medical service; medical requests are passed to human support."
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Chat support" }
        ]}
        action={
          <Button type="button" disabled={creating} onClick={startSession}>
            {creating ? "Starting..." : "Start a new conversation"}
          </Button>
        }
      />

      {error ? (
        <div className="chat-window-alert">
          <Alert>{error}</Alert>
          <Button type="button" onClick={retry}>Retry</Button>
        </div>
      ) : null}

      <section className="chat-layout" aria-label="Support chat">
        <aside className="chat-sessions-panel">
          <div className="detail-header">
            <h2>Your conversations</h2>
          </div>
          {loading ? (
            <LoadingState label="Loading conversations..." />
          ) : sessions.length === 0 ? (
            <EmptySessions />
          ) : (
            <div className="stack-list">
              {sessions.map((session) => (
                <button
                  className={`list-row list-row-button${selected?.sessionId === session.sessionId ? " is-selected" : ""}`}
                  type="button"
                  key={session.sessionId}
                  onClick={() => loadSession(session.sessionId)}
                >
                  <div>
                    <strong>{sessionPreview(session)}</strong>
                    <span className="muted">{formatDate(session.updatedAt)} • {formatLabel(session.intent)}</span>
                  </div>
                  <span className="status">{formatLabel(session.status)}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="chat-window" aria-live="polite">
          {opening ? <LoadingState label="Loading conversation..." /> : null}

          {selected ? (
            <>
              <div className="chat-window-head">
                <div>
                  <p className="eyebrow">Conversation</p>
                  <h2>{sessionPreview(selected) || "Support conversation"}</h2>
                  <p className="muted">
                    Status: {formatLabel(selected.status)} • Last intent: {formatLabel(selected.intent)}
                    {selected.escalated ? " • Flagged for human support" : ""}
                  </p>
                </div>
                <Button className="button-secondary" type="button" onClick={() => setSelected(null)}>Close</Button>
              </div>

              <div className="chat-window-messages" ref={transcriptRef}>
                {selected.messages.length === 0 ? (
                  <div className="chat-window-empty">
                    <p className="empty-state">No messages yet. Send a message below to start the conversation.</p>
                  </div>
                ) : (
                  selected.messages.map((message) => (
                    <MessageRow message={message} key={message.messageId} />
                  ))
                )}
              </div>

              {needsHumanFollowUp ? (
                <div className="chat-window-alert">
                  <Alert>This request needs a person. The OncoEasy team does not provide medical advice through chat; a support professional will follow up.</Alert>
                </div>
              ) : null}

              <form className="chat-window-input-area" onSubmit={send}>
                <textarea
                  className="input textarea"
                  id="chat-message"
                  aria-label="Message"
                  placeholder="Type your message…"
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  disabled={closed || sending}
                  maxLength={2000}
                />
                <Button type="submit" disabled={closed || sending || !messageInput.trim()}>
                  {sending ? "Sending..." : "Send message"}
                </Button>
                {closed ? <span className="field-hint">This conversation is closed.</span> : null}
              </form>
              <p className="field-hint chat-window-footnote">
                The support router helps you navigate OncoEasy. It does not provide medical advice, and it never replaces your care team.
              </p>
            </>
          ) : (
            <div className="chat-window-empty">
              <p className="empty-state">
                Select a conversation on the left, or start a new one — the router will point you to the right section of OncoEasy.
              </p>
            </div>
          )}
        </div>
      </section>
    </PatientPageShell>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isPatient = message.sender === "PATIENT";
  const intentNote = !isPatient && message.intent ? formatLabel(message.intent) : null;

  return (
    <div className={`chat-msg-row chat-msg-row-${message.sender.toLowerCase()}`}>
      <ChatBubble
        sender={isPatient ? "patient" : "support"}
        senderLabel={isPatient ? "You" : "OncoEasy router"}
        text={message.content}
        time={formatTime(message.createdAt)}
      />
      {intentNote ? <span className="field-hint">Detected intent: {intentNote}</span> : null}
    </div>
  );
}

function EmptySessions() {
  return (
    <div className="empty-state-block" role="status">
      <span className="empty-state-icon" aria-hidden="true">
        <MessageCircleIcon size={22} />
      </span>
      <p className="empty-state-title">No conversations yet</p>
      <p className="empty-state-hint">Start one and the router will point you to the right section of OncoEasy.</p>
    </div>
  );
}

function sessionPreview(session: ChatSession): string {
  const firstPatient = session.messages.find((message) => message.sender === "PATIENT");
  const text = (firstPatient?.content ?? "New conversation").trim().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

const INTENT_LABELS: Record<ChatIntent, string> = {
  PHARMACY: "Pharmacy",
  DOCTOR_CONSULT: "Doctor consult",
  LABS: "Lab tests",
  PAP: "Patient assistance",
  CARE_JOURNEY: "Care journey",
  KNOWLEDGE: "Knowledge",
  CLINICAL_TRIALS: "Clinical trials",
  HUMAN_SUPPORT: "Human support",
  GENERAL: "General"
};

function formatLabel(value: string): string {
  return INTENT_LABELS[value as ChatIntent] ?? formatEnumLabel(value);
}

function formatEnumLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The chat request could not be completed.";
}
