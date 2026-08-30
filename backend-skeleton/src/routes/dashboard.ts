import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const dashboardRouter = Router();

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

// GET /api/dashboard/funil?empresa_id=...
// Quantas conversas tem em cada etapa do funil, e a taxa de conversão
// de uma etapa pra próxima (comparado com a etapa imediatamente anterior
// na ordem do funil — não conta "perdido" como etapa de progressão).
dashboardRouter.get("/funil", async (req, res) => {
  const { empresa_id } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  const { data: conversas, error } = await supabase
    .from("conversas")
    .select("etapa_funil")
    .eq("empresa_id", empresa_id as string);

  if (error) return res.status(500).json({ error: error.message });

  const contagem: Record<string, number> = {};
  for (const etapa of ORDEM_FUNIL) contagem[etapa] = 0;
  for (const c of conversas || []) {
    if (c.etapa_funil && contagem[c.etapa_funil] !== undefined) {
      contagem[c.etapa_funil]++;
    }
  }

  const etapasProgressao = ORDEM_FUNIL.filter((e) => e !== "perdido");
  const funil = etapasProgressao.map((etapa, index) => {
    const anterior = index === 0 ? null : etapasProgressao[index - 1];
    const totalAnterior = anterior ? contagem[anterior] : null;
    const taxa_conversao_da_anterior =
      totalAnterior && totalAnterior > 0 ? Number(((contagem[etapa] / totalAnterior) * 100).toFixed(1)) : null;

    return {
      etapa,
      total: contagem[etapa],
      taxa_conversao_da_anterior,
    };
  });

  return res.json({ funil, perdidos: contagem["perdido"] });
});

// GET /api/dashboard/metricas?empresa_id=...&data_inicio=...&data_fim=...
// Cruza gasto com tráfego (lançado manualmente) com leads gerados e
// clientes fechados no mesmo período, pra calcular custo por lead e
// custo por cliente.
dashboardRouter.get("/metricas", async (req, res) => {
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let queryGastos = supabase.from("gastos_trafego").select("valor").eq("empresa_id", empresa_id as string);
  if (data_inicio) queryGastos = queryGastos.gte("data", data_inicio as string);
  if (data_fim) queryGastos = queryGastos.lte("data", data_fim as string);

  const { data: gastos, error: gastosError } = await queryGastos;
  if (gastosError) return res.status(500).json({ error: gastosError.message });

  const totalGasto = (gastos || []).reduce((soma, g) => soma + Number(g.valor), 0);

  let queryContatos = supabase
    .from("contatos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresa_id as string);
  if (data_inicio) queryContatos = queryContatos.gte("primeira_interacao", data_inicio as string);
  if (data_fim) queryContatos = queryContatos.lte("primeira_interacao", data_fim as string);

  const { count: totalLeads, error: leadsError } = await queryContatos;
  if (leadsError) return res.status(500).json({ error: leadsError.message });

  const { count: totalClientes, error: clientesError } = await supabase
    .from("conversas")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresa_id as string)
    .eq("etapa_funil", "cliente");

  if (clientesError) return res.status(500).json({ error: clientesError.message });

  const leads = totalLeads || 0;
  const clientes = totalClientes || 0;

  return res.json({
    total_gasto: Number(totalGasto.toFixed(2)),
    total_leads: leads,
    total_clientes: clientes,
    custo_por_lead: leads > 0 ? Number((totalGasto / leads).toFixed(2)) : null,
    custo_por_cliente: clientes > 0 ? Number((totalGasto / clientes).toFixed(2)) : null,
    taxa_conversao_geral: leads > 0 ? Number(((clientes / leads) * 100).toFixed(1)) : null,
  });
});
