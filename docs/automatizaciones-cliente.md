# Automatizaciones solicitadas por el cliente

Fecha de recepción: 8 de octubre de 2026. Fuente: documento «Texto pegado.txt» aportado por el usuario en esta conversación. El texto íntegro se conserva al final de este archivo.

Este documento recoge el encargo, las diferencias con lo preparado y los puntos pendientes. La guía de configuración técnica está en [seguimiento.md](seguimiento.md). Documentar un requisito no significa que esté implementado o activo en producción.

## Recorrido y tiempos de referencia

1. La persona deja sus datos en la web y accede a la masterclass/webinar.
2. Si reserva una sesión en Cal.com, entra en la secuencia de la llamada.
3. Si no reserva, entra en la secuencia de captación por WhatsApp.
4. Recibe la secuencia de cuatro emails, tanto si reserva la llamada como si no. Esta es la interpretación de trabajo de «tanto si se apuntan como si no»; confirmar que el cliente se refiere a reservar la llamada.

Los tiempos de captación y email se cuentan desde la inscripción al webinar; los recordatorios de llamada se cuentan desde su hora de inicio. Actualmente la inscripción ocurre tras completar el formulario, guardar los datos y confirmar la copia en Google Sheets: no exige ver el vídeo entero. No se envían comunicaciones a quien no haya aceptado el canal correspondiente.

## Si reserva una llamada: WhatsApp

| Mensaje | Cuándo | Contenido solicitado | Variables | Situación en el código |
| --- | --- | --- | --- | --- |
| Confirmación de reserva | Al reservar | Explicar el objetivo de la sesión y cómo se valorará trabajar juntos. | Ninguna | Preparado como `booking_confirmation`. |
| Recordatorio de 24 horas | 24 horas antes | Reservar 45 minutos, entrar desde un sitio tranquilo y responder «CONFIRMO» para mantener la plaza. | Ninguna en el original | Preparado como `booking_24h`, con hora adicional y texto de revisión manual. |
| Confirmación de reserva próxima | Al reservar con menos de 24 horas de antelación | Versión breve que pide «CONFIRMO» desde el primer mensaje. | Ninguna | Variante pendiente; debe sustituir a la confirmación habitual, sin duplicar ambos mensajes. |
| Recordatorio de 2 horas | 2 horas antes | Recordar la confirmación e incluir el enlace real de Google Meet. | Enlace de Meet | Preparado como `booking_2h`, con texto de revisión manual. |
| Recordatorio de 15 minutos | 15 minutos antes | «En 15 minutos empezamos. Nos vemos ahora.» | Ninguna | Preparado como `booking_15m`. |

### Respuesta «CONFIRMO» y mantenimiento de la plaza

El cliente pide liberar automáticamente la plaza si no se recibe confirmación, y que no se realice la reunión sin ella. El documento no fija el plazo límite para confirmar ni el momento de liberación, especialmente para reservas de última hora.

El 8 de octubre el usuario solicita aceptar directamente la plaza al recibir «CONFIRMO». Está pendiente concretar si esa aceptación debe reflejarse también en Cal.com o únicamente en el panel.

El 9 de octubre el usuario deja en pausa la confirmación automática de asistencia. La detección de «CONFIRMO» queda comentada en `lib/followups/whatsapp.ts` para retomarla en una futura iteración: tanto los mensajes de texto como los botones se registran con `confirms: false` y no actualizan `confirmed_at`. Se mantienen el registro de respuestas y las bajas «BAJA»/«STOP».

La lógica conservada en la base de datos permite registrar asistencia cuando hay una única reserva futura asociada al teléfono y el mensaje es posterior a su creación o cambio. Actualmente no acepta reservas por la API de Cal.com ni cancela automáticamente por falta de respuesta. Antes de reactivar la detección, revisar el destino de la confirmación y probar el recorrido completo.

## Si no reserva una llamada: WhatsApp

| Mensaje | Cuándo desde la inscripción | Condición del cliente | Variables | Clave preparada |
| --- | --- | --- | --- | --- |
| Pregunta sobre la clase | 1 hora | No ha reservado llamada. Preguntar qué busca mejorar en su comunicación. | Nombre del registro | `webinar_1h` |
| Invitación a reservar | 1 día | No ha reservado llamada. Enviar el enlace de Cal.com. | Enlace fijo de reserva | `webinar_1d` |
| Cierre de seguimiento | 3 días | No ha reservado llamada y no ha respondido. | Ninguna | `webinar_3d` |

La reserva debe detener los WhatsApp de captación pendientes. Una respuesta por WhatsApp debe detener el mensaje de cierre de los tres días. El encargo solo condiciona ese último mensaje a no haber respondido; no establece esa condición para el de un día.

Enlace de reserva indicado por el cliente:

```text
https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
```

