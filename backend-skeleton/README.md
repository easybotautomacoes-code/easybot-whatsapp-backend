# EasyBot WhatsApp — backend (Fase 1)

Endpoints mínimos que o fluxo do n8n já chama:

- `POST /api/contatos/opt-out`
- `POST /api/conversas/find-or-create`
- `POST /api/conversas/atualizar-status`
- `POST /api/filas/notificar` (stub)

## Rodar local

```bash
npm install
cp .env.example .env   # preenche SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

Servidor sobe em `http://localhost:3000`. Teste com `curl http://localhost:3000/health`.

## Onde colocar isso

1. Cria um repositório no GitHub (ex.: `easybot-whatsapp-backend`) e sobe essa pasta nele.
2. No Railway: New Project → Deploy from GitHub repo → aponta pro repositório.
3. Em Railway, adiciona as variáveis de ambiente (as mesmas do `.env.example`) na aba Variables do serviço.
4. Railway te dá uma URL pública (tipo `https://easybot-whatsapp-backend-production.up.railway.app`) — essa é a `BACKEND_URL` que o n8n vai chamar.
5. O Supabase pode ser o **mesmo projeto** que você já usa no CRM interno da EasyBot — só rodar as migrations da Fase 1 nele (SQL Editor → colar `migrations-fase1.sql` → Run). Não precisa criar projeto novo.

## Ainda falta (próximas fases)

- Webhook de recebimento da Meta (GET de verificação + POST de mensagens) — ainda não está aqui, é o próximo passo.
- Fila de envio (Redis/BullMQ) — Fase 5.
- Autenticação dos endpoints (hoje estão abertos — ok para desenvolvimento, não para produção).
