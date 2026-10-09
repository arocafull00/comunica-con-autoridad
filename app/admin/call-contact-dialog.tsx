"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";

export type CallContact = {
  name: string | null;
  phone: string;
  profession: string | null;
  situation: string | null;
  goal: string | null;
  commitment?: string | null;
  investment?: string | null;
};

export function CallContactDialog({ email, contact, registered, timeZone }: {
  email: string;
  contact: CallContact | null;
  registered: boolean;
  timeZone: string;
}) {
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <button type="button" data-slot="contact-dialog-trigger" className="admin-contact-trigger" aria-label={`Ver contacto: ${email}`}>{email}</button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="admin-contact-overlay" />
      <Dialog.Content className="admin-root admin-contact-dialog">
        <div className="admin-contact-dialog-heading">
          <Dialog.Title>Información del contacto</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" data-slot="contact-dialog-close" className="admin-call-info-button" aria-label="Cerrar contacto"><X size={20} aria-hidden="true" /></button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="admin-muted">Datos del contacto que ha reservado la llamada.</Dialog.Description>
        <dl className="admin-contact-details">
          {contact?.name ? <div><dt>Nombre</dt><dd>{contact.name}</dd></div> : null}
          <div><dt>Correo</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div>
          {contact ? <div><dt>Teléfono</dt><dd><a href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{contact.phone}</a></dd></div> : null}
          <div><dt>Formulario de la masterclass</dt><dd>{registered ? "Formulario asociado a este email." : "Sin formulario asociado a este email."}</dd></div>
          <div><dt>Zona horaria de la llamada</dt><dd>{timeZone}</dd></div>
          {contact?.profession ? <div><dt>Profesión</dt><dd>{contact.profession}</dd></div> : null}
          {contact?.situation ? <div><dt>Situación</dt><dd>{contact.situation}</dd></div> : null}
          {contact?.goal ? <div><dt>Quiere mejorar</dt><dd>{contact.goal}</dd></div> : null}
          {contact?.commitment ? <div><dt>Compromiso</dt><dd>{contact.commitment}</dd></div> : null}
          {contact?.investment ? <div><dt>Inversión</dt><dd>{contact.investment}</dd></div> : null}
        </dl>
        {!registered ? <p className="admin-notice">Puede haber reservado directamente en Cal.com o haber usado otro email en el formulario. Hasta que se vincule una inscripción, no se envían los mensajes automáticos de seguimiento de esta llamada.</p> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
