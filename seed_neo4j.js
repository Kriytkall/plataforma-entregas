// ============================================================
// SEED do grafo viario REAL (Neo4j Aura) - Cenario 3 (App de entregas)
// Importa a malha viaria de verdade de Gravatai/RS do OpenStreetMap
// (Overpass API) e carrega como GRAFO no Neo4j:
//   - Nos  :Esquina  -> cruzamentos reais (vertices das ruas do OSM)
//   - Nos  :Local    -> restaurante e cliente (pontos reais do MongoDB),
//                       "grudados" no cruzamento mais proximo
//   - Arestas :RUA {peso, nome} -> trecho de rua real;
//       peso = comprimento em metros (Haversine entre os 2 vertices)
//       nome = nome real da rua (tag "name" do OSM)
//
// Depois o backend roda apoc.algo.dijkstra sobre esse grafo -> a rota
// segue ruas DE VERDADE e mostra os nomes corretos.
//
// Rode UMA vez:  node seed_neo4j.js
// (baixa do OSM e salva em osm_gravatai.json; nas proximas vezes usa o cache)
// ============================================================
require("dotenv").config();
const fs = require("fs");
const neo4j = require("neo4j-driver");

// Caixa (bbox) ao redor do restaurante -> cliente, com folga
const BBOX = { S: -29.9525, W: -51.0030, N: -29.9405, E: -50.9880 };
// Pontos reais (mesmas coordenadas do MongoDB)
const REST = { id: "rest_010", nome: "Cantina do Gaúcho", lat: -29.9442, lng: -50.9925 };
const CLI  = { id: "cli_077",  nome: "Ana Lima",          lat: -29.9480, lng: -50.9980 };
const CACHE = "osm_gravatai.json";

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// Distancia em metros entre dois pontos {lat,lng}
function haversine(a, b) {
  const R = 6371000;
  const toRad = (g) => (g * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// ---- 1) Baixa (ou le do cache) as ruas do OpenStreetMap ----
async function baixarOSM() {
  if (fs.existsSync(CACHE)) {
    console.log("[OSM] usando cache local:", CACHE);
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  const q = `[out:json][timeout:60];
way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|road|tertiary_link|secondary_link)$"](${BBOX.S},${BBOX.W},${BBOX.N},${BBOX.E});
(._;>;);
out body;`;
  console.log("[OSM] baixando malha viaria de Gravatai (Overpass)...");
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(q),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "TrabalhoBD-Cenario3/1.0 (uso academico)",
    },
  });
  const txt = await r.text();
  if (!txt.trim().startsWith("{")) {
    throw new Error("Overpass nao retornou JSON: " + txt.slice(0, 120));
  }
  fs.writeFileSync(CACHE, txt);
  console.log("[OSM] baixado e salvo em", CACHE);
  return JSON.parse(txt);
}

// ---- 2) Constroi o grafo (nos + arestas) a partir do OSM ----
function construirGrafo(osm) {
  const coord = new Map(); // osmid -> {lat,lng}
  for (const el of osm.elements) {
    if (el.type === "node") coord.set(el.id, { lat: el.lat, lng: el.lon });
  }
  // Arestas: cada par de vertices consecutivos de uma "way" e um trecho de rua
  const edgeMap = new Map(); // "menor|maior" -> {a,b,peso,nome}
  for (const el of osm.elements) {
    if (el.type !== "way" || !el.nodes) continue;
    const nome = (el.tags && el.tags.name) || "(via sem nome)";
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = el.nodes[i], b = el.nodes[i + 1];
      if (!coord.has(a) || !coord.has(b)) continue;
      const k = a < b ? a + "|" + b : b + "|" + a;
      if (edgeMap.has(k)) continue;
      edgeMap.set(k, { a, b, peso: haversine(coord.get(a), coord.get(b)), nome });
    }
  }
  // Maior componente conexo (garante que da pra ir do restaurante ao cliente)
  const adj = new Map();
  for (const e of edgeMap.values()) {
    (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b);
    (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a);
  }
  const visto = new Set();
  let maior = new Set();
  for (const ini of adj.keys()) {
    if (visto.has(ini)) continue;
    const comp = new Set(), pilha = [ini];
    visto.add(ini);
    while (pilha.length) {
      const x = pilha.pop();
      comp.add(x);
      for (const y of adj.get(x) || []) if (!visto.has(y)) { visto.add(y); pilha.push(y); }
    }
    if (comp.size > maior.size) maior = comp;
  }
  const nodes = [...maior].map((id) => ({ osmid: id, ...coord.get(id) }));
  const edges = [...edgeMap.values()].filter((e) => maior.has(e.a) && maior.has(e.b));
  return { nodes, edges };
}

