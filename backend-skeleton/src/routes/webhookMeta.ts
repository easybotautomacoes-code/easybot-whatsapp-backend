import { Router } from "express";

export const webhookMetaRouter = Router();

// GET /webhook/whatsapp
// A Meta chama isso UMA VEZ quando você cadastra a URL do webhook no painel
// dela, pra confirmar que você é dono do endpoint. Tem que devolver
// exatamente o valor de hub.challenge, em texto puro, se o verify_token bater.
webhookMetaRouter.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// POST /webhook/whatsapp
// Aqui chegam as mensagens de verdade e as atualizações de status
// (enviada/entregue/lida/falhou). Responde 200 rápido pra Meta não
// re-tentar, e repassa o essencial pro n8n de forma assíncrona.
webhookMetaRouter.post("/whatsapp", async (req, res) => {
  // responde imediato — a Meta espera resposta rápida (<5s)
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const mensagemRecebida = value?.messages?.[0];
    const statusRecebido = value?.statuses?.[0];

    // Mensagem de cliente chegando -> repassa pro n8n processar
    if (mensagemRecebida) {
      const contatoInfo = value?.contacts?.[0];
      const empresa_id = process.env.EMPRESA_ID_PADRAO; // fixo por enquanto (single-tenant na Fase 1)

      const payloadParaN8n = {
        empresa_id,
        contato: {
          telefone: mensagemRecebida.from,
          nome: contatoInfo?.profile?.name || "",
        },
        mensagem: {
          tipo: mensagemRecebida.type,
          texto: mensagemRecebida.text?.body,
          interactive: mensagemRecebida.interactive,
        },
      };

      if (process.env.N8N_WEBHOOK_URL) {
        await fetch(process.env.N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadParaN8n),
        });
      }
    }

    // Atualização de status (entregue/lida/falhou) -> por enquanto só loga.
    // Na Fase 1 isso ainda não grava em `mensagens` porque a fila de envio
    // completa é só na Fase 5 — mas já deixamos o ponto de entrada pronto.
    if (statusRecebido) {
      console.log("[webhook] status recebido:", statusRecebido.status, statusRecebido.id);
    }
  } catch (err) {
    console.error("[webhook] erro processando evento:", err);
  }
});
