import type { Viewport } from "next";
import { Masterclass } from "./masterclass";
import "./masterclass.css";

export const viewport: Viewport = { themeColor: "#0b0b0c" };

export default function Home() {
  return (
    <div className="webinar-page">
      <header><div className="wrap"><div className="brand">IGNACIO ROA <span>•</span> COMUNICACIÓN E INFLUENCIA</div></div></header>
      <Masterclass />
      <footer>Ignacio Roa · Comunicación e Influencia</footer>
    </div>
  );
}
