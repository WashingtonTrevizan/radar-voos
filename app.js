/* ============================================================
   Radar de Voos — acompanhamento de voos ao vivo
   Dados: airplanes.live (https://airplanes.live)
   API REST aberta, com CORS liberado (funciona direto no navegador).
   ============================================================ */

// Posição inicial: região de São José dos Campos (SP)
const SJC = { lat: -23.2287, lng: -45.8629, zoom: 9 };
// Intervalo de atualização. A airplanes.live limita a ~1 req/s e barra exatamente
// a 1000 ms; 1200 ms é o menor valor que roda limpo (sem 429) com margem.
const REFRESH_MS = 1200;
const API_BASE = "https://api.airplanes.live/v2/point"; // /{lat}/{lon}/{raio_nm}
const MAX_RADIUS_NM = 250; // limite da API
const MIN_RADIUS_NM = 5;

// A 1x/s a API às vezes responde 429 (limite). Tratamos isso como transitório:
// mantemos os aviões na tela e só alertamos após várias falhas seguidas.
const FAIL_THRESHOLD = 5;

// ---- Estado global ----
const markers = new Map(); // hex -> L.marker
let refreshTimer = null;
let inFlight = false; // evita requisições sobrepostas
let failStreak = 0; // falhas/limites consecutivos

// ---- Inicialização do mapa ----
const map = L.map("map", { zoomControl: false, worldCopyJump: true }).setView(
  [SJC.lat, SJC.lng],
  SJC.zoom
);

L.control.zoom({ position: "bottomleft" }).addTo(map);

// Camada de mapa escura (CARTO dark matter)
L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; OpenStreetMap &copy; CARTO',
  }
).addTo(map);

// ---- Elementos da interface ----
const els = {
  count: document.getElementById("count"),
  updated: document.getElementById("updated"),
  status: document.getElementById("status"),
  refresh: document.getElementById("refresh"),
  autoRefresh: document.getElementById("autoRefresh"),
  locate: document.getElementById("locate"),
  sjc: document.getElementById("sjc"),
};

// ---- Helpers ----------------------------------------------------

/** Bandeira (emoji) a partir do prefixo da matrícula da aeronave. */
const REG_FLAGS = [
  [/^(PP|PR|PS|PT|PU|PV)/, "🇧🇷"], // Brasil
  [/^N/, "🇺🇸"],                    // EUA
  [/^LV/, "🇦🇷"],                   // Argentina
  [/^CC/, "🇨🇱"],                   // Chile
  [/^CX/, "🇺🇾"],                   // Uruguai
  [/^ZP/, "🇵🇾"],                   // Paraguai
  [/^HK/, "🇨🇴"],                   // Colômbia
  [/^OB/, "🇵🇪"],                   // Peru
  [/^HP/, "🇵🇦"],                   // Panamá
  [/^XA|^XB|^XC/, "🇲🇽"],           // México
  [/^C-?[FG]/, "🇨🇦"],              // Canadá
  [/^G-/, "🇬🇧"],                   // Reino Unido
  [/^D-/, "🇩🇪"],                   // Alemanha
  [/^F-/, "🇫🇷"],                   // França
  [/^EC/, "🇪🇸"],                   // Espanha
  [/^CS/, "🇵🇹"],                   // Portugal
  [/^I-/, "🇮🇹"],                   // Itália
  [/^PH/, "🇳🇱"],                   // Holanda
  [/^A6/, "🇦🇪"],                   // Emirados
  [/^A7/, "🇶🇦"],                   // Catar
  [/^TC/, "🇹🇷"],                   // Turquia
  [/^B-?[0-9]/, "🇨🇳"],             // China
  [/^JA/, "🇯🇵"],                   // Japão
];
function flagFor(reg) {
  if (!reg) return "🌐";
  const r = reg.toUpperCase();
  for (const [re, flag] of REG_FLAGS) if (re.test(r)) return flag;
  return "🌐";
}

/** Ícone SVG de avião, rotacionado pelo rumo (track). */
function planeIcon(headingDeg, onGround) {
  const cls = onGround ? "plane-icon plane-icon--ground" : "plane-icon";
  const rot = Number.isFinite(headingDeg) ? headingDeg : 0;
  const svg = `
    <svg class="${cls}" style="transform: rotate(${rot}deg)"
         width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 L13.2 2 C13.7 2 14 2.6 14 3.2 L14 9.5 L22 14.2 L22 16 L14 13.8
               L14 19.2 L16.5 21 L16.5 22 L12 21 L7.5 22 L7.5 21 L10 19.2
               L10 13.8 L2 16 L2 14.2 L10 9.5 L10 3.2 C10 2.6 10.3 2 10.8 2 Z"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -10],
  });
}

const fmt = (v, suffix = "", digits = 0) =>
  v == null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}${suffix}`;

function showStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.className = "status" + (isError ? " status--error" : "");
}
function hideStatus() {
  els.status.className = "status status--hidden";
}

// ---- Núcleo: busca e renderização --------------------------------

