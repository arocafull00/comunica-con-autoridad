import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata = { title: "Administración | Comunica con Autoridad", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function Layout({ children }: { children: React.ReactNode }) { return <div className="admin-root dark">{children}</div>; }
