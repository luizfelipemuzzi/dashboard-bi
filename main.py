from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import requests
import urllib.parse

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Referer": "https://finance.yahoo.com",
}

# ─── Proxy Yahoo Finance ───────────────────────────────────────────────────────
@app.get("/api/yahoo")
def get_yahoo_data(ticker: str, interval: str = "1m", range: str = "1d"):
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval={interval}&range={range}&events=div%2Csplits"
    )
    try:
        response = requests.get(url, headers=YAHOO_HEADERS, timeout=12)
        if response.status_code != 200:
            url2 = url.replace("query1.", "query2.")
            response = requests.get(url2, headers=YAHOO_HEADERS, timeout=12)
        if response.status_code != 200:
            return {"error": f"Status {response.status_code}", "body": response.text[:300]}
        return response.json()
    except requests.exceptions.Timeout:
        return {"error": "Timeout ao consultar Yahoo Finance"}
    except Exception as e:
        return {"error": str(e)}

# ─── Notícias via Google News RSS ─────────────────────────────────────────────
@app.get("/api/news")
def get_news(ticker: str, name: str = ""):
    """
    Busca notícias do ativo em fontes financeiras via Google News RSS.
    Retorna lista de artigos com título, fonte, link e data.
    """
    # Monta termos de busca: usa nome da empresa se disponível, senão ticker limpo
    clean_ticker = ticker.replace(".SA", "").replace("-USD", "")
    search_term = name if name and len(name) > 3 else clean_ticker

    # Fontes priorizadas na query
    queries = [
        f"{search_term} ação bolsa",
        f"{search_term} stock market",
    ]

    articles = []
    seen_links = set()

    for query in queries:
        encoded = urllib.parse.quote(query)
        rss_url = f"https://news.google.com/rss/search?q={encoded}&hl=pt-BR&gl=BR&ceid=BR:pt-419"

        try:
            resp = requests.get(rss_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                continue

            # Parse RSS XML manualmente (sem dependência extra)
            xml = resp.text
            items = xml.split("<item>")[1:]  # pula o header

            for item in items[:8]:
                def extract(tag, text):
                    start = text.find(f"<{tag}>")
                    end = text.find(f"</{tag}>")
                    if start == -1 or end == -1:
                        return ""
                    return text[start + len(tag) + 2:end].strip()

                title = extract("title", item)
                link  = extract("link", item)
                pub   = extract("pubDate", item)
                source_start = item.find('<source url=')
                source_name = ""
                if source_start != -1:
                    src_end = item.find("</source>", source_start)
                    src_tag = item[source_start:src_end + 9]
                    gt = src_tag.find(">")
                    if gt != -1:
                        source_name = src_tag[gt+1:].replace("</source>", "").strip()

                # Remove CDATA e tags HTML do título
                title = title.replace("<![CDATA[", "").replace("]]>", "")
                if not title or not link or link in seen_links:
                    continue

                # Filtra fontes relevantes (prioriza financeiras)
                PRIORITY_SOURCES = [
                    "InfoMoney", "Reuters", "Bloomberg", "Valor Econômico",
                    "Estadão", "Folha", "G1", "UOL Economia", "Exame",
                    "investing.com", "MoneyTimes", "Suno", "Empiricus",
                    "CNN Brasil", "B3", "CRI", "Broadcast"
                ]
                is_priority = any(s.lower() in source_name.lower() for s in PRIORITY_SOURCES)

                seen_links.add(link)
                articles.append({
                    "title": title,
                    "link": link,
                    "source": source_name or "Google News",
                    "date": pub,
                    "priority": is_priority,
                })

        except Exception:
            continue

    # Ordena: prioridade financeira primeiro
    articles.sort(key=lambda x: (not x["priority"], x["date"]), reverse=False)

    return {"ticker": ticker, "articles": articles[:12]}

# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok"}

# ─── Serve frontend ───────────────────────────────────────────────────────────
@app.get("/")
def serve_frontend():
    return FileResponse("static/daytrade_bi.html")

@app.get("/{full_path:path}")
def catch_all(full_path: str):
    import os
    f = f"static/{full_path}"
    if os.path.isfile(f):
        return FileResponse(f)
    return FileResponse("static/daytrade_bi.html")
