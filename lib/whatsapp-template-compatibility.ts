export type MetaTemplateButton = { type?: string; text?: string; url?: string };
export type MetaTemplateComponent = { type?: string; text?: string; buttons?: MetaTemplateButton[] };

function isStaticUrlButton(button: MetaTemplateButton) {
  if (button?.type !== "URL" || typeof button.text !== "string" || !button.text.trim() || typeof button.url !== "string" || /[{}]/.test(button.url)) return false;
  try {
    return ["https:", "http:"].includes(new URL(button.url).protocol);
  } catch { return false; }
}

export function welcomeIncompatibility({ body, components, parameterFormat }: {
  body: string; components: MetaTemplateComponent[]; parameterFormat?: string;
}): string | null {
  if (!body.trim()) return "La plantilla no tiene cuerpo de texto.";
  if (body.length > 4096) return "El cuerpo de la plantilla supera los 4096 caracteres.";
  if (parameterFormat === "NAMED") return "La plantilla usa variables con nombre; la bienvenida admite únicamente {{1}} para el nombre del contacto.";
  if (/[{}]/.test(body.replace("{{1}}", ""))) return "El cuerpo debe ser texto fijo o contener una única variable {{1}} para el nombre del contacto, sin repetirla.";
  if (components.filter((c) => c?.type === "BODY").length !== 1) return "La plantilla debe tener un único cuerpo de texto.";
  if (components.some((c) => c?.type === "HEADER")) return "La bienvenida todavía no admite cabeceras ni contenido multimedia.";
  if (components.some((c) => c?.type === "FOOTER")) return "La bienvenida todavía no admite pies de página.";
  if (components.some((c) => !["BODY", "BUTTONS"].includes(c?.type ?? ""))) return "La plantilla contiene componentes que la bienvenida todavía no admite.";
  const buttonComponents = components.filter((c) => c.type === "BUTTONS");
  if (buttonComponents.length > 1) return "La plantilla tiene más de un grupo de botones.";
  for (const component of buttonComponents) {
    if (!Array.isArray(component.buttons) || !component.buttons.length || component.buttons.length > 10) return "El grupo de botones de la plantilla no tiene un formato válido.";
    for (const button of component.buttons) {
      if (button?.type === "URL" && typeof button.url === "string" && /[{}]/.test(button.url)) return "El botón tiene una URL variable y necesita un valor que la bienvenida todavía no proporciona.";
      if (!isStaticUrlButton(button)) return "La bienvenida admite botones de enlace con una URL fija; este botón tiene otro formato.";
    }
  }
  return null;
}

export function staticUrlButtons(components: MetaTemplateComponent[]) {
  return components.flatMap((c) => c?.type === "BUTTONS" && Array.isArray(c.buttons)
    ? c.buttons.filter(isStaticUrlButton) : []);
}
