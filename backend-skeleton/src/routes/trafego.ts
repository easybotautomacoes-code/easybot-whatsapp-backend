import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const trafegoRouter = Router();

// POST /api/trafego/registrar
// Lançamento manual de gasto com tráfego pago (você mesma informa o
// valor — não tem integração automática com o Meta Ads nessa fase).
trafegoRouter.post("/registrar", async (req, res) => {
  const { empresa_id, campanha, valor, data, observacoes } = req.body;

  if (!empresa_id || valor === undefined) {
    return res.status(400).json({ error: "empresa_id e valor são obrigatórios" });
  }

  const { data: gasto, error } = await supabase
    .from("gastos_trafego")
    .insert({
      empresa_id,
      campanha: campanha || null,
      valor,
      data: data || new Date().toISOString().slice(0, 10),
      observacoes: observacoes || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ gasto });
});

// GET /api/trafego/listar?empresa_id=...&data_inicio=...&data_fim=...
// Lista os lançamentos de gasto num período (pra exibir/editar numa tela).
trafegoRouter.get("/listar", async (req, res) => {
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let query = supabase
    .from("gastos_trafego")
    .select("*")
    .eq("empresa_id", empresa_id as string)
    .order("data", { ascending: false });

  if (data_inicio) query = query.gte("data", data_inicio as string);
  if (data_fim) query = query.lte("data", data_fim as string);

  const { data: gastos, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ gastos });
});
