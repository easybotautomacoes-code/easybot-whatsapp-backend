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
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let query = supabase.from("conversas").select("etapa_funil").eq("empresa_id", empresa_id as string);
  if (data_inicio) query = query.gte("created_at", data_inicio as string);
  if (data_fim) query = query.lte("created_at", data_fim as string);

  const { data: conversas, error } = await query;

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
  const { empresa_id, data_inicio, data_fim, ticket_medio } = req.query;

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

  // ROI só é calculado se você informar quanto vale, em média, um cliente
  // fechado (ticket_medio) — sem isso não tem como saber o retorno.
  let roi: number | null = null;
  if (ticket_medio) {
    const ticketNum = Number(ticket_medio);
    if (!isNaN(ticketNum) && totalGasto > 0) {
      const receitaEstimada = clientes * ticketNum;
      roi = Number((((receitaEstimada - totalGasto) / totalGasto) * 100).toFixed(1));
    }
  }

  return res.json({
    total_gasto: Number(totalGasto.toFixed(2)),
    total_leads: leads,
    total_clientes: clientes,
    custo_por_lead: leads > 0 ? Number((totalGasto / leads).toFixed(2)) : null,
    custo_por_cliente: clientes > 0 ? Number((totalGasto / clientes).toFixed(2)) : null,
    taxa_conversao_geral: leads > 0 ? Number(((clientes / leads) * 100).toFixed(1)) : null,
    roi_percentual: roi,
  });
});

// GET /api/dashboard/por-campanha?empresa_id=...&data_inicio=...&data_fim=...
// Cruza gasto e conversão campanha a campanha (não só o total geral).
dashboardRouter.get("/por-campanha", async (req, res) => {
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let queryGastos = supabase
    .from("gastos_trafego")
    .select("campanha, valor")
    .eq("empresa_id", empresa_id as string);
  if (data_inicio) queryGastos = queryGastos.gte("data", data_inicio as string);
  if (data_fim) queryGastos = queryGastos.lte("data", data_fim as string);

  const { data: gastos, error: gastosError } = await queryGastos;
  if (gastosError) return res.status(500).json({ error: gastosError.message });

  let queryContatos = supabase
    .from("contatos")
    .select("id, campanha, conversas(etapa_funil)")
    .eq("empresa_id", empresa_id as string);
  if (data_inicio) queryContatos = queryContatos.gte("primeira_interacao", data_inicio as string);
  if (data_fim) queryContatos = queryContatos.lte("primeira_interacao", data_fim as string);

  const { data: contatos, error: contatosError } = await queryContatos;
  if (contatosError) return res.status(500).json({ error: contatosError.message });

  const porCampanha: Record<string, { gasto: number; leads: number; clientes: number }> = {};

  for (const g of gastos || []) {
    const nome = g.campanha || "(sem campanha)";
    if (!porCampanha[nome]) porCampanha[nome] = { gasto: 0, leads: 0, clientes: 0 };
    porCampanha[nome].gasto += Number(g.valor);
  }

  for (const c of (contatos as any[]) || []) {
    const nome = c.campanha || "(sem campanha)";
    if (!porCampanha[nome]) porCampanha[nome] = { gasto: 0, leads: 0, clientes: 0 };
    porCampanha[nome].leads++;
    const virouCliente = (c.conversas || []).some((conv: any) => conv.etapa_funil === "cliente");
    if (virouCliente) porCampanha[nome].clientes++;
  }

  const resultado = Object.entries(porCampanha).map(([campanha, dados]) => ({
    campanha,
    gasto: Number(dados.gasto.toFixed(2)),
    leads: dados.leads,
    clientes: dados.clientes,
    custo_por_lead: dados.leads > 0 ? Number((dados.gasto / dados.leads).toFixed(2)) : null,
    taxa_conversao: dados.leads > 0 ? Number(((dados.clientes / dados.leads) * 100).toFixed(1)) : null,
  }));

  return res.json({ campanhas: resultado });
});

// GET /api/dashboard/perdas-por-etapa?empresa_id=...&data_inicio=...&data_fim=...
// De todo mundo que foi marcado como "perdido", em qual etapa do funil
// a pessoa estava logo antes de ser perdida (usando o histórico real,
// não só a foto atual).
dashboardRouter.get("/perdas-por-etapa", async (req, res) => {
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let query = supabase
    .from("funil_historico")
    .select("etapa_anterior, conversas!inner(empresa_id)")
    .eq("etapa_nova", "perdido")
    .eq("conversas.empresa_id", empresa_id as string);
  if (data_inicio) query = query.gte("mudado_em", data_inicio as string);
  if (data_fim) query = query.lte("mudado_em", data_fim as string);

  const { data: perdas, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const contagem: Record<string, number> = {};
  for (const p of (perdas as any[]) || []) {
    const etapa = p.etapa_anterior || "desconhecida";
    contagem[etapa] = (contagem[etapa] || 0) + 1;
  }

  const total = Object.values(contagem).reduce((a, b) => a + b, 0);
  const resultado = Object.entries(contagem).map(([etapa, quantidade]) => ({
    etapa,
    quantidade,
    percentual_do_total_perdido: total > 0 ? Number(((quantidade / total) * 100).toFixed(1)) : 0,
  }));

  return res.json({ perdas_por_etapa: resultado, total_perdido: total });
});

// GET /api/dashboard/tempo-resposta?empresa_id=...&data_inicio=...&data_fim=...
// Tempo médio entre o cliente pedir atendente (aguardando_humano_em) e
// a primeira mensagem de verdade de um atendente naquela conversa.
dashboardRouter.get("/tempo-resposta", async (req, res) => {
  const { empresa_id, data_inicio, data_fim } = req.query;

  if (!empresa_id) {
    return res.status(400).json({ error: "empresa_id é obrigatório" });
  }

  let query = supabase
    .from("conversas")
    .select("id, aguardando_humano_em")
    .eq("empresa_id", empresa_id as string)
    .not("aguardando_humano_em", "is", null);
  if (data_inicio) query = query.gte("aguardando_humano_em", data_inicio as string);
  if (data_fim) query = query.lte("aguardando_humano_em", data_fim as string);

  const { data: conversas, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const tempos: number[] = [];

  for (const c of conversas || []) {
    const { data: primeiraResposta } = await supabase
      .from("mensagens")
      .select("timestamp")
      .eq("conversation_id", c.id)
      .eq("direcao", "outbound")
      .not("atendente_id", "is", null)
      .gt("timestamp", c.aguardando_humano_em as string)
      .order("timestamp", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (primeiraResposta) {
      const diffMs =
        new Date(primeiraResposta.timestamp).getTime() - new Date(c.aguardando_humano_em as string).getTime();
      tempos.push(diffMs / 1000 / 60); // minutos
    }
  }

  const media = tempos.length > 0 ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;

  return res.json({
    tempo_medio_primeira_resposta_minutos: media !== null ? Number(media.toFixed(1)) : null,
    amostras: tempos.length,
  });
});