// No mais proximo de um ponto, dentro da lista
function maisProximo(ponto, nodes) {
  let best = null, bd = Infinity;
  for (const n of nodes) {
    const d = haversine(ponto, n);
    if (d < bd) { bd = d; best = n; }
  }
  return { node: best, dist: bd };
}

async function chunk(session, lista, tamanho, cypher, nomeParam) {
  for (let i = 0; i < lista.length; i += tamanho) {
    await session.run(cypher, { [nomeParam]: lista.slice(i, i + tamanho) });
  }
}

async function seed() {
  const osm = await baixarOSM();
  const { nodes, edges } = construirGrafo(osm);
  const restNear = maisProximo(REST, nodes);
  const cliNear = maisProximo(CLI, nodes);

  // Nos para o Neo4j: esquinas (OSM) + 2 locais
  const nosNeo = nodes.map((n) => ({ key: "n" + n.osmid, tipo: "Esquina", lat: n.lat, lng: n.lng, nome: null }));
  nosNeo.push({ key: REST.id, tipo: "Local", lat: REST.lat, lng: REST.lng, nome: REST.nome });
  nosNeo.push({ key: CLI.id, tipo: "Local", lat: CLI.lat, lng: CLI.lng, nome: CLI.nome });

  // Arestas: ruas reais + 2 "acessos" ligando restaurante/cliente a malha
  const arestasNeo = edges.map((e) => ({ a: "n" + e.a, b: "n" + e.b, peso: e.peso, nome: e.nome }));
  arestasNeo.push({ a: REST.id, b: "n" + restNear.node.osmid, peso: restNear.dist, nome: "(acesso)" });
  arestasNeo.push({ a: CLI.id, b: "n" + cliNear.node.osmid, peso: cliNear.dist, nome: "(acesso)" });

  const session = driver.session();
  try {
    console.log("[1/5] Limpando grafo antigo...");
    await session.run("MATCH (n) DETACH DELETE n");

    console.log("[2/5] Criando indice de busca...");
    await session.run("CREATE INDEX no_key IF NOT EXISTS FOR (n:No) ON (n.key)");

    console.log(`[3/5] Criando ${nosNeo.length} nos (esquinas reais + restaurante + cliente)...`);
    await chunk(session, nosNeo, 500,
      `UNWIND $batch AS n
       CALL apoc.create.node(['No', n.tipo], {key:n.key, lat:n.lat, lng:n.lng, nome:n.nome})
       YIELD node RETURN count(node)`, "batch");

    console.log(`[4/5] Criando ${arestasNeo.length} ruas (bidirecionais, com nome real)...`);
    await chunk(session, arestasNeo, 500,
      `UNWIND $batch AS e
       MATCH (a:No {key:e.a}), (b:No {key:e.b})
       CREATE (a)-[:RUA {peso: toFloat(e.peso), nome: e.nome}]->(b)
       CREATE (b)-[:RUA {peso: toFloat(e.peso), nome: e.nome}]->(a)`, "batch");

    console.log("[5/5] Testando Dijkstra (restaurante -> cliente)...");
    const r = await session.run(
      `MATCH (o:No {key:'rest_010'}), (d:No {key:'cli_077'})
       CALL apoc.algo.dijkstra(o, d, 'RUA>', 'peso') YIELD path, weight
       RETURN [rel IN relationships(path) | rel.nome] AS ruas, weight AS metros`
    );
    const rec = r.records[0];
    // nomes de rua distintos (em sequencia) so para o print
    const ruas = [];
    for (const nome of rec.get("ruas")) if (nome !== "(acesso)" && ruas[ruas.length - 1] !== nome) ruas.push(nome);

    console.log("\n===========================================");
    console.log("GRAFO VIARIO REAL CRIADO COM SUCESSO");
    console.log("Esquinas (nos):", nodes.length, "| Ruas (bidirecionais):", arestasNeo.length * 2);
    console.log("Restaurante grudado a", restNear.dist, "m da malha | Cliente a", cliNear.dist, "m");
    console.log("\nMelhor rota (Dijkstra) passa por:");
    ruas.forEach((n) => console.log("  -> " + n));
    console.log("Distancia total:", Math.round(rec.get("metros")), "metros");
    console.log("===========================================\n");
  } finally {
    await session.close();
    await driver.close();
  }
}

seed().catch((e) => {
  console.error("[ERRO no seed]:", e.message);
  process.exit(1);
});
