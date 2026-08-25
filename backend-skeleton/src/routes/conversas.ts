import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const conversasRouter = Router();

// POST /api/conversas/find-or-create
// Chamado pelo n8n em toda mensagem recebida. Garante que existe
// contato + conversa aberta para essa mensagem, e devolve status atual
// (bot / aguardando_humano / humano) para o n8n decidir o que fazer.
conversasRouter.post("/find-or-create", async (req, res) => {
  const { empresa_id, contato_telefone, contato_nome } = req.body;

  if (!empresa_id || !contato_telefone) {
    return res.status(400).json({ error: "empresa_id e contato_telefone são obrigatórios" });
  }

  // upsert do contato
  const { data: contato, error: contatoError } = await supabase
    .from("contatos")
    .upsert(
      {
        empresa_id,
        telefone: contato_telefone,
        nome: contato_nome || null,
        ultima_interacao: new Date().toISOString(),
      },
      { onConflict: "empresa_id,telefone" }
    )
    .select()
    .single();

  if (contatoError) return res.status(500).json({ error: contatoError.message });

  // procura conversa aberta (qualquer status != finalizado)
  const { data: conversaExistente, error: buscaError } = await supabase
    .from("conversas")
    .select("*")
    .eq("empresa_id", empresa_id)
    .eq("contato_id", contato.id)
    .neq("status", "finalizado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (buscaError) return res.status(500).json({ error: buscaError.message });

  if (conversaExistente) {
    return res.json({ conversa: conversaExistente, contato });
  }

  const { data: novaConversa, error: criaError } = await supabase
    .from("conversas")
    .insert({ empresa_id, contato_id: contato.id, status: "bot" })
    .select()
    .single();

  if (criaError) return res.status(500).json({ error: criaError.message });

  return res.json({ conversa: novaConversa, contato });
});

// POST /api/conversas/atualizar-status
// Chamado pelo n8n no handoff (bot -> aguardando_humano) e também
// pode ser usado pela Caixa de Entrada quando o atendente assume/finaliza.
conversasRouter.post("/atualizar-status", async (req, res) => {
  const { conversation_id, status, tag, setor } = req.body;

  if (!conversation_id || !status) {
    return res.status(400).json({ error: "conversation_id e status são obrigatórios" });
  }

  const permitido = ["bot", "aguardando_humano", "humano", "finalizado"];
  if (!permitido.includes(status)) {
    return res.status(400).json({ error: `status inválido, use um de: ${permitido.join(", ")}` });
  }

  const updatePayload: Record<string, unknown> = { status };
  if (tag) updatePayload.tag = tag;
  if (status === "finalizado") updatePayload.closed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversas")
    .update(updatePayload)
    .eq("id", conversation_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ conversa: data });
});
