import { useEffect, useRef, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getPatientDashboard } from "../dashboard/dashboard-api";
import type { PatientDashboard } from "../dashboard/dashboard-api";
import { getJourney } from "../journey/journey-api";
import type { PatientJourney } from "../journey/journey-api";
import { listPublishedArticles } from "../knowledge/knowledge-api";
import type { KnowledgeArticleSummary } from "../knowledge/knowledge-api";
import { listPublicTestimonials } from "../testimonials/testimonials-api";
import type { PublicTestimonial } from "../testimonials/testimonials-api";
import { PatientPageShell } from "../shell/PatientPageShell";
import type { Navigate } from "../components/navigation-types";
import { StatusChip } from "../components/StatusChip";
import {
  formatDate,
  formatDateTime,
  formatStatusLabel
} from "../components/status-utils";
import { Button, LoadingState } from "../components/ui";
import { CTASection, MetricGrid, ServiceCard, StatCard } from "../components/compositions";
import { Reveal } from "../motion/motion";
import {
  ArrowRightIcon,
  BookIcon,
  CartIcon,
  FlaskIcon,
  JourneyIcon,
  MessageCircleIcon,
  PillIcon,
  ShieldHeartIcon,
  StethoscopeIcon,
  SupportIcon,
  UploadIcon,
  UsersIcon
} from "../components/icons";

const DASHBOARD_PATH = "/patient";

/**
 * Patient Care Command Center (Phase 7).
 *
 * Same data contract as before — the real dashboard aggregator
 * (GET /api/v1/patient/dashboard) plus three lightweight secondary reads
 * (journey stage, knowledge articles, public stories) that load lazily and
 * never block the primary content. Each section still fails independently.
 *
 * What changed is the hierarchy: instead of a uniform grid of equal cards,
 * the page now answers, in order — where do I stand, what do I do next, what
 * is happening with my care, and where do I get help.
 */
