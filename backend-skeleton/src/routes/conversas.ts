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
    // 2ª mensagem em diante: se ainda tava como novo_lead, isso já é
    // contato iniciado de verdade (a pessoa respondeu ao bot).
    if (conversaExistente.etapa_funil === "novo_lead") {
      const { data: conversaAvancada } = await supabase
        .from("conversas")
        .update({ etapa_funil: "contato_iniciado" })
        .eq("id", conversaExistente.id)
        .select()
        .single();

      await supabase.from("funil_historico").insert({
        conversa_id: conversaExistente.id,
        etapa_anterior: "novo_lead",
        etapa_nova: "contato_iniciado",
        mudado_por: null, // automático
      });

      return res.json({ conversa: conversaAvancada || conversaExistente, contato });
    }

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
// Chamado pelo n8n no handoff (bot -> aguardando_humano), pra marcar só
// o segmento/tag (sem mudar status), e também usado pela Caixa de Entrada
// quando o atendente assume/finaliza.
const ORDEM_FUNIL = [
  "novo_lead",
  "contato_iniciado",
  "qualificado",
  "demonstracao",
  "proposta_enviada",
  "negociacao",
  "cliente",
  "perdido",
];

conversasRouter.post("/atualizar-status", async (req, res) => {
  const { conversation_id, status, tag, setor } = req.body;

  if (!conversation_id) {
    return res.status(400).json({ error: "conversation_id é obrigatório" });
  }

  const permitido = ["bot", "aguardando_humano", "humano", "finalizado"];
  if (status && !permitido.includes(status)) {
    return res.status(400).json({ error: `status inválido, use um de: ${permitido.join(", ")}` });
  }

  const { data: conversaAtual, error: buscaError } = await supabase
    .from("conversas")
    .select("etapa_funil")
    .eq("id", conversation_id)
    .single();

  if (buscaError) return res.status(500).json({ error: buscaError.message });

  const updatePayload: Record<string, unknown> = {};
  if (status) updatePayload.status = status;
  if (tag) updatePayload.tag = tag;
  if (status === "finalizado") updatePayload.closed_at = new Date().toISOString();

  // Pedir atendente é um sinal real de interesse — avança pra "qualificado"
  // automaticamente, mas só se a etapa atual ainda estiver mais atrás
  // (nunca regride quem já tá em negociação, por exemplo).
  if (status === "aguardando_humano") {
    const etapaAtualIndex = ORDEM_FUNIL.indexOf(conversaAtual?.etapa_funil || "novo_lead");
    const qualificadoIndex = ORDEM_FUNIL.indexOf("qualificado");
    if (etapaAtualIndex < qualificadoIndex) {
      updatePayload.etapa_funil = "qualificado";
    }
    updatePayload.aguardando_humano_em = new Date().toISOString();
  }

  if (Object.keys(updatePayload).length === 0) {
    return res.status(400).json({ error: "envie ao menos status ou tag pra atualizar" });
  }

  const { data, error } = await supabase
    .from("conversas")
    .update(updatePayload)
    .eq("id", conversation_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  if (updatePayload.etapa_funil) {
    await supabase.from("funil_historico").insert({
      conversa_id: conversation_id,
      etapa_anterior: conversaAtual?.etapa_funil || null,
      etapa_nova: updatePayload.etapa_funil,
      mudado_por: null, // automático
    });
  }

  return res.json({ conversa: data });
});

// POST /api/conversas/verificar-timeout
// Chamado periodicamente (a cada 15 min, via Schedule Trigger no n8n).
// Devolve pro bot qualquer conversa que ficou "aguardando_humano" por mais
// de 2h sem nenhum atendente assumir.
conversasRouter.post("/verificar-timeout", async (req, res) => {
  const horasLimite = 2;
  const limite = new Date(Date.now() - horasLimite * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("conversas")
    .update({ status: "bot" })
    .eq("status", "aguardando_humano")
    .lt("updated_at", limite)
    .select("id");

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, conversas_revertidas: data?.length || 0 });
});

