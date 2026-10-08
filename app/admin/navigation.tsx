"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarClock, ChartNoAxesCombined, UsersRound, MessageCircle, UserRound, RefreshCw } from "lucide-react";

const links = [
  { href: "/admin", label: "Resumen", icon: ChartNoAxesCombined },
  { href: "/admin/contacts", label: "Contactos", icon: UsersRound },
  { href: "/admin/calls", label: "Llamadas", icon: CalendarClock },
  { href: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/admin/account", label: "Mi cuenta", icon: UserRound },
];

export function AdminNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <nav className="admin-navigation" aria-label="Administración">
    {links.map(({ href, label, icon: Icon }) => <Button key={href} variant="ghost" asChild><Link href={href} prefetch={true} aria-current={pathname === href ? "page" : undefined}>
      <Icon size={19} aria-hidden="true" /><span>{label}</span>
    </Link></Button>)}
    <Button className="admin-refresh" variant="ghost" disabled={refreshing} onClick={() => startTransition(() => router.refresh())} aria-busy={refreshing}>
      <RefreshCw size={19} aria-hidden="true" /><span>{refreshing ? "Actualizando…" : "Actualizar datos"}</span>
    </Button>
  </nav>;
}
