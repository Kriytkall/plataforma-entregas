// ============================================================
// SEED do MongoDB Atlas - Cenario 3 (App de entregas) - versao ENRIQUECIDA
// Roda em Node usando a mesma MONGODB_URI da plataforma (.env).
//   node seed_mongo.js
// Cria dados de Gravatai/RS com VARIOS pedidos em CLUSTERS, para que as
// consultas de "regiao" ($geoWithin) e "concentracao" (aggregation) fiquem
// visiveis no video. Mantem rest_010 e cli_077 com as MESMAS coordenadas
// (o grafo do Neo4j esta grudado nelas).
// ============================================================
require("dotenv").config();
const { MongoClient } = require("mongodb");

const URI = process.env.MONGODB_URI;
const DB = "loja_entregas";

// ---- Restaurantes (GeoJSON [lng, lat]) - espalhados pela cidade ----
const restaurantes = [
  { _id: "rest_010", nome: "Cantina do Gaúcho", categoria: "brasileira",
    local: { type: "Point", coordinates: [-50.9925, -29.9442] } },   // Centro
  { _id: "rest_020", nome: "Pizzaria Bella",    categoria: "pizzaria",
    local: { type: "Point", coordinates: [-50.9760, -29.9380] } },   // Nordeste
  { _id: "rest_030", nome: "Sushi Centro",      categoria: "japonesa",
    local: { type: "Point", coordinates: [-51.0080, -29.9560] } },   // Sudoeste
];

// ---- Entregadores - espalhados ----
const entregadores = [
  { _id: "ent_001", nome: "Carlos Souza", veiculo: "moto",      status: "disponivel",
    local: { type: "Point", coordinates: [-50.9890, -29.9410] } },
  { _id: "ent_002", nome: "Marina Alves", veiculo: "bicicleta", status: "disponivel",
    local: { type: "Point", coordinates: [-50.9990, -29.9520] } },
  { _id: "ent_003", nome: "João Pinto",   veiculo: "moto",      status: "ocupado",
    local: { type: "Point", coordinates: [-51.0100, -29.9620] } },
  { _id: "ent_004", nome: "Pedro Rocha",  veiculo: "moto",      status: "disponivel",
    local: { type: "Point", coordinates: [-50.9930, -29.9460] } },
  { _id: "ent_005", nome: "Lúcia Dias",   veiculo: "carro",     status: "ocupado",
    local: { type: "Point", coordinates: [-50.9820, -29.9430] } },
  { _id: "ent_006", nome: "Rafael Lima",  veiculo: "moto",      status: "disponivel",
    local: { type: "Point", coordinates: [-50.9970, -29.9390] } },
];

// ---- Clientes - espalhados ----
const clientes = [
  { _id: "cli_077", nome: "Ana Lima",    endereco: "Rua Barão do Cerro Largo, 123",
    local: { type: "Point", coordinates: [-50.9980, -29.9480] } },
  { _id: "cli_088", nome: "Bruno Costa", endereco: "Bairro Bom Sucesso",
    local: { type: "Point", coordinates: [-50.9850, -29.9400] } },
  { _id: "cli_099", nome: "Carla Mota",  endereco: "Vila Sinimbu",
    local: { type: "Point", coordinates: [-51.0050, -29.9520] } },
  { _id: "cli_101", nome: "Diego Reis",  endereco: "Parque Florido",
    local: { type: "Point", coordinates: [-50.9780, -29.9550] } },
];

