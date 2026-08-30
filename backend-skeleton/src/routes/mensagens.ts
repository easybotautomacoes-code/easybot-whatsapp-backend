import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const mensagensRouter = Router();

// POST /api/mensagens/enviar
// Chamado pelo Composer da Caixa de Entrada quando o atendente manda uma
// mensagem de texto. Grava em `mensagens` e dispara pela Cloud API da Meta.
mensagensRouter.post("/enviar", async (req, res) => {
  const { conversation_id, conteudo, atendente_id } = req.body;

  if (!conversation_id || !conteudo) {
    return res.status(400).json({ error: "conversation_id e conteudo são obrigatórios" });
  }

  const { data: conversa, error: conversaError } = await supabase
    .from("conversas")
    .select("id, contato_id, contatos(telefone)")
    .eq("id", conversation_id)
    .single();

  if (conversaError) return res.status(500).json({ error: conversaError.message });
  if (!conversa) return res.status(404).json({ error: "Conversa não encontrada" });

  const telefone = (conversa as any).contatos?.telefone;
  if (!telefone) return res.status(400).json({ error: "Contato sem telefone associado" });

  const { data: mensagem, error: mensagemError } = await supabase
    .from("mensagens")
    .insert({
      conversation_id,
      direcao: "outbound",
      tipo: "text",
      conteudo,
      status: "enviada",
      atendente_id: atendente_id || null,
      timestamp: new Date().toISOString(),
    })
    .select()
    .single();

  if (mensagemError) return res.status(500).json({ error: mensagemError.message });

  try {
    const respostaMeta = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.META_WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: telefone,
          type: "text",
          text: { body: conteudo },
        }),
      }
    );

    const dadosMeta = await respostaMeta.json();

    if (!respostaMeta.ok) {
      await supabase.from("mensagens").update({ status: "falhou", erro: JSON.stringify(dadosMeta) }).eq("id", mensagem.id);
      return res.status(502).json({ error: "Falha ao enviar pela Meta", detalhe: dadosMeta });
    }

    const wamid = dadosMeta.messages?.[0]?.id;
    const { data: mensagemAtualizada } = await supabase
      .from("mensagens")
      .update({ wamid })
      .eq("id", mensagem.id)
      .select()
      .single();

    return res.json({ mensagem: mensagemAtualizada || mensagem });
  } catch (err: any) {
    await supabase.from("mensagens").update({ status: "falhou", erro: err.message }).eq("id", mensagem.id);
    return res.status(502).json({ error: "Erro de rede ao chamar a Meta", detalhe: err.message });
  }
});
