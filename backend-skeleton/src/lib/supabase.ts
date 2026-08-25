import { createClient } from "@supabase/supabase-js";

// Usa a service_role key -> ignora RLS. É por isso que TODA query aqui
// precisa filtrar empresa_id manualmente, nunca confiar só no RLS
// quando o acesso vem por essa chave.
export const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);
