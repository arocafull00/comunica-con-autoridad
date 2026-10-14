"use client";

import { Info, X } from "lucide-react";
import { Popover } from "radix-ui";

const help = {
  contact: {
    label: "Contacto",
    descriptions: [
      "Es el email con el que la persona ha reservado en Cal.com.",
      "Pulsa el email para consultar los datos del contacto y su formulario asociado.",
      "Sin formulario asociado a este email: no encontramos una inscripción a la masterclass con el mismo email. Puede haber reservado directamente desde el enlace de Cal.com sin completar el formulario, o haber usado otro email al completarlo.",
      "Si completa el formulario con ese mismo email, la reserva se vincula automáticamente. Hasta entonces, no se envían los mensajes automáticos de seguimiento de esa llamada.",
    ],
  },
  date: {
    label: "Fecha",
    descriptions: [
      "La fecha corresponde a la zona horaria de la persona que reservó. Puedes consultar esa zona horaria al abrir el contacto.",
      "Aquí aparecen las próximas reservas vigentes recibidas de Cal.com. Para cambiar la fecha o cancelar una llamada, usa Gestionar reservas en Cal.com.",
    ],
  },
  time: {
    label: "Hora",
    descriptions: ["La hora corresponde a la zona horaria de la persona que reservó. Puedes consultar esa zona horaria al abrir el contacto."],
  },
  meeting: {
    label: "Enlace",
    descriptions: ["Abrir llamada: Cal.com ha facilitado el enlace para entrar a la sesión. Enlace pendiente: todavía no hemos recibido ese enlace."],
  },
  confirmation: {
    label: "Confirmación",
    descriptions: [
      "Asistencia confirmada: la persona ha pulsado CONFIRMAR, o ha escrito CONFIRMO o CONFIRMAR, y el sistema ha podido asociar la respuesta a esta reserva.",
      "OK recibido: ha pulsado OK en el mensaje de la reserva. Indica que ha recibido la información, no que confirme su asistencia.",
      "Pendiente de OK: reserva del flujo con audios que todavía no ha pulsado OK. Pendiente de confirmación por WhatsApp: reserva sin ese flujo y sin confirmación asociada.",
      "Si la respuesta no se puede asociar a una única llamada, queda pendiente de revisión. La falta de confirmación no cancela la reserva automáticamente ni avisa a nadie fuera del panel.",
    ],
  },
  audios: {
    label: "Mensajes y audios",
    descriptions: [
      "Solo para reservas con 24 horas o más hechas con el flujo con audios activo. Las demás conservan los mensajes anteriores.",
      "Mensaje OK: plantilla con fecha, hora y Meet. Audio 1: se envía una vez al recibir OK. Petición de confirmación: 2 horas después de que Meta acepte el audio 1, salvo que ya haya confirmado o haya empezado la llamada. Audio 2: un minuto después del recordatorio de 2 horas, solo con OK recibido.",
      "WhatsApp solo permite audios dentro de las 24 horas siguientes al último mensaje del contacto. Si ese plazo ha terminado, el audio aparece omitido y el recordatorio con Meet se envía igualmente.",
      "Aceptado por Meta confirma la aceptación del envío, no su entrega ni su escucha.",
    ],
  },
};

export function CallsColumnInfo({ column, mobile = false }: { column: keyof typeof help; mobile?: boolean }) {
  const { label, descriptions } = help[column];
  return <div className={`admin-call-column-label${mobile ? " admin-call-mobile-label" : ""}`}>
    <span>{label}</span>
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" data-slot="call-info" className="admin-call-info-button" aria-label={`Información sobre ${label.toLowerCase()}`}>
          <Info size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="admin-root admin-call-info-popover" align="start" sideOffset={8} collisionPadding={16} aria-label={`Información sobre ${label.toLowerCase()}`}>
          <div className="admin-call-info-heading">
            <h2>{label}</h2>
            <Popover.Close asChild>
              <button type="button" data-slot="call-info" className="admin-call-info-button" aria-label="Cerrar información"><X size={16} aria-hidden="true" /></button>
            </Popover.Close>
          </div>
          {descriptions.map(description => <p key={description}>{description}</p>)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
