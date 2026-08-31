// Función serverless de Vercel. Corre en el servidor, nunca en el navegador,
// por eso aquí SÍ es seguro usar la API key (viene de una variable de entorno).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Falta configurar ANTHROPIC_API_KEY en Vercel (Settings > Environment Variables)" });
  }

  const { image, mediaType } = req.body || {};
  if (!image) {
    return res.status(400).json({ error: "Falta la imagen" });
  }

  const prompt = `Eres un asistente que extrae datos de boletas y facturas chilenas para Luis, dueño de dos negocios:
- DR Hogar: multiservicios para el hogar (eléctrico, gasfitería, limpieza, remodelaciones). Gastos típicos: material, combustible, herramientas, mano de obra.
- FPG: marca de ropa juvenil/deportiva. Gastos típicos: tela, confección, marketing, envíos.
También puede ser un gasto Personal (colación, comida, salida, transporte, salud), o un ingreso (venta, pago de cliente).

Analiza la imagen del documento y responde SOLO con un objeto JSON, sin texto adicional, sin markdown, con esta forma exacta:
{"monto": number, "fecha": "YYYY-MM-DD o null si no se ve", "comercio": "nombre del comercio o cliente", "tipo": "ingreso" o "egreso", "negocio_sugerido": "dr_hogar" o "fpg" o "personal", "categoria_sugerida": "una categoría corta en español"}
Si no puedes leer el monto, usa 0. Si no hay fecha visible, usa null.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Error de Anthropic" });
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("Sin respuesta de texto del modelo");

    const clean = textBlock.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Error desconocido" });
  }
}
