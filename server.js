// ============================================================
// Backend da plataforma de entregas (Cenario 3)
// Camada do meio: o navegador fala com este servidor, e SO ESTE
// servidor fala com o MongoDB Atlas (a senha nunca vai pro navegador).
// ============================================================
require("dotenv").config();
const express = require("express");
const path = require("path");
const { MongoClient } = require("mongodb");
const neo4j = require("neo4j-driver");

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

// ------------------------------------------------------------
// Neo4j Aura (grafo) - usado SO para a "melhor rota" (Dijkstra).
// Persistencia poliglota: Mongo p/ geo + Neo4j p/ grafo.
// ------------------------------------------------------------
const neoDriver =
  process.env.NEO4J_URI
    ? neo4j.driver(
        process.env.NEO4J_URI,
        neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
      )
    : null;

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
// API 3 - MELHOR ROTA (Neo4j, grafo). Caminho de menor custo entre
// dois pontos usando apoc.algo.dijkstra sobre as ruas (:RUA {peso}).
// Parametros: ?origem=rest_010&destino=cli_077
// Devolve a sequencia de paradas (lat/lng) e a distancia total em metros.
// ------------------------------------------------------------
// Uma PERNA da rota: encaixa origem e destino (coordenadas livres) no
// cruzamento real mais proximo (point.distance) e roda o Dijkstra entre eles.
const CYPHER_LEG =
  "WITH point({latitude:$fromLat, longitude:$fromLng}) AS pa,\n" +
  "     point({latitude:$toLat,   longitude:$toLng})   AS pb\n" +
  "MATCH (a:No) WHERE a.lat IS NOT NULL\n" +
  "WITH pa, pb, a ORDER BY point.distance(pa, point({latitude:a.lat, longitude:a.lng})) ASC LIMIT 1\n" +
  "MATCH (b:No) WHERE b.lat IS NOT NULL\n" +
  "WITH pa, pb, a, b ORDER BY point.distance(pb, point({latitude:b.lat, longitude:b.lng})) ASC LIMIT 1\n" +
  "CALL apoc.algo.dijkstra(a, b, 'RUA>', 'peso') YIELD path, weight\n" +
  "RETURN [n IN nodes(path) | {lat:n.lat, lng:n.lng}] AS geometria,\n" +
  "       [rel IN relationships(path) | rel.nome] AS ruasSeq,\n" +
  "       weight AS metros";

app.get("/api/rota", async (req, res) => {
  if (!neoDriver) {
    return res.status(503).json({ erro: "Neo4j nao configurado (faltam variaveis NEO4J_*)." });
  }
  // pts = "lng,lat;lng,lat;..." (2 ou mais pontos). Sem pts: restaurante -> cliente.
  let pts;
  if (req.query.pts) {
    pts = req.query.pts.split(";")
      .map((s) => s.split(",").map(Number))
      .filter((p) => p.length === 2 && p.every((n) => !Number.isNaN(n)));
  } else {
    pts = [[-50.9925, -29.9442], [-50.9980, -29.9480]]; // rest_010 -> cli_077 [lng,lat]
  }
  if (pts.length < 2) {
    return res.status(400).json({ erro: "Informe pelo menos 2 pontos (pts=lng,lat;lng,lat)." });
  }

  const session = neoDriver.session();
  try {
    let geometria = [];
    const ruas = [];
    const legs = [];
    let metrosTotal = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const [fromLng, fromLat] = pts[i];
      const [toLng, toLat] = pts[i + 1];
      const r = await session.run(CYPHER_LEG, { fromLat, fromLng, toLat, toLng });
      if (r.records.length === 0) {
        return res.status(404).json({ erro: "Nenhuma rota encontrada entre os pontos." });
      }
      const rec = r.records[0];
      const geo = rec.get("geometria");
      // nao duplica o ponto de juncao entre pernas
      if (geometria.length > 0 && geo.length > 0) geo.shift();
      geometria = geometria.concat(geo);
      for (const nome of rec.get("ruasSeq")) {
        if (nome === "(acesso)") continue;
        if (ruas[ruas.length - 1] !== nome) ruas.push(nome);
      }
      const metros = rec.get("metros");
      metrosTotal += metros;
      legs.push({ metros: Math.round(metros) });
    }

    // faz a linha tocar exatamente o ponto inicial (entregador) e final (cliente)
    const first = pts[0], last = pts[pts.length - 1];
    geometria.unshift({ lat: first[1], lng: first[0] });
    geometria.push({ lat: last[1], lng: last[0] });

    res.json({
      distancia_m: Math.round(metrosTotal),
      ruas,            // nomes reais das ruas, em ordem
      geometria,       // pontos lat/lng p/ desenhar a linha (segue as ruas)
      legs,            // distancia de cada perna (ex.: ent->rest, rest->cli)
      cypher: CYPHER_LEG,
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  } finally {
    await session.close();
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
    if (neoDriver) {
      try {
        await neoDriver.getServerInfo();
        console.log("[OK] Conectado ao Neo4j Aura (grafo / melhor rota)");
      } catch (e) {
        console.warn("[AVISO] Neo4j nao respondeu:", e.message, "- /api/rota ficara indisponivel.");
      }
    } else {
      console.warn("[AVISO] NEO4J_* nao definido - /api/rota desativado (so MongoDB).");
    }
    app.listen(PORT, () => {
      console.log("[OK] Plataforma no ar: http://localhost:" + PORT);
    });
  } catch (e) {
    console.error("[ERRO] Nao conectou no Atlas:", e.message);
    process.exit(1);
  }
}
start();
