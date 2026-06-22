# ✈️ Radar de Voos

Aplicativo web para **acompanhar voos em tempo real** em um mapa interativo.
Abra, navegue pelo mapa e veja as aeronaves que estão voando na área visível —
com altitude, velocidade, rumo e país de origem.

O mapa começa centralizado na região de **São José dos Campos (SP)**, mas
funciona para qualquer lugar do mundo: basta arrastar ou dar zoom.

![status](https://img.shields.io/badge/dados-airplanes.live-4cc2ff)

## ✨ Funcionalidades

- 🗺️ Mapa escuro interativo (Leaflet + CARTO)
- 🛩️ Ícones de avião que giram conforme o rumo real da aeronave
- 🧵 Rastro (trajeto) desenhado atrás de cada aeronave — pode ligar/desligar
- 🔄 Atualização automática a cada ~1,2 segundo (pode desligar)
- 📍 Botão para centralizar na sua localização
- 🛫 Atalho para São José dos Campos
- 🖱️ Clique em um avião para ver detalhes (callsign, altitude, velocidade,
  rumo, taxa de subida/descida, squawk, ICAO24 e país)
- 📊 Contador de aeronaves visíveis e horário da última atualização

## 🚀 Como rodar localmente

Como é um site estático (HTML + CSS + JS puro), basta servir a pasta.

```bash
# com Python
python3 -m http.server 8000

# ou com Node
npx serve .
```

Depois abra `http://localhost:8000` no navegador.

> Abrir o `index.html` direto pelo `file://` também funciona na maioria dos
> navegadores, mas servir via HTTP é mais confiável (geolocalização exige
> contexto seguro: `https` ou `localhost`).

## 🌐 Publicar no GitHub Pages

1. No GitHub, vá em **Settings → Pages**.
2. Em **Source**, escolha a branch `main` e a pasta `/ (root)`.
3. Salve. Em alguns instantes o app fica disponível em
   `https://SEU_USUARIO.github.io/radar-voos/`.

## 🛰️ Sobre a API de dados (airplanes.live)

Os dados de voo vêm da [airplanes.live](https://airplanes.live), uma rede
colaborativa e gratuita de receptores ADS-B, com **API REST aberta e CORS
liberado** — por isso funciona direto do navegador, sem backend nem chave.

- O app consulta o endpoint `/v2/point/{lat}/{lon}/{raio}`, usando o **centro
  da área visível** do mapa e um **raio** (em milhas náuticas) que cobre o que
  está na tela. Depois filtra os resultados pela bounding box visível.
- Use com responsabilidade: a airplanes.live limita a **~1 requisição por
  segundo** e recusa (HTTP 429) exatamente a 1000 ms. O app atualiza a cada
  **~1,2 s** (menor intervalo que roda sem 429) e ainda tolera bloqueios
  pontuais, mantendo os aviões na tela. Para mudar, ajuste `REFRESH_MS` em `app.js`.

> **Por que não OpenSky?** A OpenSky passou a restringir o `Access-Control-Allow-Origin`
> à própria origem, o que faz o navegador bloquear (erro "Failed to fetch") quando
> o app roda em outro domínio (ex.: GitHub Pages). A airplanes.live não tem esse
> problema.

### Outras APIs públicas de voos (alternativas)

| API | Gratuita? | CORS no navegador? | Bom para |
|-----|-----------|--------------------|----------|
| **airplanes.live** | Sim | ✅ Sim — usada aqui | Posições ao vivo (ADS-B) |
| adsb.lol / adsb.fi | Sim | Parcial | Posições ao vivo (ADS-B) |
| OpenSky Network | Sim (com limites) | ❌ Não (só própria origem) | Posições ao vivo |
| AviationStack | Freemium | — | Horários e status de voos |
| FlightAware AeroAPI | Pago | — | Dados completos e históricos |

## 🗂️ Estrutura

```
radar-voos/
├── index.html   # estrutura da página e painéis
├── styles.css   # tema escuro e estilo dos componentes
├── app.js       # lógica: mapa, consulta à airplanes.live, marcadores
└── README.md
```

## 📝 Personalização rápida

Em `app.js`:

```js
const SJC = { lat: -23.2287, lng: -45.8629, zoom: 9 }; // posição inicial
const REFRESH_MS = 12000;                              // intervalo de atualização
```

## ⚖️ Licença

MIT — use à vontade.
