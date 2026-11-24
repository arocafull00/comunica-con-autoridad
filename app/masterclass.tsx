"use client";

import { createElement, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ContactForm } from "./contact-form";
import { QualificationForm } from "./qualification-form";
import type { BookingContact } from "@/lib/leads/booking-validation";
import { CAL_BOOKING_URL } from "@/lib/leads/masterclass";

const COMPLETED_KEY = "webinar_intro_completed_v1";
const BOOKING_KEY = "webinar_booking_ready_v1";
const TOKEN_KEY = "webinar_access_token_v1";
const QUALIFIED_KEY = "webinar_qualified_token_v1";
const DECLINED_KEY = "webinar_declined_token_v1";

function readFlag(key: string) {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}
function writeFlag(key: string) {
  try { localStorage.setItem(key, "1"); } catch { /* Access still works when storage is unavailable. */ }
}
function clearFlag(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function Masterclass() {
  const [completed, setCompleted] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [contact, setContact] = useState<BookingContact | null>(null);
  const [bookingUrl, setBookingUrl] = useState("");
  const intro = useRef<HTMLElement>(null);
  const replay = useRef<HTMLDivElement>(null);
  const bookingArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCompleted(readFlag(COMPLETED_KEY));
      if (readFlag(BOOKING_KEY)) setBookingUrl(CAL_BOOKING_URL);
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token && localStorage.getItem(QUALIFIED_KEY) === token && Number(token.split(".")[1]) > Date.now() / 1000) {
          writeFlag(BOOKING_KEY);
          setBookingUrl(CAL_BOOKING_URL);
        }
        clearFlag(TOKEN_KEY);
        clearFlag(QUALIFIED_KEY);
        clearFlag(DECLINED_KEY);
      } catch { /* The class and the booking form work without browser storage. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const player = intro.current;
    if (!player) return;
    const unlock = () => {
      writeFlag(COMPLETED_KEY);
      setCompleted(true);
      requestAnimationFrame(() => replay.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center",
      }));
    };
    player.addEventListener("ended", unlock);
    return () => player.removeEventListener("ended", unlock);
  }, []);

  function scrollToBooking() {
    requestAnimationFrame(() => bookingArea.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
  }

  function continueWithContact(details: BookingContact) {
    setContact(details);
    scrollToBooking();
  }

  function startAnotherRegistration() {
    clearFlag(BOOKING_KEY);
    setContact(null);
    setBookingUrl("");
    setContactOpen(true);
    scrollToBooking();
  }

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div className="eyebrow">Clase privada</div>
          <h1>Aprende a comunicar con más autoridad, influencia y control.</h1>
          <p className="sub">Descubre el sistema que aplicamos con cientos de clientes en situaciones reales.</p>
          <div id="webinar-content">
            <Script src="https://fast.wistia.com/player.js" onError={() => setVideoError(true)} />
            <Script src="https://fast.wistia.com/embed/it5ema1qqm.js" type="module" onError={() => setVideoError(true)} />
            <Script src="https://fast.wistia.com/embed/uzw5xmj4h0.js" type="module" onError={() => setVideoError(true)} />
            <div className="stage">
              <div id="video1-wrap" className="player-shell" hidden={completed}>
                {createElement("wistia-player", { id: "video1", "media-id": "it5ema1qqm", aspect: "1.7777777777777777", ref: intro })}
              </div>
              <div id="video2-wrap" className="player-shell" hidden={!completed} ref={replay}>
                {createElement("wistia-player", { id: "video2", "media-id": "uzw5xmj4h0", aspect: "1.7777777777777777" })}
              </div>
            </div>
            {videoError ? <p className="form-message" role="alert">No se ha podido cargar el vídeo. Recarga la página para volver a intentarlo.</p> : null}
            <div id="unlock-copy" className="unlock" role="status">{completed
              ? "Clase desbloqueada. Ahora puedes volver a cualquier parte del vídeo cuando quieras."
              : "Ve la clase completa. Al terminar, se desbloqueará la versión que podrás revisar libremente."}</div>
          </div>
        </div>
      </section>
      <section id="after" className="section">
        <div className="wrap"><div className="after-card" id="booking-area" ref={bookingArea}>
          {bookingUrl ? null : <h2>¿Quieres que analicemos tu caso?</h2>}
          <p>Reserva una sesión gratuita.</p>
          {bookingUrl ? <a className="cta cta-lg" href={bookingUrl} target="_blank" rel="noopener noreferrer">Agendar consultoría gratuita →</a> : null}
          <div>
            {bookingUrl ? null : contact
              ? <QualificationForm contact={contact} onReset={startAnotherRegistration} onSuccess={url => {
                setContact(null);
                setBookingUrl(url);
                writeFlag(BOOKING_KEY);
              }} />
              : contactOpen ? <ContactForm onContinue={continueWithContact} />
              : <button className="cta" id="open-booking" type="button" onClick={() => setContactOpen(true)}>Agendar llamada →</button>}
          </div>
          <div className="micro">Sesión gratuita · Sin compromiso</div>
          {bookingUrl ? <button className="another-registration-btn" type="button" onClick={startAnotherRegistration}>Realizar otra inscripción</button> : null}
        </div></div>
      </section>
    </main>
  );
}
