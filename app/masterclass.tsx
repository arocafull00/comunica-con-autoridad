"use client";

import { createElement, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { LeadForm } from "./lead-form";
import { QualificationForm } from "./qualification-form";
import { CAL_BOOKING_URL } from "@/lib/leads/masterclass";

const ACCESS_KEY = "webinar_access_granted_v3";
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
  const [access, setAccess] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [declined, setDeclined] = useState(false);
  const [bookingUrl, setBookingUrl] = useState("");
  const intro = useRef<HTMLElement>(null);
  const replay = useRef<HTMLDivElement>(null);
  const webinar = useRef<HTMLDivElement>(null);
  const accessArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read storage after hydration; do not store any contact details in the browser.
    const timer = setTimeout(() => {
      setAccess(readFlag(ACCESS_KEY));
      setCompleted(readFlag(COMPLETED_KEY));
      try {
        const token = localStorage.getItem(TOKEN_KEY) ?? "";
        setAccessToken(token);
        if (token && localStorage.getItem(QUALIFIED_KEY) === token) setBookingUrl(CAL_BOOKING_URL);
        if (token && localStorage.getItem(DECLINED_KEY) === token) setDeclined(true);
      } catch { /* Access still works without browser storage. */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const player = intro.current;
    if (!access || !player) return;
    const unlock = () => {
      writeFlag(COMPLETED_KEY);
      setCompleted(true);
      requestAnimationFrame(() => replay.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center",
      }));
    };
    player.addEventListener("ended", unlock);
    return () => player.removeEventListener("ended", unlock);
  }, [access]);

  function grantAccess(token: string) {
    setAccessToken(token);
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* Keep token in memory. */ }
    writeFlag(ACCESS_KEY);
    setAccess(true);
    requestAnimationFrame(() => webinar.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
  }

  function startAnotherRegistration() {
    clearFlag(ACCESS_KEY);
    clearFlag(COMPLETED_KEY);
    clearFlag(TOKEN_KEY);
    clearFlag(QUALIFIED_KEY);
    clearFlag(DECLINED_KEY);
    setAccessToken("");
    setBookingUrl("");
    setDeclined(false);
    setAccess(false);
    setCompleted(false);
    setFormOpen(true);
    requestAnimationFrame(() => accessArea.current?.scrollIntoView({
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
          {!access ? <div className="access-wrap" id="access-area" ref={accessArea}>
            {!formOpen ? <button className="access-btn" id="open-form" type="button" onClick={() => setFormOpen(true)}>ACCEDER GRATIS A LA MASTERCLASS →</button>
              : <LeadForm onSuccess={grantAccess} />}
          </div> : null}
          <div id="webinar-content" hidden={!access} ref={webinar}>
            {access ? <>
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
              {videoError ? <p className="form-message" role="alert">No se ha podido cargar el vídeo. Recarga la página para volver a intentarlo; tu acceso está guardado.</p> : null}
              <div id="unlock-copy" className="unlock" role="status">{completed
                ? "Clase desbloqueada. Ahora puedes volver a cualquier parte del vídeo cuando quieras."
                : "Ve la clase completa. Al terminar, se desbloqueará la versión que podrás revisar libremente."}</div>
            </> : null}
          </div>
        </div>
      </section>
      <section id="after" className="section" hidden={!access}>
        <div className="wrap"><div className="after-card">
          <h2>¿Quieres que analicemos tu caso?</h2>
          <p>Reserva una sesión gratuita.</p>
          {bookingUrl ? <a className="cta" href={bookingUrl}>Abrir calendario →</a> : null}
          <div>
            {declined ? <p role="status">Tus respuestas se han guardado. No reservarás una llamada.</p> : !bookingUrl && access ? accessToken
              ? <QualificationForm accessToken={accessToken} onExpired={() => { setAccessToken(""); clearFlag(TOKEN_KEY); }} onSuccess={url => {
                setBookingUrl(url ?? "");
                setDeclined(!url);
                try { localStorage.setItem(url ? QUALIFIED_KEY : DECLINED_KEY, accessToken); } catch { /* Keep result in memory. */ }
                if (url) window.location.assign(url);
              }} />
              : <LeadForm onSuccess={grantAccess} /> : null}
          </div>
          <div className="micro">Sesión gratuita · Sin compromiso</div>
          <button className="another-registration-btn" type="button" onClick={startAnotherRegistration}>Realizar otra inscripción</button>
        </div></div>
      </section>
    </main>
  );
}
