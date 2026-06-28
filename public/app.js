// ============================================================
// Frontend: desenha o mapa e conversa com o backend (nunca com o banco direto)
// ============================================================

// Centro de Gravatai/RS  [latitude, longitude] (o Leaflet usa lat, lng!)
const CENTRO = [-29.9442, -50.9925];
const map = L.map("map").setView(CENTRO, 14);

// Camada de mapa CLEAN (CartoDB Positron) - minimalista, so ruas, sem chave de API
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap © CARTO",
  subdomains: "abcd",
  maxZoom: 20,
}).addTo(map);

// Cores por tipo/status
const COR = { disponivel: "#2e9e4f", ocupado: "#999999", restaurante: "#e8821e", cliente: "#2b6cb0" };

// Camadas que vamos limpar/redesenhar
let camadaEntregadores = L.layerGroup().addTo(map);
let camadaFixos = L.layerGroup().addTo(map);
let circuloBusca = null;

let cacheEntregadores = [];          // todos os entregadores (pra nao buscar de novo a cada ajuste)
let cacheRestaurantes = [];          // usados para escolher destino da rota
let cacheClientes = [];
let restauranteSelecionado = null;   // {lng, lat, nome} do ultimo restaurante clicado

const raioInput = document.getElementById("raio");
const raioVal = document.getElementById("raioVal");
const resultadosDiv = document.getElementById("resultados");

// Mexer no raio atualiza o numero E refaz a busca ao vivo (se ja houver restaurante selecionado)
raioInput.addEventListener("input", () => {
  raioVal.textContent = raioInput.value;
  if (restauranteSelecionado) {
    buscarProximos(restauranteSelecionado.lng, restauranteSelecionado.lat, restauranteSelecionado.nome);
  }
});

// Cria um marcador redondo colorido
function bolinha(lat, lng, cor, raio = 9) {
  return L.circleMarker([lat, lng], {
    radius: raio, fillColor: cor, color: "#fff", weight: 2, fillOpacity: 0.95,
  });
}

// GeoJSON guarda [lng, lat]; o Leaflet quer [lat, lng] -> invertemos aqui
function latlng(doc) {
  const [lng, lat] = doc.local.coordinates;
  return [lat, lng];
}

// ---------------- Carrega todos os pontos ----------------
async function carregarPontos() {
  try {
    const r = await fetch("/api/pontos");
    const { entregadores, restaurantes, clientes } = await r.json();

    cacheEntregadores = entregadores;   // guarda pra reusar nas buscas
    cacheRestaurantes = restaurantes;
    cacheClientes = clientes;
    camadaFixos.clearLayers();
    camadaEntregadores.clearLayers();

    // Restaurantes (clicaveis -> disparam a busca de proximidade)
    restaurantes.forEach((rest) => {
      const [lat, lng] = latlng(rest);
      const m = bolinha(lat, lng, COR.restaurante, 11)
        .bindPopup(`🍽️ <b>${rest.nome}</b><br>${rest.categoria || ""}<br><i>clique para buscar entregadores</i>`)
        .addTo(camadaFixos);
      m.on("click", () => buscarProximos(lng, lat, rest.nome));
    });

    // Clientes
    clientes.forEach((cli) => {
      const [lat, lng] = latlng(cli);
      bolinha(lat, lng, COR.cliente, 8)
        .bindPopup(`🏠 <b>${cli.nome}</b><br>${cli.endereco || ""}`)
        .addTo(camadaFixos);
    });

    // Entregadores (cor pelo status)
    desenharEntregadores(entregadores);
  } catch (e) {
    resultadosDiv.innerHTML = `<div class="erro">Falha ao carregar dados: ${e.message}</div>`;
  }
}

function desenharEntregadores(lista, destacarIds = []) {
  camadaEntregadores.clearLayers();
  lista.forEach((ent) => {
    const [lat, lng] = latlng(ent);
    const cor = ent.status === "disponivel" ? COR.disponivel : COR.ocupado;
    const destaque = destacarIds.includes(ent._id);
    const m = bolinha(lat, lng, cor, destaque ? 13 : 9)
      .bindPopup(`🛵 <b>${ent.nome}</b><br>${ent.veiculo} · ${ent.status}` +
                 (ent.distancia_m != null ? `<br>${Math.round(ent.distancia_m)} m` : "") +
                 `<br><i>clique para traçar a rota</i>`)
      .addTo(camadaEntregadores);
    m.on("click", () => tracarRotaEntregador(ent));
  });
}

// ---------------- Consulta de proximidade ----------------
async function buscarProximos(lng, lat, nomeRest) {
  restauranteSelecionado = { lng, lat, nome: nomeRest };   // lembra a selecao
  const raio = raioInput.value;
  try {
    const r = await fetch(`/api/proximos?lng=${lng}&lat=${lat}&raio=${raio}`);
    const data = await r.json();

    // Desenha o circulo do raio
    if (circuloBusca) map.removeLayer(circuloBusca);
    circuloBusca = L.circle([lat, lng], {
      radius: Number(raio), color: "#2C5F2D", weight: 2, fillColor: "#6FA56B", fillOpacity: 0.12,
    }).addTo(map);

    // Redesenha os entregadores (do cache), destacando os encontrados
    const idsProximos = data.entregadores.map((e) => e._id);
    desenharEntregadores(cacheEntregadores, idsProximos);

    // Lista lateral
    let html = `<h2>📍 ${nomeRest} · raio ${raio} m</h2>`;
    if (data.entregadores.length === 0) {
      html += `<div class="item vazio">Nenhum entregador disponível neste raio.</div>`;
    } else {
      data.entregadores.forEach((e) => {
        html += `<div class="item"><b>${e.nome}</b> — ${Math.round(e.distancia_m)} m · ${e.veiculo}</div>`;
      });
    }
    resultadosDiv.innerHTML = html;
  } catch (e) {
    resultadosDiv.innerHTML = `<div class="erro">Erro na busca: ${e.message}</div>`;
  }
}

