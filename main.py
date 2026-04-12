from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import requests
import concurrent.futures

app = FastAPI(title="DayTrade BI")
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Referer": "https://finance.yahoo.com",
}

B3_POOL = [
    "PETR4.SA","PETR3.SA","VALE3.SA","ITUB4.SA","BBDC4.SA",
    "WEGE3.SA","ABEV3.SA","BBAS3.SA","RENT3.SA","SUZB3.SA",
    "PRIO3.SA","RDOR3.SA","EQTL3.SA","EGIE3.SA","VIVT3.SA",
    "RADL3.SA","JBSS3.SA","GGBR4.SA","CSAN3.SA","LREN3.SA",
    "HAPV3.SA","MGLU3.SA","ELET3.SA","CPLE6.SA","SBSP3.SA",
    "MXRF11.SA","HGLG11.SA","KNRI11.SA","XPML11.SA","IRDM11.SA",
    "BOVA11.SA","SMAL11.SA","IVVB11.SA",
]

def _ema_series(closes, period):
    if len(closes) < period:
        return []
    k = 2.0 / (period + 1)
    seed = sum(closes[:period]) / period
    result = [None] * (period - 1) + [seed]
    for v in closes[period:]:
        result.append(v * k + result[-1] * (1 - k))
    return result

def _rsi(closes, period=14):
    if len(closes) < period + 2:
        return 50.0
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    gains  = [max(d, 0.0) for d in deltas]
    losses = [max(-d, 0.0) for d in deltas]
    avg_g = sum(gains[-period:]) / period
    avg_l = sum(losses[-period:]) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return round(100.0 - 100.0 / (1.0 + rs), 2)

def _compute_signal(closes):
    n = len(closes)
    if n < 22:
        return {"call":"NEUTRO","score":0,"rsi":50.0,"ema9":None,"ema21":None}
    rsi    = _rsi(closes)
    ema9s  = _ema_series(closes, 9)
    ema21s = _ema_series(closes, 21)
    ema9   = ema9s[-1]  if ema9s  else closes[-1]
    ema21  = ema21s[-1] if ema21s else closes[-1]
    price  = closes[-1]
    score  = 0
    if   rsi < 40: score += 1
    elif rsi > 60: score -= 1
    score += 1 if ema9 > ema21 else -1
    score += 1 if price > ema21 else -1
    if n >= 2:
        score += 1 if closes[-1] > closes[-2] else -1
    call_map = {4:"COMPRA",3:"COMPRA",2:"ACUMULAR",1:"ACUMULAR",0:"NEUTRO",
                -1:"AGUARDAR",-2:"AGUARDAR",-3:"VENDA",-4:"VENDA"}
    return {"call":call_map.get(max(-4,min(4,score)),"NEUTRO"),
            "score":score,"rsi":round(rsi,1),
            "ema9":round(ema9,4),"ema21":round(ema21,4)}

def _fetch_one(ticker):
    for host in ["query1","query2"]:
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{ticker}"
               f"?interval=1d&range=2mo")
        try:
            r = requests.get(url, headers=YAHOO_HEADERS, timeout=10)
            if r.status_code != 200:
                continue
            data   = r.json()
            result = (data.get("chart") or {}).get("result") or []
            if not result:
                continue
            result = result[0]
            meta   = result.get("meta", {})
            q      = (result.get("indicators") or {}).get("quote",[{}])[0]
            closes = [c for c in (q.get("close") or []) if c is not None]
            if len(closes) < 15:
                return None
            sig   = _compute_signal(closes)
            prev  = meta.get("previousClose") or meta.get("chartPreviousClose") or closes[-2]
            price = closes[-1]
            chg   = (price - prev) / prev * 100 if prev else 0.0
            name  = (meta.get("longName") or meta.get("shortName") or ticker.replace(".SA",""))[:28]
            return {"ticker":ticker,"short":ticker.replace(".SA",""),"name":name,
                    "price":round(price,2),"chg_pct":round(chg,2),**sig}
        except Exception:
            continue
    return None

@app.get("/api/scanner")
def run_scanner():
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs    = [ex.submit(_fetch_one, t) for t in B3_POOL]
        results = []
        for f in concurrent.futures.as_completed(futs, timeout=40):
            try:
                r = f.result()
                if r:
                    results.append(r)
            except Exception:
                pass
    results.sort(key=lambda x: x.get("score",0), reverse=True)
    return {"assets": results, "total": len(results)}

@app.get("/api/yahoo")
def get_yahoo(ticker: str, interval: str = "5m", range: str = "1d"):
    for host in ["query1","query2"]:
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{ticker}"
               f"?interval={interval}&range={range}&events=div%2Csplits")
        try:
            r = requests.get(url, headers=YAHOO_HEADERS, timeout=12)
            if r.status_code == 200:
                return r.json()
        except Exception:
            continue
    return {"error": "Yahoo Finance indisponível"}

@app.get("/api/health")
def health():
    return {"status": "ok", "pool_size": len(B3_POOL)}

@app.get("/")
def index():
    return FileResponse("static/daytrade_bi.html")

@app.get("/{path:path}")
def fallback(path: str):
    import os
    f = f"static/{path}"
    return FileResponse(f) if os.path.isfile(f) else FileResponse("static/daytrade_bi.html")
