import { useEffect, useState } from "react";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert, Button, Field, Input, LoadingState, Panel } from "../components/ui";
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
    Promise.all([listLabTests({ page: 1, pageSize: 100 }), listPatientBookings(), listPrescriptions()])
      .then(([testResponse, bookingResponse, prescriptionResponse]) => {
        setTests(testResponse.items);
        setBookings(bookingResponse);
        setPrescriptions(prescriptionResponse.items.filter((item) => item.status === "VERIFIED"));
      })
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  function leave(): void {
    signOut();
    navigate("/");
  }

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
    <main className="workspace-page consultation-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Patient care</p>
          <h1>Lab tests</h1>
          <p className="intro">Book bloodwork and sample collection from the active lab catalog.</p>
        </div>
        <Button className="button-secondary" type="button" onClick={leave}>Sign out</Button>
      </header>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <div className="success-message" role="status">{notice}</div> : null}

      {loading ? (
        <LoadingState label="Loading lab catalog..." />
      ) : (
        <section className="consultation-grid">
          <Panel>
            <h2>Available tests</h2>
            {tests.length === 0 ? (
              <p className="empty-state">No active lab tests are available right now.</p>
            ) : (
              <div className="stack-list">
                {tests.map((test) => (
                  <div className="list-row" key={test.testId}>
                    <div>
                      <strong>{test.name}</strong>
                      <span className="muted">{test.category} • {test.currency} {test.price}</span>
                    </div>
                    <Button type="button" onClick={() => openBookingForm(test)}>Book</Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <h2>My bookings</h2>
            {bookings.length === 0 ? (
              <p className="empty-state">No lab bookings yet.</p>
            ) : (
              <div className="stack-list">
                {bookings.map((booking) => (
                  <button className="list-row list-row-button" type="button" key={booking.bookingId} onClick={() => openDetails(booking.bookingId)}>
                    <div>
                      <strong>{booking.test.name}</strong>
                      <span className="muted">{formatDate(booking.preferredDate)} • {booking.status}</span>
                    </div>
                    <span className="status">{booking.status}</span>
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
                    <select
                      className="input"
                      id="lab-collection-type"
                      value={collectionType}
                      onChange={(event) => setCollectionType(event.target.value as "HOME" | "CENTER")}
                    >
                      {selectedTest.homeCollectionAvailable ? <option value="HOME">Home collection</option> : null}
                      {selectedTest.centerCollectionAvailable ? <option value="CENTER">Center visit</option> : null}
                    </select>
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
                <p className="muted">Collection: {selectedBooking.collectionType} • {selectedBooking.status}</p>
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
    </main>
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