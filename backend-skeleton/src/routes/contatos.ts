import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const contatosRouter = Router();

// POST /api/contatos/opt-out
// Chamado pelo n8n quando o cliente manda SAIR/PARAR/CANCELAR/REMOVER.
contatosRouter.post("/opt-out", async (req, res) => {
  const { empresa_id, telefone } = req.body;

  if (!empresa_id || !telefone) {
    return res.status(400).json({ error: "empresa_id e telefone são obrigatórios" });
  }

  const { data: contato, error: findError } = await supabase
    .from("contatos")
    .select("id")
    .eq("empresa_id", empresa_id)
    .eq("telefone", telefone)
    .maybeSingle();

  if (findError) return res.status(500).json({ error: findError.message });
  if (!contato) return res.status(404).json({ error: "Contato não encontrado" });

  const { error: updateError } = await supabase
    .from("contatos")
    .update({ opt_in: false, data_opt_in: new Date().toISOString(), origem_opt_in: "whatsapp_keyword" })
    .eq("id", contato.id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  await supabase.from("opt_ins").insert({
    contato_id: contato.id,
    origem: "whatsapp_keyword",
    canal: "whatsapp",
  });

  return res.json({ ok: true });
});