// ---------------- Atualizacao ao vivo (polling) ----------------
// Recarrega os pontos a cada 7s e, se houver restaurante selecionado, refaz a busca.
let timerAoVivo = null;
const aovivo = document.getElementById("aovivo");
aovivo.addEventListener("change", () => {
  if (aovivo.checked) {
    timerAoVivo = setInterval(atualizarTudo, 7000);
  } else {
    clearInterval(timerAoVivo);
  }
});
async function atualizarTudo() {
  await carregarPontos();
  if (restauranteSelecionado) {
    buscarProximos(restauranteSelecionado.lng, restauranteSelecionado.lat, restauranteSelecionado.nome);
  }
}

// ============================================================
// MELHOR ROTA (Neo4j / grafo) - clique num ENTREGADOR para tracar a rota
// completa dele: entregador -> restaurante -> cliente (2 pernas de Dijkstra).
// ============================================================
let camadaRota = L.layerGroup().addTo(map);
const btnLimparRota = document.getElementById("btnLimparRota");
const rotaInfo = document.getElementById("rotaInfo");

btnLimparRota.addEventListener("click", () => {
  camadaRota.clearLayers();
  rotaInfo.innerHTML = "";
});

// distancia aprox. em metros (Haversine) - so para escolher o ponto mais proximo
function metros(a, b) {
  const R = 6371000, toRad = (g) => (g * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function coordDe(doc) { const [lng, lat] = doc.local.coordinates; return { lng, lat }; }
function maisProximo(pt, lista) {
  let best = null, bd = Infinity;
  lista.forEach((d) => { const dd = metros(pt, coordDe(d)); if (dd < bd) { bd = dd; best = d; } });
  return best;
}

async function tracarRotaEntregador(ent) {
  const e = coordDe(ent);
  // restaurante destino: o selecionado (se houver) ou o mais proximo do entregador
  let rest, restNome;
  if (restauranteSelecionado) {
    rest = { lng: restauranteSelecionado.lng, lat: restauranteSelecionado.lat };
    restNome = restauranteSelecionado.nome;
  } else {
    const rd = maisProximo(e, cacheRestaurantes);
    rest = coordDe(rd); restNome = rd.nome;
  }
  // cliente: o mais proximo do restaurante
  const cd = maisProximo(rest, cacheClientes);
  const cli = coordDe(cd);

  rotaInfo.innerHTML = `<div>Consultando o grafo (Dijkstra)...</div>`;
  const pts = `${e.lng},${e.lat};${rest.lng},${rest.lat};${cli.lng},${cli.lat}`;
  try {
    const r = await fetch(`/api/rota?pts=${pts}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.erro || "falha na rota");

    camadaRota.clearLayers();

    // Linha da rota (geometria real, segue as ruas)
    const pontos = data.geometria.map((p) => [p.lat, p.lng]);
    L.polyline(pontos, { color: "#7B3FB5", weight: 5, opacity: 0.85 }).addTo(camadaRota);

    // Marcadores dos 3 pontos: saida, coleta, entrega
    L.circleMarker([e.lat, e.lng], { radius: 9, fillColor: "#6A2C8F", color: "#fff", weight: 2, fillOpacity: 1 })
      .bindPopup(`🛵 <b>${ent.nome}</b> (saída)`).addTo(camadaRota);
    L.circleMarker([rest.lat, rest.lng], { radius: 9, fillColor: COR.restaurante, color: "#fff", weight: 2, fillOpacity: 1 })
      .bindPopup(`🍽️ <b>${restNome}</b> (coleta)`).addTo(camadaRota);
    L.circleMarker([cli.lat, cli.lng], { radius: 9, fillColor: COR.cliente, color: "#fff", weight: 2, fillOpacity: 1 })
      .bindPopup(`🏠 <b>${cd.nome}</b> (entrega)`).addTo(camadaRota);

    map.fitBounds(L.polyline(pontos).getBounds(), { padding: [60, 60] });

    // Painel: trajeto + distancias por perna + ruas + o Cypher
    const leg1 = data.legs && data.legs[0] ? data.legs[0].metros : null;
    const leg2 = data.legs && data.legs[1] ? data.legs[1].metros : null;
    let html = `<div><b>🛵 ${ent.nome} → 🍽️ ${restNome} → 🏠 ${cd.nome}</b></div>`;
    html += `<div><span class="total">${(data.distancia_m / 1000).toFixed(2)} km</span> no total</div>`;
    if (leg1 != null) html += `<div class="parada">Entregador → Restaurante: ${leg1} m</div>`;
    if (leg2 != null) html += `<div class="parada">Restaurante → Cliente: ${leg2} m</div>`;
    html += `<div style="margin-top:6px;font-size:12px;color:#555">Ruas: ${data.ruas.join(" · ")}</div>`;
    html += `<div id="cypherBox">${data.cypher}</div>`;
    rotaInfo.innerHTML = html;
  } catch (err) {
    rotaInfo.innerHTML = `<div class="erro">Erro na rota: ${err.message}</div>`;
  }
}

carregarPontos();
