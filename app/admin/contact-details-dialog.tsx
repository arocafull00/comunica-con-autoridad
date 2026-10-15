"use client";

import { Dialog } from "radix-ui";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ContactDetailsSection = { title: string; fields: [string, string][] };

export function ContactDetailsDialog({ name, email, phone, whatsappUrl, sections }: {
  name: string;
  email: string;
  phone: string | null;
  whatsappUrl: string | null;
  sections: ContactDetailsSection[];
}) {
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <Button variant="ghost" size="icon-sm" className="contacts-row-action" aria-label={`Ver detalles de ${name}`}><Eye aria-hidden="true" /></Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="admin-contact-overlay" />
      <Dialog.Content className="admin-root admin-contact-dialog contacts-dialog">
        <div className="admin-contact-dialog-heading">
          <Dialog.Title>{name}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant="ghost" size="icon-sm" className="contacts-row-action" aria-label="Cerrar"><X aria-hidden="true" /></Button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="contacts-dialog-description"><a href={`mailto:${email}`}>{email}</a>{phone && whatsappUrl ? <> · <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">{phone}</a></> : null}</Dialog.Description>
        {sections.map((section) => <section key={section.title} className="contacts-dialog-section">
          <h3>{section.title}</h3>
          <dl>{section.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </section>)}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