/** Constrói o conteúdo HTML do popup a partir de uma aeronave. */
function popupHtml(s) {
  const callsign = (s.flight || "").trim() || (s.r || "").trim() || s.hex.toUpperCase();
  // Unidades da API: altitude em pés, velocidade em nós, subida em ft/min.
  const onGround = s.alt_baro === "ground";
  const altFt = onGround ? 0 : (s.alt_geom ?? (typeof s.alt_baro === "number" ? s.alt_baro : null));
  const altM = altFt != null ? altFt * 0.3048 : null;
  const speedKt = s.gs != null ? s.gs : null;
  const speedKmh = speedKt != null ? speedKt * 1.852 : null;
  const vrateMs = s.baro_rate != null ? s.baro_rate * 0.00508 : null; // ft/min -> m/s

  return `
    <div class="popup">
      <h3><span class="flag">${flagFor(s.r)}</span> ${callsign}</h3>
      <table>
        <tr><td>Aeronave</td><td>${s.desc || s.t || "—"}</td></tr>
        <tr><td>Matrícula</td><td>${s.r || "—"}</td></tr>
        <tr><td>Situação</td><td>${onGround ? "No solo" : "Em voo"}</td></tr>
        <tr><td>Altitude</td><td>${fmt(altFt, " ft")} (${fmt(altM, " m")})</td></tr>
        <tr><td>Velocidade</td><td>${fmt(speedKmh, " km/h")} (${fmt(speedKt, " kt")})</td></tr>
        <tr><td>Rumo</td><td>${fmt(s.track, "°")}</td></tr>
        <tr><td>Subida/descida</td><td>${fmt(vrateMs, " m/s", 1)}</td></tr>
        <tr><td>ICAO24</td><td>${s.hex}</td></tr>
        ${s.squawk ? `<tr><td>Squawk</td><td>${s.squawk}</td></tr>` : ""}
      </table>
    </div>`;
}

/** Raio (nm) que cobre a área visível do mapa, a partir do centro. */
function visibleRadiusNm() {
  const b = map.getBounds();
  const meters = map.distance(b.getCenter(), b.getNorthEast());
  const nm = Math.ceil(meters / 1852);
  return Math.min(MAX_RADIUS_NM, Math.max(MIN_RADIUS_NM, nm));
}

async function fetchFlights() {
  if (inFlight) return;
  inFlight = true;
  els.refresh.disabled = true;

  const c = map.getBounds().getCenter();
  const url = `${API_BASE}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}/${visibleRadiusNm()}`;

  try {
    const res = await fetch(url);
    // 429 = limite momentâneo (comum a 1/s). Não é erro fatal: tenta de novo
    // no próximo ciclo, mantendo os aviões já exibidos.
    if (res.status === 429) {
      throttled();
      return;
    }
    if (!res.ok) throw new Error(`Erro ${res.status} ao consultar os dados.`);

    const data = await res.json();
    render(data.ac || []);
    failStreak = 0;
    hideStatus();

    const now = new Date();
    els.updated.textContent = now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (err) {
    // "Failed to fetch" também ocorre quando um 429 vem sem cabeçalho CORS.
    throttled(err);
  } finally {
    inFlight = false;
    els.refresh.disabled = false;
  }
}

/** Falha transitória (limite/rede): só alerta após várias seguidas. */
function throttled(err) {
  failStreak++;
  if (failStreak >= FAIL_THRESHOLD) {
    if (err) console.error(err);
    showStatus(
      "Sem dados no momento — limite de requisições da API. " +
        "Tentando novamente…",
      true
    );
  }
}

/** Atualiza/cria/remove marcadores conforme os dados recebidos. */
function render(aircraft) {
  const seen = new Set();
  const bounds = map.getBounds();
  let visible = 0;

  for (const s of aircraft) {
    if (s.lat == null || s.lon == null) continue;
    // A API consulta por raio (círculo); mostramos só o que está na área visível.
    if (!bounds.contains([s.lat, s.lon])) continue;
    seen.add(s.hex);
    visible++;

    const latlng = [s.lat, s.lon];
    const onGround = s.alt_baro === "ground";
    const icon = planeIcon(s.track, onGround);
    let marker = markers.get(s.hex);

    if (marker) {
      marker.setLatLng(latlng);
      marker.setIcon(icon);
      if (marker.isPopupOpen()) marker.setPopupContent(popupHtml(s));
    } else {
      marker = L.marker(latlng, { icon }).bindPopup(popupHtml(s));
      marker.addTo(map);
      markers.set(s.hex, marker);
    }
  }

  // Remove aeronaves que saíram da área
  for (const [id, marker] of markers) {
    if (!seen.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }

  els.count.textContent = visible.toLocaleString("pt-BR");
}

// ---- Agendamento de atualização ---------------------------------
function startAutoRefresh() {
  stopAutoRefresh();
  if (els.autoRefresh.checked) {
    refreshTimer = setInterval(fetchFlights, REFRESH_MS);
  }
}
function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

// ---- Eventos ----------------------------------------------------
els.refresh.addEventListener("click", fetchFlights);
els.autoRefresh.addEventListener("change", startAutoRefresh);
els.sjc.addEventListener("click", () => map.setView([SJC.lat, SJC.lng], SJC.zoom));
els.locate.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showStatus("Geolocalização não suportada neste navegador.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 9),
    () => showStatus("Não foi possível obter sua localização.", true)
  );
});

// Recarrega ao terminar de mover/zoom o mapa (com pequeno debounce)
let moveTimer = null;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(fetchFlights, 400);
});

// ---- Start ----
fetchFlights();
startAutoRefresh();
