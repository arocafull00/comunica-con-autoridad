"use client";

import { createElement, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { LeadForm } from "./lead-form";

const ACCESS_KEY = "webinar_access_granted_v3";
const COMPLETED_KEY = "webinar_intro_completed_v1";

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
  const intro = useRef<HTMLElement>(null);
  const replay = useRef<HTMLDivElement>(null);
  const webinar = useRef<HTMLDivElement>(null);
  const accessArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read storage after hydration; do not store any contact details in the browser.
    const timer = setTimeout(() => {
      setAccess(readFlag(ACCESS_KEY));
      setCompleted(readFlag(COMPLETED_KEY));
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

  function grantAccess() {
    writeFlag(ACCESS_KEY);
    setAccess(true);
    requestAnimationFrame(() => webinar.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start",
    }));
  }

  function startAnotherRegistration() {
    clearFlag(ACCESS_KEY);
    clearFlag(COMPLETED_KEY);
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
          <a className="cta" href="https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion" target="_blank" rel="noopener noreferrer">RESERVAR SESIÓN GRATUITA →</a>
          <div className="micro">Sesión gratuita · Sin compromiso</div>
          <button className="another-registration-btn" type="button" onClick={startAnotherRegistration}>Realizar otra inscripción</button>
        </div></div>
      </section>
    </main>
  );
}
