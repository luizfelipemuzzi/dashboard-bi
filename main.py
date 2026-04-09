from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/yahoo")
def get_yahoo_data(ticker: str, interval: str = "1m", range: str = "1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range}&events=div%2Csplits"

    # ✅ DEFINA O HEADERS AQUI
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)

        # DEBUG (opcional)
        print("STATUS:", response.status_code)
        print("TEXT:", response.text[:200])

        if response.status_code != 200:
            return {
                "error": f"Status {response.status_code}",
                "body": response.text[:200]
            }

        return response.json()

    except Exception as e:
        return {"error": str(e)}