# DayTrade BI — Guia de Deploy

## Estrutura do projeto

```
daytrade-bi/
├── main.py              # Backend FastAPI
├── requirements.txt     # Dependências Python
├── Procfile             # Para Railway/Heroku
├── render.yaml          # Para Render.com
├── railway.json         # Para Railway.app
├── static/
│   └── daytrade_bi.html # Frontend (único arquivo)
```

---

## Opção 1 — Railway.app (RECOMENDADO — mais fácil e gratuito)

1. Crie conta em https://railway.app
2. No terminal local:
   ```bash
   git init
   git add .
   git commit -m "DayTrade BI"
   ```
3. Instale o CLI: `npm install -g @railway/cli`
4. Faça login: `railway login`
5. Deploy: `railway up`
6. Seu site estará em: `https://seu-projeto.up.railway.app`

---

## Opção 2 — Render.com (também gratuito)

1. Crie conta em https://render.com
2. Clique em "New > Web Service"
3. Conecte ao seu repositório GitHub
4. Configurações:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Clique em "Create Web Service"

---

## Opção 3 — VPS próprio (DigitalOcean, Vultr, AWS, etc.)

```bash
# Na sua máquina local
scp -r . usuario@seu-servidor:/opt/daytrade-bi/

# No servidor
cd /opt/daytrade-bi
pip install -r requirements.txt

# Rodar com PM2 (Node.js) ou screen
screen -S daytrade
uvicorn main:app --host 0.0.0.0 --port 8000
# Ctrl+A D para sair sem fechar

# Para acessar: http://IP-DO-SERVIDOR:8000
```

Para HTTPS com domínio próprio, use Nginx como proxy reverso.

---

## Rodar localmente

```bash
pip install -r requirements.txt
mkdir -p static
# (copie daytrade_bi.html para static/ se ainda não estiver lá)
uvicorn main:app --reload --port 8000
# Abra: http://localhost:8000
```

---

## Acessar de outros dispositivos na mesma rede

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
# Descubra seu IP local: ipconfig (Windows) ou ifconfig (Linux/Mac)
# Acesse de qualquer celular na mesma rede: http://192.168.X.X:8000
```
