# ✈️ Radar de Voos

Aplicativo web para **acompanhar voos em tempo real** em um mapa interativo.
Abra, navegue pelo mapa e veja as aeronaves que estão voando na área visível —
com altitude, velocidade, rumo e país de origem.

O mapa começa centralizado na região de **São José dos Campos (SP)**, mas
funciona para qualquer lugar do mundo: basta arrastar ou dar zoom.

![status](https://img.shields.io/badge/dados-OpenSky%20Network-4cc2ff)

## ✨ Funcionalidades

- 🗺️ Mapa escuro interativo (Leaflet + CARTO)
- 🛩️ Ícones de avião que giram conforme o rumo real da aeronave
- 🔄 Atualização automática a cada 12 segundos (pode desligar)
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

## 🛰️ Sobre a API de dados (OpenSky Network)

Os dados de voo vêm da [OpenSky Network](https://opensky-network.org), uma
rede colaborativa e gratuita de receptores ADS-B.

- O app consulta o endpoint `/api/states/all` filtrando pela **área visível**
  do mapa (bounding box), o que reduz o volume de dados e o consumo de cota.
- O **acesso anônimo** é gratuito, porém com **limite de requisições**. Se você
  vir a mensagem de "limite atingido", espere alguns segundos ou aumente o
  intervalo de atualização (`REFRESH_MS` em `app.js`).
- Para limites maiores, crie uma conta gratuita na OpenSky e use credenciais
  (atualmente via OAuth2 client credentials). Veja a
  [documentação da API](https://openskynetwork.github.io/opensky-api/).

### Outras APIs públicas de voos (alternativas)

| API | Gratuita? | Bom para |
|-----|-----------|----------|
| **OpenSky Network** | Sim (com limites) | Posições ao vivo (ADS-B) — usada aqui |
| AviationStack | Freemium | Horários e status de voos |
| AeroDataBox (RapidAPI) | Freemium | Escalas por aeroporto |
| ADS-B Exchange | Freemium | Posições ao vivo (sem filtro de cobertura) |
| FlightAware AeroAPI | Pago | Dados completos e históricos |

## 🗂️ Estrutura

```
radar-voos/
├── index.html   # estrutura da página e painéis
├── styles.css   # tema escuro e estilo dos componentes
├── app.js       # lógica: mapa, consulta à OpenSky, marcadores
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
