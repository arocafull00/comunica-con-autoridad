"use client";

import { createElement, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ContactForm } from "./contact-form";
import { QualificationForm } from "./qualification-form";
import { CAL_BOOKING_URL } from "@/lib/leads/masterclass";
import { trackFunnel } from "@/lib/funnel";

const COMPLETED_KEY = "webinar_intro_completed_v1";
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
  const [accessToken, setAccessToken] = useState("");
  const [declined, setDeclined] = useState(false);
  const [bookingUrl, setBookingUrl] = useState("");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [accessCheckError, setAccessCheckError] = useState(false);
  const intro = useRef<HTMLElement>(null);
  const replay = useRef<HTMLDivElement>(null);
  const bookingArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Read storage after hydration; do not store any contact details in the browser.
    const timer = setTimeout(() => {
      setCompleted(readFlag(COMPLETED_KEY));
      try {
        const token = localStorage.getItem(TOKEN_KEY) ?? "";
        if (token) {
          setCheckingAccess(true);
          void fetch("/api/leads/access", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
            .then(async response => {
              if (response.status === 401) {
                clearFlag(TOKEN_KEY); clearFlag(QUALIFIED_KEY); clearFlag(DECLINED_KEY);
                return;
              }
              if (!response.ok || !(await response.json()).ok) throw new Error("Access check failed");
              setAccessToken(token);
              if (localStorage.getItem(QUALIFIED_KEY) === token) setBookingUrl(CAL_BOOKING_URL);
              if (localStorage.getItem(DECLINED_KEY) === token) setDeclined(true);
            })
            .catch(() => { if (!controller.signal.aborted) setAccessCheckError(true); })
            .finally(() => { if (!controller.signal.aborted) setCheckingAccess(false); });
        }
      } catch { /* The class and the booking form work without browser storage. */ }
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  useEffect(() => {
    trackFunnel("visit");
    const players = () => [intro.current, replay.current?.querySelector("wistia-player")] as ({ currentTime?: number; duration?: number } | null | undefined)[];
    const progress = setInterval(() => {
      for (const player of players()) {
        const time = Number(player?.currentTime) || 0;
        const duration = Number(player?.duration) || 0;
        if (time > 0) trackFunnel("video_play");
        if (!duration) continue;
        if (time >= duration * 0.25) trackFunnel("video_25");
        if (time >= duration * 0.5) trackFunnel("video_50");
        if (time >= duration * 0.75) trackFunnel("video_75");
      }
    }, 2000);
    const ended = () => trackFunnel("video_complete");
    const replayPlayer = replay.current?.querySelector("wistia-player");
    replayPlayer?.addEventListener("ended", ended);
    return () => { clearInterval(progress); replayPlayer?.removeEventListener("ended", ended); };
  }, []);

  useEffect(() => {
    const player = intro.current;
    if (!player) return;
    const unlock = () => {
      trackFunnel("video_complete");
      writeFlag(COMPLETED_KEY);
      setCompleted(true);
      requestAnimationFrame(() => replay.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center",
      }));
    };
    player.addEventListener("ended", unlock);
    return () => player.removeEventListener("ended", unlock);
  }, []);

  function saveContact(token: string) {
    trackFunnel("contact_saved");
    setAccessCheckError(false);
    setAccessToken(token);
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* Keep token in memory. */ }
    requestAnimationFrame(() => bookingArea.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
  }

  function startAnotherRegistration() {
    setAccessCheckError(false);
    clearFlag(TOKEN_KEY);
    clearFlag(QUALIFIED_KEY);
    clearFlag(DECLINED_KEY);
    setAccessToken("");
    setBookingUrl("");
    setDeclined(false);
    setContactOpen(true);
    requestAnimationFrame(() => bookingArea.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
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
          <h2>¿Quieres que analicemos tu caso?</h2>
          <p>Reserva una sesión gratuita.</p>
          {bookingUrl ? <a className="cta" href={bookingUrl} target="_blank" rel="noopener noreferrer">Abrir calendario →</a> : null}
          <div>
            {checkingAccess ? <p role="status">Comprobando tu inscripción…</p> : accessCheckError ? <div>
              <p role="alert">No hemos podido comprobar tu inscripción. Vuelve a intentarlo.</p>
              <button className="next-btn" type="button" onClick={() => window.location.reload()}>Reintentar</button>
            </div> : declined ? <p role="status">Tus respuestas se han guardado. No reservarás una llamada.</p> : bookingUrl ? null : accessToken
              ? <QualificationForm accessToken={accessToken} onExpired={() => { setAccessToken(""); clearFlag(TOKEN_KEY); setContactOpen(true); }} onSuccess={url => {
                setBookingUrl(url ?? "");
                setDeclined(!url);
                try { localStorage.setItem(url ? QUALIFIED_KEY : DECLINED_KEY, accessToken); } catch { /* Keep result in memory. */ }
              }} />
              : contactOpen ? <ContactForm onSuccess={saveContact} />
              : <button className="cta" id="open-booking" type="button" onClick={() => { trackFunnel("booking_open"); setContactOpen(true); }}>Agendar llamada →</button>}
          </div>
          <div className="micro">Sesión gratuita · Sin compromiso</div>
          {accessToken || bookingUrl || declined ? <button className="another-registration-btn" type="button" disabled={checkingAccess} onClick={startAnotherRegistration}>Realizar otra inscripción</button> : null}
        </div></div>
      </section>
    </main>
  );
}
