import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PatientPageShell } from "../shell/PatientPageShell";
import { Alert, BackLink, Button, EmptyState, Field, Input, ListCard, LoadingState, PageHero, Panel } from "../components/ui";
import { DocumentIcon, FlaskIcon, HomeIcon } from "../components/icons";
import { StatusChip } from "../components/StatusChip";
import { listPrescriptions, type Prescription } from "../pharmacy/pharmacy-api";
import {
  createLabBooking,
  getLabReport,
  getPatientBooking,
  listLabTests,
  listPatientBookings,
  type LabBooking,
  type LabTest
} from "../labs/labs-api";

type Navigate = (path: string) => void;

export function PatientLabsPage({ navigate }: { navigate: Navigate }) {
  const { user, signOut } = useAuth();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [bookings, setBookings] = useState<LabBooking[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [selectedTest, setSelectedTest] = useState<LabTest | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<LabBooking | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [collectionType, setCollectionType] = useState<"HOME" | "CENTER">("HOME");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTimeSlot, setPreferredTimeSlot] = useState("");
  const [patientNotes, setPatientNotes] = useState("");
  const [prescriptionId, setPrescriptionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([listLabTests({ page: 1, pageSize: 100 }), listPatientBookings(), listPrescriptions()])
      .then(([testResponse, bookingResponse, prescriptionResponse]) => {
        if (cancelled) return;
        setTests(testResponse.items);
        setBookings(bookingResponse);
        setPrescriptions(prescriptionResponse.items.filter((item) => item.status === "VERIFIED"));
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(getErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }
  void leave;

  function refresh(): void {
    Promise.all([listLabTests({ page: 1, pageSize: 100 }), listPatientBookings()])
      .then(([testResponse, bookingResponse]) => {
        setTests(testResponse.items);
        setBookings(bookingResponse);
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  function openBookingForm(test: LabTest): void {
    setSelectedTest(test);
    setCollectionType(test.homeCollectionAvailable ? "HOME" : "CENTER");
    setPreferredDate("");
    setPreferredTimeSlot("");
    setPatientNotes("");
    setPrescriptionId("");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selectedTest) {
      return;
    }

    if (!preferredDate) {
      setError("Choose a preferred sample date.");
      return;
    }

    if (selectedTest.requiresPrescription && !prescriptionId) {
      setError("A verified prescription is required for this test.");
      return;
    }

    if (submitting) return;

    setSubmitting(true);
    setError(null);
    createLabBooking({
      labTestId: selectedTest.testId,
      collectionType,
      preferredDate,
      preferredTimeSlot: preferredTimeSlot.trim() || undefined,
      patientNotes: patientNotes.trim() || undefined,
      prescriptionId: selectedTest.requiresPrescription ? prescriptionId : undefined
    })
      .then((booking) => {
        setNotice(`Booking created for ${booking.test.name}.`);
        setSelectedTest(null);
        refresh();
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setSubmitting(false));
  }

  function openDetails(bookingId: string): void {
    setDetailsLoading(true);
    setError(null);
    getPatientBooking(bookingId)
      .then(setSelectedBooking)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setDetailsLoading(false));
  }

  function openReport(booking: LabBooking): void {
    if (!booking.report) {
      setError("The report is not available yet.");
      return;
    }

    getLabReport(booking.bookingId)
      .then((report) => {
        window.open(report.access.reference, "_blank", "noopener,noreferrer");
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)));
  }

  if (!user) return null;

  return (
    <PatientPageShell
      navigate={navigate}
      activePath="/patient/labs"
      className="labs-page"
      backSlot={<BackLink navigate={navigate} fallback="/patient" label="Back to dashboard" />}
    >
      <PageHero
        tone="teal"
        eyebrow="Pathology &amp; Diagnostics Network"
        title="Diagnostic lab tests,"
        highlight="accurate &amp; verified."
        description="Schedule bloodwork, molecular markers, and cancer diagnostics from our certified laboratory network. Sample collection at your home or at a partner center."
        image="/assets/banner/specialty-medicines.jpg"
        imageAlt="Diagnostic laboratory samples"
        badge={
          <>
            <FlaskIcon size={16} /> Certified Diagnostics
          </>
        }
        crumbs={[
          { label: "Dashboard", href: "/patient" },
          { label: "Lab tests" }
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading lab catalog..." />
      ) : (
        <section className="consultation-grid">
          <Panel className="panel-fluid">
            <h2>Available tests</h2>
            {tests.length === 0 ? (
              <EmptyState
                icon={<FlaskIcon size={22} />}
                title="No lab tests are available right now"
                hint="The lab catalog is being prepared. Check back soon."
              />
            ) : (
              <div className="lab-test-list">
                {tests.map((test) => (
                  <ListCard
                    key={test.testId}
                    icon={<FlaskIcon size={18} />}
                    tone="blue"
                    title={test.name}
                    meta={`${test.category} • ${test.currency} ${test.price}${test.homeCollectionAvailable ? " • Home collection" : ""}`}
                    action={
                      <Button type="button" onClick={() => openBookingForm(test)}>Book test</Button>
                    }
                  >
                    {test.description ? <span>{test.description}</span> : null}
                  </ListCard>
                ))}
              </div>
            )}
          </Panel>

          <Panel className="panel-fluid">
            <h2>My bookings</h2>
            {bookings.length === 0 ? (
              <EmptyState
                icon={<DocumentIcon size={22} />}
                title="No lab bookings yet"
                hint="Book a test from the catalog and track collection and reports here."
              />
            ) : (
              <div className="stack-list">
                {bookings.map((booking) => (
                  <button className="list-row list-row-button" type="button" key={booking.bookingId} onClick={() => openDetails(booking.bookingId)}>
                    <div>
                      <strong>{booking.test.name}</strong>
                      <span className="muted">{formatDate(booking.preferredDate)} • {booking.collectionType === "HOME" ? "Home sample" : "Center visit"}</span>
                    </div>
                    <StatusChip status={booking.status} />
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {selectedTest ? (
            <div className="lab-booking-panel">
              <Panel>
                <h2>Book {selectedTest.name}</h2>
                <p className="muted">{selectedTest.description || "Sample collection booking"}</p>
                <p className="muted">{selectedTest.category} • {selectedTest.currency} {selectedTest.price}{selectedTest.requiresPrescription ? " • Prescription required" : ""}</p>
                {selectedTest.preparationInstructions ? <p className="muted">Preparation: {selectedTest.preparationInstructions}</p> : null}
                <form className="form-stack" onSubmit={submit}>
                  <Field label="Collection type" htmlFor="lab-collection-type">
                    <div className="collection-mode-grid" role="radiogroup" aria-label="Collection type">
                      {selectedTest.homeCollectionAvailable ? (
                        <div
                          tabIndex={0}
                          role="radio"
                          aria-checked={collectionType === "HOME"}
                          className={`mode-card${collectionType === "HOME" ? " is-active" : ""}`}
                          onClick={() => setCollectionType("HOME")}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault();
                              setCollectionType("HOME");
                            }
                          }}
                        >
                          <HomeIcon size={20} />
                          <div>
                            <strong>Home collection</strong>
                            <p className="field-hint" style={{ margin: 0 }}>Sample collected at your home</p>
                          </div>
                        </div>
                      ) : null}
                      {selectedTest.centerCollectionAvailable ? (
                        <div
                          tabIndex={0}
                          role="radio"
                          aria-checked={collectionType === "CENTER"}
                          className={`mode-card${collectionType === "CENTER" ? " is-active" : ""}`}
                          onClick={() => setCollectionType("CENTER")}
                          onKeyDown={(event) => {
                            if (event.key === " " || event.key === "Enter") {
                              event.preventDefault();
                              setCollectionType("CENTER");
                            }
                          }}
                        >
                          <FlaskIcon size={20} />
                          <div>
                            <strong>Center visit</strong>
                            <p className="field-hint" style={{ margin: 0 }}>Visit a partner collection center</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </Field>

                  <Field label="Preferred sample date" htmlFor="lab-date">
                    <Input id="lab-date" type="date" value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} />
                  </Field>

                  <Field label="Preferred time slot" htmlFor="lab-time-slot">
                    <Input id="lab-time-slot" value={preferredTimeSlot} onChange={(event) => setPreferredTimeSlot(event.target.value)} placeholder="e.g. Morning" />
                  </Field>

                  {selectedTest.requiresPrescription ? (
                    <Field label="Verified prescription" htmlFor="lab-prescription">
                      <select className="input" id="lab-prescription" value={prescriptionId} onChange={(event) => setPrescriptionId(event.target.value)}>
                        <option value="">Select a verified prescription</option>
                        {prescriptions.map((prescription) => (
                          <option key={prescription.id} value={prescription.id}>{prescription.documentName}</option>
                        ))}
                      </select>
                    </Field>
                  ) : null}

                  <Field label="Patient notes" htmlFor="lab-notes">
                    <textarea className="input textarea" id="lab-notes" value={patientNotes} onChange={(event) => setPatientNotes(event.target.value)} />
                  </Field>

                  <div className="button-row">
                    <Button type="submit" disabled={submitting}>{submitting ? "Booking..." : "Confirm booking"}</Button>
                    <Button className="button-secondary" type="button" onClick={() => setSelectedTest(null)}>Cancel</Button>
                  </div>
                </form>
              </Panel>
            </div>
          ) : null}

          {detailsLoading ? <LoadingState label="Loading booking details..." /> : null}

          {selectedBooking ? (
            <div className="lab-booking-panel">
              <Panel>
                <h2>Booking details</h2>
                <p><strong>{selectedBooking.test.name}</strong></p>
                <p className="muted">{selectedBooking.test.category} • {selectedBooking.test.currency} {selectedBooking.test.price}</p>
                <p className="muted">
                  Collection: {selectedBooking.collectionType === "HOME" ? "Home sample pickup" : "Center visit"} • <StatusChip status={selectedBooking.status} />
                </p>
                <p className="muted">Preferred date: {formatDate(selectedBooking.preferredDate)}{selectedBooking.preferredTimeSlot ? ` • ${selectedBooking.preferredTimeSlot}` : ""}</p>
                {selectedBooking.patientNotes ? <p className="muted">Notes: {selectedBooking.patientNotes}</p> : null}
                {selectedBooking.externalOrderId ? <p className="muted">External order ID: {selectedBooking.externalOrderId}</p> : null}
                {selectedBooking.test.preparationInstructions ? <p className="muted">Preparation: {selectedBooking.test.preparationInstructions}</p> : null}
                {selectedBooking.report ? (
                  <div>
                    <p className="muted">Report: {selectedBooking.report.documentName}{selectedBooking.report.uploadedAt ? ` • ${new Date(selectedBooking.report.uploadedAt).toLocaleDateString()}` : ""}</p>
                    <div className="button-row">
                      <Button type="button" onClick={() => openReport(selectedBooking)}>Open report</Button>
                      <Button className="button-secondary" type="button" onClick={() => setSelectedBooking(null)}>Close</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="empty-state">The report is not available yet.</p>
                    <Button className="button-secondary" type="button" onClick={() => setSelectedBooking(null)}>Close</Button>
                  </div>
                )}
              </Panel>
            </div>
          ) : null}
        </section>
      )}
    </PatientPageShell>
  );
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "The lab request could not be completed.";
}