export function PatientDashboardPage({ navigate }: { navigate: Navigate }) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<PatientDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPatientDashboard()
      .then((response) => {
        if (!cancelled) {
          setDashboard(response);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getDashboardErrorMessage(requestError));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (error && !dashboard) {
    return (
      <PatientPageShell navigate={navigate} activePath={DASHBOARD_PATH} width="narrow" className="dashboard-page">
        <div className="error-state">
          <p>{error}</p>
          <Button
            type="button"
            onClick={() => {
              setError(null);
              setReloadToken((current) => current + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </PatientPageShell>
    );
  }

  return (
    <PatientPageShell navigate={navigate} activePath={DASHBOARD_PATH} width="narrow" className="dashboard-page">
      <div className="care-center">
        <CareBanner dashboard={dashboard} name={user?.fullName} />

        {!dashboard ? (
          <DashboardSkeleton />
        ) : (
          <>
            <NextStepFocus dashboard={dashboard} navigate={navigate} />
            <CareStatusStrip dashboard={dashboard} />
            <JourneyProgressPanel navigate={navigate} />

            <section className="care-section" aria-labelledby="care-activity-heading">
              <Reveal className="care-section-head">
                <h2 id="care-activity-heading">Happening with your care</h2>
                <p>Appointments, medicines, referrals, labs and assistance in one place.</p>
              </Reveal>

              <div className="care-grid">
                <AppointmentPanel dashboard={dashboard} navigate={navigate} />
                <OrdersPanel dashboard={dashboard} navigate={navigate} />
                <ReferralPanel dashboard={dashboard} navigate={navigate} />
                <LabsPanel dashboard={dashboard} navigate={navigate} />
                <PapPanel dashboard={dashboard} navigate={navigate} />
              </div>
            </section>

            <section className="care-section" aria-labelledby="quick-actions-heading">
              <Reveal className="care-section-head">
                <h2 id="quick-actions-heading">What would you like to do?</h2>
                <p>Every action below opens a live part of your workspace.</p>
              </Reveal>
              <div className="care-quick-grid">
                {QUICK_ACTIONS.map((action, index) => (
                  <ServiceCard
                    key={action.label}
                    icon={<action.Icon size={20} />}
                    tone={action.tone}
                    title={action.label}
                    description={action.description}
                    onClick={() => navigate(action.path)}
                    index={index}
                    emphasised={action.emphasised}
                  />
                ))}
              </div>
            </section>

            <ResourcesRow navigate={navigate} />

            <CTASection
              tone="teal"
              eyebrow="Care support"
              title="Not sure what a status means?"
              description="Our care desk can walk you through an order, a booking, or a document request — without giving clinical advice."
              primaryAction={
                <Button type="button" onClick={() => navigate("/patient/chat")}>
                  <MessageCircleIcon size={16} /> Open care chat
                </Button>
              }
              secondaryAction={
                <Button className="button-secondary" type="button" onClick={() => navigate("/patient/knowledge")}>
                  Read the knowledge bank
                </Button>
              }
            />
          </>
        )}
      </div>
    </PatientPageShell>
  );
}

/* ---------- 1. Welcome / care status ---------- */

function CareBanner({
  dashboard,
  name
}: {
  dashboard: PatientDashboard | null;
  name: string | undefined;
}) {
  const needsSetup = Boolean(dashboard?.nextStep);
  const openItems = dashboard
    ? dashboard.activeOrders.length + dashboard.labTests.length + (dashboard.papStatus ? 1 : 0)
    : 0;

  return (
    <Reveal as="header" className="care-center-banner">
      <div>
        <p className="care-center-banner-eyebrow">Your care workspace</p>
        <h1>{dashboard ? (needsSetup ? "Let's finish setting up" : greetingLine(name)) : "Welcome back"}</h1>
        <p>
          {dashboard
            ? needsSetup
              ? "One quick step and your workspace is ready to support your treatment."
              : "Here's exactly where your care stands today, and what needs you next."
            : "Loading your care overview…"}
        </p>
      </div>

      <div className="care-center-status">
        <p className="care-center-status-label">Today</p>
        <p className="care-center-status-value">
          {dashboard ? (openItems > 0 ? `${openItems} open item${openItems === 1 ? "" : "s"}` : "All clear") : "—"}
        </p>
        <p className="care-center-status-note">
          {dashboard
            ? openItems > 0
              ? "Nothing here is an emergency — review each item at your pace."
              : "No pending orders, bookings, or applications."
            : "Fetching your latest status."}
        </p>
      </div>
    </Reveal>
  );
}

/* ---------- 2. The one dominant next step ---------- */

function NextStepFocus({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  if (dashboard.nextStep) {
    return (
      <Reveal as="section" className="care-focus" aria-label="Your next step" variant="scale">
        <div>
          <p className="care-focus-eyebrow">Next step</p>
          <h2>{dashboard.nextStep.label}</h2>
          <p>Add your name, stage, and city so medicines, consultations, and support line up correctly.</p>
        </div>
        <div className="care-focus-actions">
          <Button type="button" onClick={() => navigate("/patient/onboarding")}>
            Complete profile <ArrowRightIcon size={16} />
          </Button>
        </div>
      </Reveal>
    );
  }

  const appointment = dashboard.upcomingAppointment;
  const pendingOrder = dashboard.activeOrders[0];
  const needsOrderAction =
    pendingOrder && ["PENDING_PAYMENT", "PENDING_PRESCRIPTION", "PENDING_PHARMACIST_REVIEW"].includes(pendingOrder.status);

  if (needsOrderAction) {
    return (
      <Reveal as="section" className="care-focus" aria-label="Your next step" variant="scale">
        <div>
          <p className="care-focus-eyebrow">Action needed</p>
          <h2>Your order needs attention</h2>
          <p>
            {formatStatusLabel(pendingOrder.status)} — {pendingOrder.itemCount} item
            {pendingOrder.itemCount === 1 ? "" : "s"}.{" "}
            {pendingOrder.status === "PENDING_PAYMENT"
              ? "Complete payment to move it forward."
              : "Your prescription is being reviewed by our pharmacy team."}
          </p>
        </div>
        <div className="care-focus-actions">
          <Button type="button" onClick={() => navigate("/patient/pharmacy?tab=orders")}>
            Review order <ArrowRightIcon size={16} />
          </Button>
        </div>
      </Reveal>
    );
  }

  if (appointment) {
    return (
      <Reveal as="section" className="care-focus" aria-label="Your next step" variant="scale">
        <div>
          <p className="care-focus-eyebrow">Upcoming appointment</p>
          <h2>
            {appointment.consultationType === "PHONE" ? "Phone consultation" : "In-clinic visit"} with{" "}
            {appointment.doctorName ?? "your doctor"}
          </h2>
          <p>
            {formatDateTime(appointment.scheduledAt)} • {formatStatusLabel(appointment.status)}
          </p>
        </div>
        <div className="care-focus-actions">
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/consultations")}>
            View appointment
          </Button>
        </div>
      </Reveal>
    );
  }

  return (
    <Reveal as="section" className="care-focus is-quiet" aria-label="Your next step" variant="scale">
      <div>
        <p className="care-focus-eyebrow">Today</p>
        <h2>Nothing needs your attention</h2>
        <p>No appointments or pending orders right now. Explore your workspace below.</p>
      </div>
    </Reveal>
  );
}

/* ---------- 3. Care status at a glance ---------- */

function CareStatusStrip({ dashboard }: { dashboard: PatientDashboard }) {
  return (
    <section className="care-section" aria-labelledby="care-status-heading">
      <Reveal className="care-section-head">
        <h2 id="care-status-heading">Care status</h2>
        <p>Live counts from your orders, bookings and applications.</p>
      </Reveal>

      <MetricGrid>
        <StatCard
          index={0}
          label="Active orders"
          value={dashboard.activeOrders.length}
          hint={
            dashboard.activeOrders.length > 0
              ? "Medicines moving through payment, review or delivery."
              : "No medicine orders in progress."
          }
          icon={<PillIcon size={16} />}
          tone="brand"
        />
        <StatCard
          index={1}
          label="Lab bookings"
          value={dashboard.labTests.length}
          hint={
            dashboard.labTests.length > 0 ? "Tests requested or in progress." : "No lab tests booked yet."
          }
          icon={<FlaskIcon size={16} />}
          tone="blue"
        />
        <StatCard
          index={2}
          label="Referral"
          value={dashboard.referral ? formatStatusLabel(dashboard.referral.status) : "None"}
          hint={dashboard.referral ? `Shared ${formatDate(dashboard.referral.createdAt)}` : "No referral on file yet."}
          icon={<UsersIcon size={16} />}
          tone="teal"
        />
        <StatCard
          index={3}
          label="Assistance"
          value={dashboard.papStatus ? formatStatusLabel(dashboard.papStatus.status) : "Not applied"}
          hint={dashboard.papStatus ? dashboard.papStatus.programName : "Support programs can help with treatment cost."}
          icon={<ShieldHeartIcon size={16} />}
          tone="amber"
        />
      </MetricGrid>
    </section>
  );
}

/* ---------- 4. Journey progress ---------- */

function JourneyProgressPanel({ navigate }: { navigate: Navigate }) {
  const [journey, setJourney] = useState<PatientJourney | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    getJourney()
      .then((data) => {
        if (!cancelled) {
          setJourney(data);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentIndex = journey?.currentStageKey
    ? journey.stages.findIndex((stage) => stage.stage === journey.currentStageKey)
    : -1;

  return (
    <Reveal as="section" className="care-panel is-wide" aria-label="Care journey progress">
      <div className="care-panel-head">
        <h3>
          <JourneyIcon size={16} /> Care journey
        </h3>
        <button className="link-button" type="button" onClick={() => navigate("/patient/journey")}>
          Open care journey
        </button>
      </div>

      {state === "loading" ? (
        <LoadingState label="Loading your journey…" />
      ) : state === "error" ? (
        <p className="care-panel-secondary">Your journey couldn't be loaded right now.</p>
      ) : journey?.currentStage && currentIndex >= 0 ? (
        <>
          <p className="care-panel-primary">You're in {journey.currentStage.title}</p>
          <ol className="care-mini-stepper" aria-label="Journey stages completed so far">
            {journey.stages.map((stage, index) => {
              const isCurrent = index === currentIndex;
              const isDone = index < currentIndex;
              return (
                <li
                  key={stage.stage}
                  className={`care-mini-step${isDone ? " is-done" : ""}${isCurrent ? " is-current" : ""}`}
                >
                  <span className="care-mini-step-dot" aria-hidden="true">
                    {isDone ? "✓" : stage.order}
                  </span>
                  {stage.title}
                </li>
              );
            })}
          </ol>
          <p className="care-panel-secondary">{journey.currentStage.description}</p>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>Your care journey hasn't started yet. Set your current stage to see guidance for it.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/journey")}>
            Set your stage
          </Button>
        </div>
      )}
    </Reveal>
  );
}

/* ---------- 5–6. Care activity panels ---------- */

function AppointmentPanel({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  const appointment = dashboard.upcomingAppointment;
  return (
    <Reveal as="section" className="care-panel" aria-label="Upcoming appointment">
      <div className="care-panel-head">
        <h3>
          <StethoscopeIcon size={16} /> Upcoming appointment
        </h3>
      </div>
      {appointment ? (
        <>
          <p className="care-panel-primary">{appointment.doctorName ?? "Doctor to be confirmed"}</p>
          <p className="care-panel-secondary">
            {formatDateTime(appointment.scheduledAt)} •{" "}
            {appointment.consultationType === "PHONE" ? "Phone" : "In-clinic"} •{" "}
            <StatusChip status={appointment.status} />
          </p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/consultations")}>
            Manage appointment
          </Button>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>No upcoming appointments.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/consultations")}>
            Book a consultation
          </Button>
        </div>
      )}
    </Reveal>
  );
}

function OrdersPanel({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  return (
    <Reveal as="section" className="care-panel" aria-label="Active orders">
      <div className="care-panel-head">
        <h3>
          <CartIcon size={16} /> Active orders
        </h3>
      </div>
      {dashboard.activeOrders.length > 0 ? (
        <>
          <ul className="care-row-list">
            {dashboard.activeOrders.slice(0, 3).map((order) => (
              <li key={order.orderId}>
                <button
                  type="button"
                  className="care-row"
                  onClick={() => navigate("/patient/pharmacy?tab=orders")}
                >
                  <span className="care-row-main">
                    <span className="care-row-title">
                      {order.itemCount} item{order.itemCount === 1 ? "" : "s"} • {order.currency}{" "}
                      {order.totalAmount}
                    </span>
                    <span className="care-row-sub">{formatStatusLabel(order.status)}</span>
                  </span>
                  <StatusChip status={order.status} />
                </button>
              </li>
            ))}
          </ul>
          <Button
            className="button-secondary"
            type="button"
            onClick={() => navigate("/patient/pharmacy?tab=orders")}
          >
            View all orders
          </Button>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>No active orders.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/pharmacy")}>
            Browse medicines
          </Button>
        </div>
      )}
    </Reveal>
  );
}

function ReferralPanel({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  const referral = dashboard.referral;
  return (
    <Reveal as="section" className="care-panel is-third" aria-label="Doctor referral">
      <div className="care-panel-head">
        <h3>
          <UsersIcon size={16} /> Doctor referral
        </h3>
      </div>
      {referral ? (
        <>
          <p className="care-panel-primary">
            <StatusChip status={referral.status} />
          </p>
          <p className="care-panel-secondary">Shared {formatDate(referral.createdAt)} by your care team.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/referral")}>
            Open referral
          </Button>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>No referrals yet. When your doctor shares one, it appears here.</p>
          <button className="link-button" type="button" onClick={() => navigate("/patient/referral")}>
            Have a referral code?
          </button>
        </div>
      )}
    </Reveal>
  );
}

function LabsPanel({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  return (
    <Reveal as="section" className="care-panel is-third" aria-label="Lab tests">
      <div className="care-panel-head">
        <h3>
          <FlaskIcon size={16} /> Lab tests
        </h3>
      </div>
      {dashboard.labTests.length > 0 ? (
        <>
          <ul className="care-row-list">
            {dashboard.labTests.slice(0, 3).map((test) => (
              <li key={test.bookingId}>
                <button type="button" className="care-row" onClick={() => navigate("/patient/labs")}>
                  <span className="care-row-main">
                    <span className="care-row-title">{test.name}</span>
                    <span className="care-row-sub">{formatDate(test.preferredDate)}</span>
                  </span>
                  <StatusChip status={test.status} />
                </button>
              </li>
            ))}
          </ul>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/labs")}>
            View all bookings
          </Button>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>No lab bookings yet.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/labs")}>
            Request a test
          </Button>
        </div>
      )}
    </Reveal>
  );
}

function PapPanel({ dashboard, navigate }: { dashboard: PatientDashboard; navigate: Navigate }) {
  const pap = dashboard.papStatus;
  return (
    <Reveal as="section" className="care-panel is-third" aria-label="Patient assistance">
      <div className="care-panel-head">
        <h3>
          <ShieldHeartIcon size={16} /> Patient assistance
        </h3>
      </div>
      {pap ? (
        <>
          <p className="care-panel-primary">{pap.programName}</p>
          <p className="care-panel-secondary">
            <StatusChip status={pap.status} /> • updated {formatDate(pap.updatedAt)}
          </p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/pap")}>
            Open application
          </Button>
        </>
      ) : (
        <div className="care-panel-empty">
          <p>No assistance applications yet. Programs can help cover treatment costs.</p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/pap")}>
            Explore programs
          </Button>
        </div>
      )}
    </Reveal>
  );
}

/* ---------- 7. Resources ---------- */

function ResourcesRow({ navigate }: { navigate: Navigate }) {
  const [articles, setArticles] = useState<KnowledgeArticleSummary[] | null>(null);
  const [stories, setStories] = useState<PublicTestimonial[] | null>(null);
  const requestToken = useRef(0);

  useEffect(() => {
    const token = ++requestToken.current;
    listPublishedArticles({ page: 1, pageSize: 3 })
      .then((response) => {
        if (requestToken.current === token) setArticles(response.items);
      })
      .catch(() => undefined);
    listPublicTestimonials({ page: 1, pageSize: 2 })
      .then((response) => {
        if (requestToken.current === token) setStories(response.items);
      })
      .catch(() => undefined);
  }, []);

  return (
    <section className="care-section" aria-labelledby="care-resources-heading">
      <Reveal className="care-section-head">
        <h2 id="care-resources-heading">Resources and research</h2>
        <p>Published articles, open trial listings, and stories from other patients.</p>
      </Reveal>

      <div className="care-resource-grid">
        <Reveal as="div" className="care-resource">
          <h3>
            <BookIcon size={16} /> Latest articles
          </h3>
          {articles === null ? (
            <LoadingState label="Loading articles…" />
          ) : articles.length === 0 ? (
            <p className="care-panel-secondary">No articles published yet.</p>
          ) : (
            <div>
              {articles.map((article) => (
                <button
                  key={article.articleId}
                  type="button"
                  className="care-resource-link"
                  onClick={() => navigate("/patient/knowledge")}
                >
                  <span>{article.title}</span>
                  <small>{formatStatusLabel(article.category)}</small>
                </button>
              ))}
            </div>
          )}
          <button className="link-button" type="button" onClick={() => navigate("/patient/knowledge")}>
            Explore knowledge bank
          </button>
        </Reveal>

        <Reveal as="div" className="care-resource" delay={70}>
          <h3>
            <FlaskIcon size={16} /> Clinical trials
          </h3>
          <p className="care-panel-secondary">
            Browse published trial listings. You can register interest in any trial — eligibility is always
            confirmed by the trial team, not by OncoEasy.
          </p>
          <Button className="button-secondary" type="button" onClick={() => navigate("/patient/trials")}>
            Browse trials
          </Button>
        </Reveal>

        <Reveal as="div" className="care-resource" delay={140}>
          <h3>
            <SupportIcon size={16} /> Patient stories
          </h3>
          {stories === null ? (
            <LoadingState label="Loading stories…" />
          ) : stories.length === 0 ? (
            <p className="care-panel-secondary">No published stories yet.</p>
          ) : (
            <div>
              {stories.slice(0, 2).map((story) => (
                <button
                  key={story.testimonialId}
                  type="button"
                  className="care-resource-link"
                  onClick={() => navigate("/patient/testimonials")}
                >
                  <span>{story.title}</span>
                  <small>{story.displayName}</small>
                </button>
              ))}
            </div>
          )}
          <button className="link-button" type="button" onClick={() => navigate("/patient/stories")}>
            Read all stories
          </button>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Shared bits ---------- */

const QUICK_ACTIONS = [
  {
    label: "Buy medicines",
    description: "Browse the pharmacy catalog",
    path: "/pharmacy",
    Icon: PillIcon,
    tone: "brand" as const,
    emphasised: false
  },
  {
    label: "Upload prescription",
    description: "For pharmacist verification",
    path: "/patient/pharmacy?tab=prescriptions",
    Icon: UploadIcon,
    tone: "teal" as const,
    emphasised: false
  },
  {
    label: "Consult a doctor",
    description: "Book in-clinic or phone",
    path: "/patient/consultations",
    Icon: StethoscopeIcon,
    tone: "teal" as const,
    emphasised: false
  },
  {
    label: "Book a lab test",
    description: "Home or center collection",
    path: "/patient/labs",
    Icon: FlaskIcon,
    tone: "blue" as const,
    emphasised: false
  },
  {
    label: "Patient assistance",
    description: "Find cost support programs",
    path: "/patient/pap",
    Icon: ShieldHeartIcon,
    tone: "amber" as const,
    emphasised: false
  },
  {
    label: "Care journey",
    description: "See where you are",
    path: "/patient/journey",
    Icon: JourneyIcon,
    tone: "brand" as const,
    emphasised: false
  },
  {
    label: "Knowledge",
    description: "Articles and research",
    path: "/patient/knowledge",
    Icon: BookIcon,
    tone: "blue" as const,
    emphasised: false
  },
  {
    label: "Chat support",
    description: "Get pointed the right way",
    path: "/patient/chat",
    Icon: SupportIcon,
    tone: "teal" as const,
    emphasised: false
  }
];

function DashboardSkeleton() {
  return (
    <div className="care-center" aria-hidden="true">
      <div className="skeleton skeleton-hero" />
      <div className="care-quick-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton skeleton-action" key={i} />
        ))}
      </div>
      <div className="care-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton skeleton-card" key={i} />
        ))}
      </div>
    </div>
  );
}

function greetingLine(name: string | undefined): string {
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name && name !== "Pending onboarding" ? `${partOfDay}, ${firstName(name)}` : `${partOfDay}`;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function getDashboardErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "We could not load your dashboard. Please try again.";
}
