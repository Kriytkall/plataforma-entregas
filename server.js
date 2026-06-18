// ============================================================
// Backend da plataforma de entregas (Cenario 3)
// Camada do meio: o navegador fala com este servidor, e SO ESTE
// servidor fala com o MongoDB Atlas (a senha nunca vai pro navegador).
// ============================================================
require("dotenv").config();
const express = require("express");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;
const URI = process.env.MONGODB_URI;
const DB_NAME = "loja_entregas";

if (!URI) {
  console.error("\n[ERRO] Falta a variavel MONGODB_URI. Crie o arquivo .env (veja .env.example).\n");
  process.exit(1);
}

const client = new MongoClient(URI);
let db;

// Serve o frontend (pasta public)
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------
// API 1 - Todos os pontos do mapa (entregadores, restaurantes, clientes)
// ------------------------------------------------------------
app.get("/api/pontos", async (req, res) => {
  try {
    const [entregadores, restaurantes, clientes] = await Promise.all([
      db.collection("entregadores").find().toArray(),
      db.collection("restaurantes").find().toArray(),
      db.collection("clientes").find().toArray(),
    ]);
    res.json({ entregadores, restaurantes, clientes });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// API 2 - Entregadores DISPONIVEIS proximos de um ponto.
// Usa $geoNear (precisa do indice 2dsphere) e devolve a distancia.
// Parametros: ?lng=-50.99&lat=-29.94&raio=2000 (raio em metros)
// ------------------------------------------------------------
app.get("/api/proximos", async (req, res) => {
  try {
    const lng = parseFloat(req.query.lng);
    const lat = parseFloat(req.query.lat);
    const raio = parseFloat(req.query.raio) || 2000;
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ erro: "Informe lng e lat." });
    }
    const proximos = await db.collection("entregadores").aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distancia_m",
          maxDistance: raio,
          query: { status: "disponivel" },   // combina filtro espacial + comum
          spherical: true,
        },
      },
    ]).toArray();
    res.json({ raio, total: proximos.length, entregadores: proximos });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// Inicia: conecta no Atlas e SO ENTAO sobe o servidor web
// ------------------------------------------------------------
async function start() {
  try {
    await client.connect();
    db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    console.log("[OK] Conectado ao MongoDB Atlas (" + DB_NAME + ")");
    app.listen(PORT, () => {
      console.log("[OK] Plataforma no ar: http://localhost:" + PORT);
    });
  } catch (e) {
    console.error("[ERRO] Nao conectou no Atlas:", e.message);
    process.exit(1);
  }
}
start();
