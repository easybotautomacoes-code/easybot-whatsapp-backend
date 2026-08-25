import "dotenv/config";
import express from "express";
import cors from "cors";
import { contatosRouter } from "./routes/contatos.js";
import { conversasRouter } from "./routes/conversas.js";
import { filasRouter } from "./routes/filas.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/contatos", contatosRouter);
app.use("/api/conversas", conversasRouter);
app.use("/api/filas", filasRouter);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Backend rodando na porta ${port}`);
});
