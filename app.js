/* ============================================================
   Radar de Voos — acompanhamento de voos ao vivo
   Dados: OpenSky Network (https://opensky-network.org)
   ============================================================ */

// Posição inicial: região de São José dos Campos (SP)
const SJC = { lat: -23.2287, lng: -45.8629, zoom: 9 };
const REFRESH_MS = 12000; // intervalo de atualização automática
const OPENSKY_URL = "https://opensky-network.org/api/states/all";

// ---- Estado global ----
const markers = new Map(); // icao24 -> L.marker
let refreshTimer = null;
let inFlight = false; // evita requisições sobrepostas

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

/** Converte código de país em emoji de bandeira (melhor esforço). */
const COUNTRY_FLAGS = {
  Brazil: "🇧🇷", "United States": "🇺🇸", Argentina: "🇦🇷", Chile: "🇨🇱",
  "United Kingdom": "🇬🇧", Germany: "🇩🇪", France: "🇫🇷", Spain: "🇪🇸",
  Portugal: "🇵🇹", Italy: "🇮🇹", Netherlands: "🇳🇱", Canada: "🇨🇦",
  Mexico: "🇲🇽", Colombia: "🇨🇴", Peru: "🇵🇪", Uruguay: "🇺🇾",
  Paraguay: "🇵🇾", Panama: "🇵🇦", Turkey: "🇹🇷", Qatar: "🇶🇦",
  "United Arab Emirates": "🇦🇪", China: "🇨🇳", Japan: "🇯🇵",
};
const flagFor = (country) => COUNTRY_FLAGS[country] || "🌐";

/** Ícone SVG de avião, rotacionado pelo rumo (true_track). */
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

/** Constrói o conteúdo HTML do popup a partir de um "state vector". */
function popupHtml(s) {
  const callsign = (s.callsign || "").trim() || s.icao24.toUpperCase();
  const speedKmh = s.velocity != null ? s.velocity * 3.6 : null;
  const speedKt = s.velocity != null ? s.velocity * 1.94384 : null;
  const altM = s.geo_altitude ?? s.baro_altitude;
  const altFt = altM != null ? altM * 3.28084 : null;
  const vrate = s.vertical_rate;

  return `
    <div class="popup">
      <h3><span class="flag">${flagFor(s.origin_country)}</span> ${callsign}</h3>
      <table>
        <tr><td>País</td><td>${s.origin_country || "—"}</td></tr>
        <tr><td>Situação</td><td>${s.on_ground ? "No solo" : "Em voo"}</td></tr>
        <tr><td>Altitude</td><td>${fmt(altM, " m")} (${fmt(altFt, " ft")})</td></tr>
        <tr><td>Velocidade</td><td>${fmt(speedKmh, " km/h")} (${fmt(speedKt, " kt")})</td></tr>
        <tr><td>Rumo</td><td>${fmt(s.true_track, "°")}</td></tr>
        <tr><td>Subida/descida</td><td>${fmt(vrate, " m/s", 1)}</td></tr>
        <tr><td>ICAO24</td><td>${s.icao24}</td></tr>
        ${s.squawk ? `<tr><td>Squawk</td><td>${s.squawk}</td></tr>` : ""}
      </table>
    </div>`;
}

/** Transforma o array cru da OpenSky em objeto nomeado. */
function parseState(a) {
  return {
    icao24: a[0],
    callsign: a[1],
    origin_country: a[2],
    longitude: a[5],
    latitude: a[6],
    baro_altitude: a[7],
    on_ground: a[8],
    velocity: a[9],
    true_track: a[10],
    vertical_rate: a[11],
    geo_altitude: a[13],
    squawk: a[14],
  };
}

async function fetchFlights() {
  if (inFlight) return;
  inFlight = true;
  els.refresh.disabled = true;

  const b = map.getBounds();
  const params = new URLSearchParams({
    lamin: b.getSouth().toFixed(4),
    lomin: b.getWest().toFixed(4),
    lamax: b.getNorth().toFixed(4),
    lomax: b.getEast().toFixed(4),
  });

  try {
    const res = await fetch(`${OPENSKY_URL}?${params}`);
    if (res.status === 429) {
      throw new Error(
        "Limite de requisições da OpenSky atingido. Aguarde alguns segundos."
      );
    }
    if (!res.ok) throw new Error(`Erro ${res.status} ao consultar a OpenSky.`);

    const data = await res.json();
    const states = (data.states || []).map(parseState);
    render(states);
    hideStatus();

    const now = new Date();
    els.updated.textContent = now.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (err) {
    console.error(err);
    showStatus(
      err.message ||
        "Não foi possível obter os dados. Verifique sua conexão.",
      true
    );
  } finally {
    inFlight = false;
    els.refresh.disabled = false;
  }
}

/** Atualiza/cria/remove marcadores conforme os dados recebidos. */
function render(states) {
  const seen = new Set();
  let visible = 0;

  for (const s of states) {
    if (s.latitude == null || s.longitude == null) continue;
    seen.add(s.icao24);
    visible++;

    const latlng = [s.latitude, s.longitude];
    const icon = planeIcon(s.true_track, s.on_ground);
    let marker = markers.get(s.icao24);

    if (marker) {
      marker.setLatLng(latlng);
      marker.setIcon(icon);
      if (marker.isPopupOpen()) marker.setPopupContent(popupHtml(s));
    } else {
      marker = L.marker(latlng, { icon }).bindPopup(popupHtml(s));
      marker.addTo(map);
      markers.set(s.icao24, marker);
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