// ---- Pedidos em 3 CLUSTERS (a chave das consultas 3 e 4) ----
// Centro = MUITOS (concentracao alta) | Oeste = alguns | Sul = poucos/afastados
const pedidosBrutos = [
  // Cluster CENTRO (9) - lat ~ -29.944 / lng ~ -50.992
  ["cli_088", "rest_010", "ent_004", "em_entrega", 59.9,  [-50.9928, -29.9443]],
  ["cli_099", "rest_010", "ent_001", "entregue",   42.0,  [-50.9920, -29.9448]],
  ["cli_088", "rest_020", "ent_004", "entregue",   71.5,  [-50.9933, -29.9446]],
  ["cli_099", "rest_030", "ent_006", "em_entrega", 33.0,  [-50.9915, -29.9441]],
  ["cli_088", "rest_010", "ent_001", "entregue",   88.2,  [-50.9930, -29.9448]],
  ["cli_099", "rest_030", "ent_006", "entregue",   25.9,  [-50.9910, -29.9447]],
  ["cli_088", "rest_020", "ent_005", "em_entrega", 64.0,  [-50.9938, -29.9444]],
  ["cli_099", "rest_010", "ent_004", "entregue",   47.7,  [-50.9922, -29.9438]],
  ["cli_088", "rest_030", "ent_006", "entregue",   52.3,  [-50.9926, -29.9446]],
  // Cluster NORDESTE (4) - regiao do Bom Sucesso
  ["cli_088", "rest_020", "ent_006", "em_entrega", 59.9,  [-50.9790, -29.9370]],
  ["cli_088", "rest_020", "ent_005", "entregue",   38.0,  [-50.9785, -29.9375]],
  ["cli_088", "rest_020", "ent_006", "entregue",   95.0,  [-50.9795, -29.9368]],
  ["cli_101", "rest_020", "ent_005", "entregue",   41.0,  [-50.9788, -29.9378]],
  // Cluster SUDOESTE (2) - afastado
  ["cli_099", "rest_030", "ent_003", "entregue",   73.0,  [-51.0060, -29.9565]],
  ["cli_099", "rest_030", "ent_003", "em_entrega", 60.0,  [-51.0055, -29.9575]],
];

const pedidos = pedidosBrutos.map((p, i) => ({
  _id: "ped_" + (5001 + i),
  cliente_id: p[0], restaurante_id: p[1], entregador_id: p[2],
  status: p[3], valor: p[4],
  criado_em: new Date(2026, 5, 10 + (i % 10), 18 + (i % 5), (i * 7) % 60),
  local_entrega: { type: "Point", coordinates: p[5] },
}));

async function run() {
  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB);
  try {
    console.log("[1/3] Limpando e inserindo colecoes...");
    for (const [nome, dados] of [
      ["restaurantes", restaurantes], ["entregadores", entregadores],
      ["clientes", clientes], ["pedidos", pedidos],
    ]) {
      await db.collection(nome).deleteMany({});
      await db.collection(nome).insertMany(dados);
    }

    console.log("[2/3] Criando indices 2dsphere...");
    await db.collection("entregadores").createIndex({ local: "2dsphere" });
    await db.collection("restaurantes").createIndex({ local: "2dsphere" });
    await db.collection("clientes").createIndex({ local: "2dsphere" });
    await db.collection("pedidos").createIndex({ local_entrega: "2dsphere" });

    console.log("[3/3] Conferindo...");
    const counts = {
      restaurantes: await db.collection("restaurantes").countDocuments(),
      entregadores: await db.collection("entregadores").countDocuments(),
      clientes: await db.collection("clientes").countDocuments(),
      pedidos: await db.collection("pedidos").countDocuments(),
    };
    console.log("Contagens:", counts);

    // Verifica consulta de REGIAO (poligono do Centro) -> deve dar 9
    const regiao = {
      type: "Polygon",
      coordinates: [[[-50.9945, -29.9435], [-50.9905, -29.9435],
                     [-50.9905, -29.9460], [-50.9945, -29.9460], [-50.9945, -29.9435]]],
    };
    const naRegiao = await db.collection("pedidos")
      .countDocuments({ local_entrega: { $geoWithin: { $geometry: regiao } } });
    console.log("Pedidos na regiao Centro ($geoWithin):", naRegiao);

    // Verifica CONCENTRACAO (celula ~1km) -> top deve ser o Centro
    const conc = await db.collection("pedidos").aggregate([
      { $group: {
          _id: {
            lat: { $round: [{ $arrayElemAt: ["$local_entrega.coordinates", 1] }, 2] },
            lng: { $round: [{ $arrayElemAt: ["$local_entrega.coordinates", 0] }, 2] },
          },
          total: { $sum: 1 },
      } },
      { $sort: { total: -1 } },
    ]).toArray();
    console.log("Concentracao por celula:", JSON.stringify(conc));

    console.log("\n[OK] MongoDB enriquecido com sucesso.");
  } finally {
    await client.close();
  }
}

run().catch((e) => { console.error("[ERRO]:", e.message); process.exit(1); });
