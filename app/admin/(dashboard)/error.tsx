"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) { return <section><h1>No se pudo cargar el panel</h1><p>Los datos no están disponibles temporalmente. Inténtalo de nuevo en unos momentos.</p><Button onClick={reset}>Volver a intentar</Button></section>; }
