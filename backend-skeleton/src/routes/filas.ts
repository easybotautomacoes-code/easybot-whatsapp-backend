import { Router } from "express";

export const filasRouter = Router();

// POST /api/filas/notificar
// Stub por enquanto. A notificação em tempo real na Caixa de Entrada
// (item 17 do escopo) já acontece de graça via Supabase Realtime, porque
// o frontend assina mudanças na tabela `conversas`. Esse endpoint fica
// reservado para o que Realtime não cobre sozinho: push notification,
// e-mail para o atendente, som customizado por setor, etc — a implementar
// na Fase 2/3 quando a Caixa de Entrada existir.
filasRouter.post("/notificar", async (req, res) => {
  const { conversation_id, setor } = req.body;
  console.log(`[filas] conversa ${conversation_id} aguardando setor ${setor}`);
  return res.json({ ok: true, note: "stub — Realtime já cobre a notificação básica na inbox" });
});