## Emails por Resend: cuatro mensajes

| Orden | Cuándo desde la inscripción | Asunto original | Variables | Clave preparada |
| --- | --- | --- | --- | --- |
| 1 | 30 minutos | Quédate con esta idea de la masterclass que has visto. | Enlace fijo de reserva | `email_1` |
| 2 | 1 día | Te presento a Santiago, Maria y Mateo. | Nombre y enlace fijo de reserva | `email_2` |
| 3 | 2 días | Esto es lo que me dice la mayoría de la gente: | Enlace fijo de reserva | `email_3` |
| 4 | 3 días | Transferencia recibida. | Enlace fijo de reserva | `email_4` |

La secuencia continúa aunque se reserve una llamada. Requiere consentimiento de comunicaciones por email y termina ante una baja. El encargo no incluye un email inmediato de bienvenida ni un email de reserva enviado por Resend; las notificaciones propias de Cal.com son independientes.

El original llama «Email 4» tanto al mensaje de dos días como al de tres días. La tabla los numera por orden de envío, conservando los rótulos originales en el anexo.

## Diferencias y decisiones pendientes

- **Aceptación con «CONFIRMO»:** en pausa por decisión del usuario el 9 de octubre; código conservado para una futura iteración. Concretar la aceptación de la reserva en Cal.com y verificar el recorrido completo antes de reactivarla.
- **Liberación automática:** solicitada por el cliente, pendiente de definir el plazo y de implementar. La guía técnica vigente utiliza revisión manual. No asumir que aceptar una plaza autoriza también a cancelarla automáticamente.
- **Reservas con menos de 24 horas:** falta la variante específica del primer mensaje. No enviar el recordatorio de 24 horas cuando su momento ya haya pasado.
- **Duración de la llamada:** los WhatsApp dicen 45 minutos y el último email dice 35 minutos. Confirmar una duración y compararla con el evento de Cal.com.
- **Testimonio Mateo/Álvaro:** el título del segundo email dice Mateo, pero el párrafo habla de Álvaro. Confirmar el nombre antes de cambiar el texto.
- **Inicio de los tiempos:** confirmar que «entrar/apuntarse al webinar» significa completar el formulario, tal como está preparado actualmente.
- **Redacción:** la plantilla preparada de una hora cambia «dime un una cosa» por «piensa en una cosa». Los recordatorios preparados también sustituyen la liberación automática por revisión manual. El anexo conserva el texto del cliente sin estos cambios.

## Estado de conexión comprobado en esta conversación

Estado a 8 de octubre de 2026; revisar de nuevo al activar los envíos:

- Cal.com: secreto e identificador de evento configurados en local y producción; receptor desplegado. El usuario comunica que el Ping test ha funcionado. Falta verificar una reserva real, su reprogramación y cancelación.
- WhatsApp: todavía sin configurar, según indica el usuario. Las plantillas y los envíos reales siguen pendientes.
- Resend: el envío se ejecuta en la Edge Function `process-followup-queue`, con sus secretos e interruptor de email en Supabase. La web conserva el mismo secreto de baja para validar enlaces existentes. Comprobar la entrega de un email real antes de considerar el envío validado de extremo a extremo.
- Procesamiento de envíos: `process-followup-queue` utiliza Supabase Cron cada minuto y llama directamente a la Edge Function con el JWT de servicio guardado en Vault. La migración de traslado conserva la cola y el estado del cron; no activa entornos nuevos ni reinicia secuencias. El cron anterior de WhatsApp continúa pausado. La ruta de procesamiento en Vercel se retira.

## Comprobaciones antes de considerar el encargo terminado

- [ ] Registrar un contacto nuevo y comprobar que los tiempos parten de esa inscripción.
- [ ] Reservar con el mismo email y comprobar que se relaciona con el contacto.
- [ ] Probar la confirmación habitual y la variante de menos de 24 horas, sin duplicarlas.
- [ ] Mientras siga en pausa, responder «CONFIRMO» y comprobar que se registra la respuesta sin confirmar asistencia. Al reactivar, comprobar la aceptación en el destino acordado.
- [ ] Comprobar que una respuesta ambigua no acepta varias reservas.
- [ ] Definir y probar qué ocurre al no confirmar dentro del plazo acordado.
- [ ] Probar los recordatorios de 24 horas, 2 horas y 15 minutos, con el enlace real de la llamada.
- [ ] Reprogramar y cancelar: los recordatorios de la fecha anterior deben dejar de enviarse.
- [ ] Reservar durante la captación: los WhatsApp de captación pendientes deben detenerse.
- [ ] Responder durante la captación: el cierre de tres días debe detenerse.
- [ ] Comprobar los cuatro emails tanto con reserva como sin ella.
- [ ] Comprobar los consentimientos, BAJA/STOP y la baja por email.
- [ ] Verificar mensajes reales en el teléfono y buzón de prueba; un Ping test o la aceptación del proveedor no demuestran entrega.