// POST /api/conversas/atualizar-funil
// Chamado pela Ficha do Cliente na Caixa de Entrada quando o atendente
// muda a etapa do funil comercial (Novo lead -> Contato iniciado -> ... -> Cliente/Perdido).
// Grava histórico da mudança em `funil_historico`.
const ETAPAS_FUNIL = [
  "novo_lead",
  "contato_iniciado",
  "qualificado",
  "demonstracao",
  "proposta_enviada",
  "negociacao",
  "cliente",
  "perdido",
];

conversasRouter.post("/atualizar-funil", async (req, res) => {
  const { conversation_id, etapa_funil, mudado_por } = req.body;

  if (!conversation_id || !etapa_funil) {
    return res.status(400).json({ error: "conversation_id e etapa_funil são obrigatórios" });
  }

  if (!ETAPAS_FUNIL.includes(etapa_funil)) {
    return res.status(400).json({ error: `etapa_funil inválida, use uma de: ${ETAPAS_FUNIL.join(", ")}` });
  }

  const { data: conversaAtual, error: buscaError } = await supabase
    .from("conversas")
    .select("etapa_funil")
    .eq("id", conversation_id)
    .single();

  if (buscaError) return res.status(500).json({ error: buscaError.message });

  const { data: conversaAtualizada, error: updateError } = await supabase
    .from("conversas")
    .update({ etapa_funil })
    .eq("id", conversation_id)
    .select()
    .single();

  if (updateError) return res.status(500).json({ error: updateError.message });

  await supabase.from("funil_historico").insert({
    conversa_id: conversation_id,
    etapa_anterior: conversaAtual?.etapa_funil || null,
    etapa_nova: etapa_funil,
    mudado_por: mudado_por || null,
  });

  return res.json({ conversa: conversaAtualizada });
});

// POST /api/conversas/agendar-followup
// Chamado pela Ficha do Cliente / Kanban quando o atendente define (ou
// remove, mandando null) uma data pra retomar contato com o lead.
conversasRouter.post("/agendar-followup", async (req, res) => {
  const { conversation_id, proximo_followup } = req.body;

  if (!conversation_id) {
    return res.status(400).json({ error: "conversation_id é obrigatório" });
  }

  const { data, error } = await supabase
    .from("conversas")
    .update({
      proximo_followup: proximo_followup || null,
      followup_notificado: false, // reseta: nova data = pode notificar de novo
    })
    .eq("id", conversation_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ conversa: data });
});

// POST /api/conversas/verificar-followups
// Chamado periodicamente pelo n8n (ex.: a cada 30 min). Acha follow-ups
// vencidos e ainda não notificados, manda um lembrete via WhatsApp pro
// atendente responsável (ou pro telefone_notificacao dele) e marca como
// notificado pra não repetir.
conversasRouter.post("/verificar-followups", async (req, res) => {
  const agora = new Date().toISOString();

  const { data: vencidos, error } = await supabase
    .from("conversas")
    .select("id, proximo_followup, atendente_id, contatos(nome, telefone), atendentes(telefone_notificacao, nome)")
    .lte("proximo_followup", agora)
    .eq("followup_notificado", false)
    .not("proximo_followup", "is", null);

  if (error) return res.status(500).json({ error: error.message });
  if (!vencidos || vencidos.length === 0) {
    return res.json({ ok: true, notificados: 0 });
  }

  let notificados = 0;

  for (const conversa of vencidos as any[]) {
    const telefoneAtendente = conversa.atendentes?.telefone_notificacao;
    if (!telefoneAtendente) continue;

    const nomeContato = conversa.contatos?.nome || "um contato";
    const telefoneContato = conversa.contatos?.telefone || "";

    try {
      await fetch(`https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.META_WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: telefoneAtendente,
          type: "text",
          text: {
            body: `⏰ Lembrete de follow-up: ${nomeContato} (${telefoneContato}) está esperando retorno.`,
          },
        }),
      });

      await supabase.from("conversas").update({ followup_notificado: true }).eq("id", conversa.id);
      notificados++;
    } catch (err) {
      console.error("[followup] erro ao notificar:", err);
    }
  }

  return res.json({ ok: true, notificados });
});
