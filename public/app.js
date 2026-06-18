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
    bolinha(lat, lng, cor, destaque ? 13 : 9)
      .bindPopup(`🛵 <b>${ent.nome}</b><br>${ent.veiculo} · ${ent.status}` +
                 (ent.distancia_m != null ? `<br>${Math.round(ent.distancia_m)} m` : ""))
      .addTo(camadaEntregadores);
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

carregarPontos();