## Texto íntegro aportado por el cliente

Se reproduce literalmente a continuación, incluidos los rótulos duplicados, las variables y las diferencias de nombres y duración. Este anexo conserva la fuente original del encargo.

```text
La gente deja sus datos en la web y luego

Reservan la llamada: 

Se les manda whatsapp de confirmación


¡Hola! Vi que reservaste tu sesión 🙌🏻
La idea de la llamada es:

- Entender bien tu caso y qué quieres mejorar.
- Detectar tus principales puntos de mejora.
- Valorar si realmente tiene sentido que trabajemos juntos.
- Si encaja, explicarte cómo trabajamos y cuál sería el siguiente paso.

Si vemos que podemos ayudarte de verdad, te explicaré cómo lo enfocaríamos contigo.
Tengo ganas de conocerte y analizar tu caso. Seguro que podemos sacar bastante en claro 😄


Recordatorio 24h antes. 

Mañana tenemos nuestra sesión. 🙌🏻
Reserva unos 45 minutos y, si puedes, entra desde un sitio tranquilo.
La idea es que salgamos de la llamada con bastante claridad sobre qué deberías trabajar y cómo hacerlo.
Para reservar ese espacio exclusivamente para ti, necesito que confirmes tu asistencia respondiendo “CONFIRMO” a este mensaje.
Si no recibimos confirmación, liberaremos automáticamente la plaza.

Si reservan menos de 24 horas antes.
¡Hola! Vi que reservaste tu sesión 🙌🏻
Te cuento lo que haremos: veremos tu caso, qué quieres mejorar y si tiene sentido que trabajemos juntos.
Reserva unos 45 minutos y entra desde un sitio tranquilo.
*Para mantener la sesión, respóndeme “CONFIRMO”. Si no recibimos confirmación, liberaremos la plaza.*
¡Nos vemos pronto!


Recordatorio 2h antes. VARIABLE LINK

Nos vemos en un par de horas 👌
Recuerda que si no has CONFIRMADO tu asistencia con antelación por este chat no se realizará la reunión.
Te dejo aquí el enlace para que lo tengas localizado:
[LINK DE MEET]


Recordatorio 15 min antes.

En 15 minutos empezamos. Nos vemos ahora.


No reservan llamada: 

1 hora despúes de apuntarse al webinar VARIABLE NOMBRE
Gracias por apuntarte a la clase [Nombre del registro]! ¿Pudiste verla entera? 👀

Antes de dejarlo ahí, dime un una cosa: ¿qué es lo que más estás buscando mejorar ahora mismo en tu comunicación?


1 días después 
Una de las cosas que más veo es gente que sabe perfectamente qué quiere decir, pero no consigue que su mensaje tenga el peso que debería. 🙌🏻
Si quieres que analicemos dónde te está pasando a ti, puedes reservar aquí:
[https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion]

3 días después (si no hay respuesta) 
Cierro por aquí para no llenarte de mensajes.
Si en algún momento decides que quieres trabajar seriamente tu comunicación, influencia o ventas, puedes reservar directamente desde el link que te pasé. Un abrazo! 🙌🏻

Secuencia de Emails 4 días (tanto si se apuntan como si no):

Email 1 - A la media hora de entrar al webinar 

Asunto: Quédate con esta idea de la masterclass que has visto.
Te escribo para hablarte  del vídeo en el que te muestro el sistema que utilizo para mejorar cómo comunicas, influyes y haces avanzar conversaciones importantes en reuniones, negociaciones, ventas y muchas otras situaciones..
Si ya lo viste, sabrás que al final te invito a agendar una llamada de consultoría. Puede que te preguntes: ¿qué pasa si agendo?
Lo primero que vas a ganar es CLARIDAD. Si ahora mismo sientes que sabes lo que quieres transmitir, pero no siempre consigues generar el impacto que buscas, esta llamada te ayudará a detectar dónde está el problema. En ella vemos:
En qué punto estás ahora mismo con tu comunicación.
Cómo estás proyectando autoridad, seguridad y confianza.
Qué ocurre en tus conversaciones de ventas, reuniones, negociaciones o presentaciones.
Qué deberías trabajar para comunicar con más criterio, adaptarte mejor y hacer avanzar esas conversaciones.
Si vemos que podemos ayudarte, te invitaremos a nuestra mentoría; si no, también te lo diremos. Al ser una llamada de valor, no sabemos cuánto tiempo más la ofreceremos gratis.
Agenda tu llamada aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
Un abrazo,
Ignacio Roa.
PD. Las plazas son limitadas. Agenda ahora, antes de que se llenen.


Email 2 -  Al día siguiente

Asunto: Te presento a Santiago, Maria y Mateo.
¡Hola, {{NOMBRE}}!
En la clase de esta semana te hablé de la importancia de cómo nos perciben los demás. Puedes tener una gran propuesta, dominar tu sector o saber perfectamente lo que quieres decir, pero si no consigues transmitir seguridad, autoridad y confianza, la conversación cambia por completo.
Por eso quiero presentarte a algunas de las personas con las que he trabajado y los cambios que han conseguido.
◉ Santiago. De explicar demasiado a cerrar reuniones con mucha más claridad.

Santiago dirige una empresa de servicios y sentía que en las reuniones comerciales daba demasiada información y perdía el control de la conversación. Trabajamos cómo leer mejor las señales del cliente, reducir explicación y adaptar las preguntas según el momento. Empezó a conducir las reuniones con mucha más estructura y a llegar antes a la decisión real del cliente.


◉ Maria. De ponerse nerviosa en presentaciones a transmitir seguridad y autoridad.

María tenía experiencia y conocimiento, pero cuando tenía que presentar delante de clientes o dirección aceleraba, justificaba demasiado sus ideas y perdía presencia. Trabajamos especialmente ritmo, pausas, lenguaje no verbal y estructura del mensaje. El cambio principal fue que empezó a comunicar sus ideas con mucha más calma, claridad y credibilidad.

◉ Mateo. De bloquearse ante las objeciones a saber conducirlas.

Álvaro trabaja en ventas y uno de sus principales problemas aparecía cuando el cliente decía “es caro” o “me lo tengo que pensar”. Su reacción era justificar inmediatamente la propuesta. Trabajamos cómo validar, explorar lo que había detrás de la objeción y adaptar la respuesta. Ahora utiliza esas objeciones para entender mejor al cliente y hacer avanzar la conversación en lugar de entrar a defenderse.

Estos son solo algunos ejemplos.
Agenda tu sesión aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
 y valoramos juntos cómo ayudarte.
Un abrazo,
Ignacio Roa.
PD. Si ellos pudieron cambiar la forma en la que afrontan sus conversaciones importantes, tú también puedes. Agenda tu sesión aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion




Email 4- A los dos días

Asunto: Esto es lo que me dice la mayoría de la gente: 
"Ojalá hubiese empezado antes"
¿Sabes qué me decía a mí mismo cuando sabía que tenía que mejorar mi forma de comunicar?
"Ya lo iré trabajando".
Que si necesitaba más experiencia, que si con el tiempo ganaría seguridad, que si ya aprendería a vender mejor sobre la marcha...
Hasta que entendí algo: comunicar mejor no suele ocurrir solo por acumular más años.
¿Y sabes qué aprendí? Que puedes tener conocimiento, experiencia e incluso una buena propuesta y seguir perdiendo oportunidades por cómo afrontas determinadas conversaciones.
Que estés leyendo esto significa que probablemente ya has detectado que hay algo que quieres mejorar.
Deja de esperar a que llegue solo: si quieres resultados distintos en tus conversaciones, tienes que empezar a comunicar de forma diferente.
Agenda una llamada conmigo aquí y vemos juntos qué deberías trabajar >>
https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
Si puedo ayudarte, te explicaré cómo. Si no, también te lo diré con total claridad.
Un abrazo,
Ignacio Roa.
PD. Si esto te ha resonado, no lo dejes para luego. Agenda tu llamada aquí >>
https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion

Email 4 - A los 3 días.

Asunto: Transferencia recibida.
Imagina recibir mensajes así todas las semanas.

Esto es lo que ocurre cuando empiezas a comunicar con más autoridad, leer mejor a la persona que tienes delante y adaptar tu forma de comunicar, tal y como te enseñé en la clase online. Comunicar mejor puede cambiar mucho más que una conversación:
Cerrar más oportunidades sin tener que perseguir tanto.
Defender mejor tu precio y reducir descuentos innecesarios.
Acortar reuniones que antes se alargaban sin llegar a nada.
Detectar antes cuándo una oportunidad es real y cuándo estás perdiendo el tiempo.
Negociar mejor condiciones, acuerdos y decisiones importantes.
Al final, comunicar mejor no solo mejora cómo te perciben.
También puede ayudarte a ganar más, perder menos tiempo y tomar mejores decisiones en conversaciones que tienen impacto directo en tu trabajo o negocio.
Si tienes dudas, agenda una llamada de claridad conmigo: 35 minutos para responder tus dudas. Elige un hueco en mi calendario aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
Un saludo,
Ignacio Roa.
PD. Cuanto antes agendes, antes puedes empezar a mejorar las conversaciones que más impacto tienen en tus resultados. Elige tu hueco aquí >> https://cal.com/ignacio-roa-chicharro-r7vym8/sesion-gratuita-comunicacion
```
