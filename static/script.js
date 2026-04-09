// ===================== STATE =====================
let STATE = {
    ticker: 'PETR4.SA',
    interval: '1m',
    candles: [],
    autoTimer: null,
    charts: {},
    watchlist: ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA'],
    watchlistPrices: {}
};

// ===================== API =====================
let DATA_PROVIDER = 'yahoo';

async function fetchMarketData(ticker, interval, range) {
    if (DATA_PROVIDER === 'yahoo') {
        return await fetchYahoo(ticker, interval, range);
    }

    return null;
}

async function fetchYahoo(ticker, interval, range) {
    const rangeMap = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '1mo', '1d': '3mo' };
    const r = range || rangeMap[interval] || '1d';

    // 🚀 AGORA USA SEU BACKEND PYTHON
    // const url = `http://127.0.0.1:8000/api/yahoo?ticker=${encodeURIComponent(ticker)}&interval=${interval}&range=${r}`;
    const url = `/api/yahoo?ticker=${encodeURIComponent(ticker)}&interval=${interval}&range=${r}`;
    try {
        const res = await fetch(url);

        if (!res.ok) return null;

        const json = await res.json();

        // 🔥 mesma estrutura do Yahoo
        const chart = json?.chart?.result?.[0];
        if (!chart) return null;

        return parseYahoo(chart);

    } catch (e) {
        return null;
    }
}

function parseYahoo(chart) {
    const ts = chart.timestamp || [];
    const q = chart.indicators?.quote?.[0] || {};
    const opens = q.open || [], closes = q.close || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
    const meta = chart.meta || {};

    const candles = [];
    for (let i = 0; i < ts.length; i++) {
        if (closes[i] == null) continue;
        candles.push({
            t: ts[i] * 1000,
            o: +opens[i]?.toFixed(2) || 0,
            h: +highs[i]?.toFixed(2) || 0,
            l: +lows[i]?.toFixed(2) || 0,
            c: +closes[i]?.toFixed(2) || 0,
            v: vols[i] || 0
        });
    }

    return {
        candles,
        currency: meta.currency || 'BRL',
        name: meta.longName || meta.shortName || meta.symbol || STATE.ticker,
        prevClose: meta.chartPreviousClose || meta.previousClose || (candles[0]?.o),
        exchange: meta.exchangeName || ''
    };
}

// ===================== LOAD DATA =====================
async function loadData() {
    setLoading(true, 'Buscando dados de mercado...');
    document.getElementById('refresh-btn').disabled = true;
    hideError();

    try {
        const data = await fetchMarketData(STATE.ticker, STATE.interval);
        if (!data || data.candles.length < 5) {
            showError();
            setLoading(false);
            document.getElementById('refresh-btn').disabled = false;
            return;
        }
        STATE.candles = data.candles;
        STATE.meta = data;

        updateSidebar(data);
        redrawCharts();
        updateHistTable();
        updateStatusBar();
        updateLiveDot();
        loadWatchlistPrices();
    } catch (e) {
        showError();
    }

    setLoading(false);
    document.getElementById('refresh-btn').disabled = false;
}

// ===================== INDICATORS =====================
function sma(arr, p) {
    return arr.map((_, i) => i < p - 1 ? null : +(arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p).toFixed(3));
}

function ema(arr, p) {
    const k = 2 / (p + 1);
    const result = []; let prev = null;
    arr.forEach((v, i) => {
        if (v == null) { result.push(null); return; }
        if (prev === null && i >= p - 1) {
            const slice = arr.slice(Math.max(0, i - p + 1), i + 1).filter(x => x != null);
            if (slice.length < p) { result.push(null); return; }
            prev = slice.reduce((a, b) => a + b, 0) / p;
            result.push(+prev.toFixed(3)); return;
        }
        if (prev === null) { result.push(null); return; }
        prev = v * k + prev * (1 - k);
        result.push(+prev.toFixed(3));
    });
    return result;
}

function calcRSI(closes, p = 14) {
    return closes.map((_, i) => {
        if (i < p) return null;
        let g = 0, l = 0;
        for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - closes[j - 1]; if (d > 0) g += d; else l -= d; }
        const rs = g / (l || 0.0001);
        return +(100 - 100 / (1 + rs)).toFixed(2);
    });
}

function calcMACD(closes) {
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    const macdLine = e12.map((v, i) => v != null && e26[i] != null ? +(v - e26[i]).toFixed(3) : null);
    const validIdx = macdLine.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
    const validMacd = validIdx.map(i => macdLine[i]);
    const sigRaw = ema(validMacd, 9);
    const signal = new Array(macdLine.length).fill(null);
    validIdx.forEach((origIdx, j) => { signal[origIdx] = sigRaw[j]; });
    const hist = macdLine.map((v, i) => v != null && signal[i] != null ? +(v - signal[i]).toFixed(3) : null);
    return { macdLine, signal, hist };
}

function calcBollinger(closes, p = 20, dev = 2) {
    const mid = sma(closes, p);
    const upper = [], lower = [];
    closes.forEach((_, i) => {
        if (i < p - 1) { upper.push(null); lower.push(null); return; }
        const slice = closes.slice(i - p + 1, i + 1);
        const m = slice.reduce((a, b) => a + b, 0) / p;
        const std = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / p);
        upper.push(+(m + dev * std).toFixed(3));
        lower.push(+(m - dev * std).toFixed(3));
    });
    return { mid, upper, lower };
}

function calcStochastic(candles, k = 14, d = 3) {
    const kLine = candles.map((_, i) => {
        if (i < k - 1) return null;
        const sl = candles.slice(i - k + 1, i + 1);
        const hi = Math.max(...sl.map(c => c.h));
        const lo = Math.min(...sl.map(c => c.l));
        if (hi === lo) return 50;
        return +((candles[i].c - lo) / (hi - lo) * 100).toFixed(2);
    });
    const dLine = sma(kLine.filter(v => v != null), d);
    const dFull = new Array(kLine.length).fill(null);
    let di = 0;
    kLine.forEach((_, i) => { if (kLine[i] != null) { dFull[i] = dLine[di] || null; di++; } });
    return { k: kLine, d: dFull };
}

function calcATR(candles, p = 14) {
    const trs = candles.map((c, i) => {
        if (i === 0) return c.h - c.l;
        const prev = candles[i - 1].c;
        return Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev));
    });
    return sma(trs, p);
}

function calcVWAP(candles) {
    let cumTPV = 0, cumVol = 0;
    return candles.map(c => {
        const tp = (c.h + c.l + c.c) / 3;
        cumTPV += tp * c.v; cumVol += c.v;
        return cumVol ? +(cumTPV / cumVol).toFixed(3) : null;
    });
}

function compositeSignal(candles, closes) {
    const p1 = +document.getElementById('ma1').value;
    const p2 = +document.getElementById('ma2').value;
    const ma1 = sma(closes, p1); const ma2 = sma(closes, p2);
    const rsi = calcRSI(closes);
    const { macdLine, signal } = calcMACD(closes);
    const { k: stoch } = calcStochastic(candles);
    const n = closes.length - 1;

    let score = 0, reasons = [];
    const lma1 = ma1[n], lma2 = ma2[n], prma1 = ma1[n - 1], prma2 = ma2[n - 1];
    if (lma1 && lma2) {
        if (lma1 > lma2) { score += 2; } else { score -= 2; }
        if (prma1 && prma2 && prma1 < prma2 && lma1 >= lma2) { score += 1; reasons.push('Cruzamento de alta MM'); }
        if (prma1 && prma2 && prma1 > prma2 && lma1 <= lma2) { score -= 1; reasons.push('Cruzamento de baixa MM'); }
    }
    const lr = rsi[n];
    if (lr) {
        if (lr < 30) { score += 2; reasons.push('RSI sobrevend.'); }
        else if (lr < 45) { score += 1; }
        else if (lr > 70) { score -= 2; reasons.push('RSI sobrecomp.'); }
        else if (lr > 55) { score -= 1; }
    }
    const lm = macdLine[n], ls = signal[n];
    if (lm && ls) {
        if (lm > ls) { score += 1; } else { score -= 1; }
        const pm = macdLine[n - 1], ps = signal[n - 1];
        if (pm && ps && pm < ps && lm >= ls) { score += 1; reasons.push('Cruzamento MACD alta'); }
        if (pm && ps && pm > ps && lm <= ls) { score -= 1; reasons.push('Cruzamento MACD baixa'); }
    }
    const lsk = stoch[n];
    if (lsk) {
        if (lsk < 20) { score += 1; } else if (lsk > 80) { score -= 1; }
    }
    return { score, reasons, ma1, ma2, rsi, macdLine, signal };
}

// ===================== UI UPDATES =====================
function updateSidebar(data) {
    const c = STATE.candles;
    if (!c.length) return;
    const last = c[c.length - 1];
    const first = c[0];
    const prev = STATE.meta?.prevClose || first.o;
    const chgAbs = +(last.c - prev).toFixed(2);
    const chgPct = +((chgAbs / prev) * 100).toFixed(2);
    const closes = c.map(x => x.c);
    const isUSD = (data.currency || '').toUpperCase() !== 'BRL';
    const sym = isUSD ? '$' : 'R$';

    document.getElementById('asset-full-name').textContent = data.name || STATE.ticker;
    document.getElementById('price-display').textContent = `${sym} ${last.c.toFixed(2)}`;
    const chgEl = document.getElementById('price-chg-abs');
    const pctEl = document.getElementById('price-chg-pct');
    chgEl.textContent = `${chgAbs >= 0 ? '+' : ''}${sym}${chgAbs.toFixed(2)}`;
    chgEl.className = chgAbs >= 0 ? 'up' : 'dn';
    pctEl.textContent = `(${chgPct >= 0 ? '+' : ''}${chgPct}%)`;
    pctEl.className = chgPct >= 0 ? 'up' : 'dn';

    const maxH = Math.max(...c.map(x => x.h));
    const minL = Math.min(...c.map(x => x.l));
    const vwap = calcVWAP(c);
    const atr = calcATR(c);
    const totalVol = c.reduce((a, b) => a + b.v, 0);
    document.getElementById('m-high').textContent = `${sym}${maxH.toFixed(2)}`;
    document.getElementById('m-low').textContent = `${sym}${minL.toFixed(2)}`;
    document.getElementById('m-open').textContent = `${sym}${first.o.toFixed(2)}`;
    document.getElementById('m-vol').textContent = fmtVol(totalVol);
    document.getElementById('m-amp').textContent = `${sym}${(maxH - minL).toFixed(2)}`;
    const lv = vwap[vwap.length - 1];
    document.getElementById('m-vwap').textContent = lv ? `${sym}${lv.toFixed(2)}` : '—';

    // Indicators
    const rsi = calcRSI(closes);
    const { macdLine, signal, hist } = calcMACD(closes);
    const bb = calcBollinger(closes, 20, +document.getElementById('bbdev').value);
    const { k: stoch, d: stochD } = calcStochastic(c);
    const atrArr = calcATR(c);
    const p1 = +document.getElementById('ma1').value, p2 = +document.getElementById('ma2').value;
    const ma1 = sma(closes, p1), ma2 = sma(closes, p2);
    const n = closes.length - 1;
    const lr = rsi[n], lm = macdLine[n], ls = signal[n];
    const lbb_up = bb.upper[n], lbb_dn = bb.lower[n];
    const lsk = stoch[n], latr = atrArr[n];
    const lma1 = ma1[n], lma2 = ma2[n];
    const isUSD2 = isUSD;
    const sym2 = sym;

    const rsiEl = document.getElementById('ind-rsi');
    rsiEl.textContent = lr?.toFixed(1) || '—';
    rsiEl.className = 'ind-val ' + (lr > 70 ? 'dn' : lr < 30 ? 'up' : 'neu');
    const rsiBar = document.getElementById('rsi-bar');
    if (lr) { rsiBar.style.width = (lr) + '%'; rsiBar.style.background = lr > 70 ? 'var(--red)' : lr < 30 ? 'var(--green)' : 'var(--amber)'; }

    document.getElementById('ind-macd').textContent = lm?.toFixed(3) || '—';
    document.getElementById('ind-macd-sig').textContent = ls?.toFixed(3) || '—';
    document.getElementById('ind-bb-up').textContent = lbb_up ? `${sym2}${lbb_up.toFixed(2)}` : '—';
    document.getElementById('ind-bb-dn').textContent = lbb_dn ? `${sym2}${lbb_dn.toFixed(2)}` : '—';
    document.getElementById('ind-stoch').textContent = lsk?.toFixed(1) || '—';
    document.getElementById('ind-atr').textContent = latr?.toFixed(3) || '—';

    const maCross = lma1 && lma2 ? (lma1 > lma2 ? '▲ Alta' : '▼ Baixa') : '—';
    const maCrossEl = document.getElementById('ind-ma-cross');
    maCrossEl.textContent = maCross;
    maCrossEl.className = 'ind-val ' + (lma1 > lma2 ? 'up' : lma1 < lma2 ? 'dn' : 'neu');

    // Composite signal
    const { score, reasons } = compositeSignal(c, closes);
    const sigBox = document.getElementById('signal-box');
    const sigMain = document.getElementById('sig-main');
    const sigSub = document.getElementById('sig-sub');
    sigBox.className = 'signal-block ';
    if (score >= 3) { sigBox.className += 'sig-buy'; sigMain.textContent = '▲ COMPRA'; }
    else if (score <= -3) { sigBox.className += 'sig-sell'; sigMain.textContent = '▼ VENDA'; }
    else if (score > 0) { sigBox.className += 'sig-buy'; sigMain.textContent = '↗ VIÉS ALTA'; }
    else if (score < 0) { sigBox.className += 'sig-sell'; sigMain.textContent = '↘ VIÉS BAIXA'; }
    else { sigBox.className += 'sig-neu'; sigMain.textContent = '⏸ NEUTRO'; }
    sigSub.textContent = reasons.length ? reasons.slice(0, 2).join(' · ') : `Score: ${score}`;
}

function updateHistTable() {
    const c = STATE.candles.slice(-20).reverse();
    const isUSD = (STATE.meta?.currency || '').toUpperCase() !== 'BRL';
    const sym = isUSD ? '$' : 'R$';
    const rows = c.map(x => {
        const chg = x.c - x.o;
        const chgPct = ((chg / x.o) * 100).toFixed(2);
        const dir = chg >= 0 ? 'td-up' : 'td-dn';
        const dt = new Date(x.t);
        const label = STATE.interval === '1d' ? dt.toLocaleDateString('pt-BR') : dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `<tr>
      <td>${label}</td>
      <td>${sym}${x.o.toFixed(2)}</td>
      <td class="td-up">${sym}${x.h.toFixed(2)}</td>
      <td class="td-dn">${sym}${x.l.toFixed(2)}</td>
      <td><b>${sym}${x.c.toFixed(2)}</b></td>
      <td>${fmtVol(x.v)}</td>
      <td class="${dir}">${chg >= 0 ? '+' : ''}${chgPct}%</td>
    </tr>`;
    }).join('');
    document.getElementById('hist-body').innerHTML = rows || '<tr><td colspan="7" style="color:var(--text3);text-align:center;">Sem dados</td></tr>';
}

function updateStatusBar() {
    const n = STATE.candles.length;
    document.getElementById('sb-ticker').textContent = 'Ativo: ' + STATE.ticker;
    document.getElementById('sb-interval').textContent = 'Intervalo: ' + STATE.interval;
    document.getElementById('sb-candles').textContent = 'Candles: ' + n;
    document.getElementById('sb-time').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString('pt-BR');
}

function updateLiveDot() {
    const dot = document.getElementById('live-dot');
    dot.style.background = 'var(--green)';
    setTimeout(() => dot.style.background = 'var(--text3)', 1000);
    setTimeout(() => dot.style.background = 'var(--green)', 2000);
}

async function loadWatchlistPrices() {
    for (const t of STATE.watchlist) {
        try {
            const data = await fetchYahoo(t, '1d', '5d');
            if (data?.candles?.length) {
                const last = data.candles[data.candles.length - 1];
                const first = data.candles[0];
                STATE.watchlistPrices[t] = { price: last.c, chg: +((last.c - first.o) / first.o * 100).toFixed(2) };
            }
        } catch (e) { }
    }
    renderWatchlist();
}

function renderWatchlist() {
    const html = STATE.watchlist.map(t => {
        const p = STATE.watchlistPrices[t];
        const chgClass = p?.chg >= 0 ? 'up' : 'dn';
        const label = t.replace('.SA', '');
        return `<div class="watch-item" onclick="selectTicker('${t}', null)">
      <span class="wi-ticker">${label}</span>
      <span class="wi-price">${p ? 'R$' + p.price.toFixed(2) : '—'}</span>
      <span class="wi-chg ${chgClass}">${p ? (p.chg >= 0 ? '+' : '') + p.chg + '%' : '—'}</span>
    </div>`;
    }).join('');
    document.getElementById('watchlist').innerHTML = html || '<div style="color:var(--text3);font-size:11px;font-family:var(--mono);">Vazio</div>';
}

// ===================== CHARTS =====================
function destroyCharts() {
    ['priceChart', 'volChart', 'rsiChart', 'macdChart', 'stochChart'].forEach(id => {
        if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; }
    });
}

function redrawCharts() {
    if (!STATE.candles.length) return;
    destroyCharts();
    const c = STATE.candles;
    const closes = c.map(x => x.c);
    const opens = c.map(x => x.o);
    const highs = c.map(x => x.h);
    const lows = c.map(x => x.l);
    const vols = c.map(x => x.v);

    const p1 = +document.getElementById('ma1').value;
    const p2 = +document.getElementById('ma2').value;
    const bbDev = +document.getElementById('bbdev').value;
    const ma1 = sma(closes, p1); const ma2 = sma(closes, p2);
    const bb = calcBollinger(closes, 20, bbDev);
    const rsi = calcRSI(closes);
    const { macdLine, signal, hist } = calcMACD(closes);
    const stoch = calcStochastic(c);

    const labels = c.map(x => {
        const d = new Date(x.t);
        return STATE.interval === '1d'
            ? d.toLocaleDateString('pt-BR', { month: '2-digit', day: '2-digit' })
            : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    });

    const upColor = c.map((x, i) => x.c >= x.o ? 'rgba(16,217,136,0.7)' : 'rgba(240,74,90,0.7)');

    // TREND BADGE
    const n = closes.length - 1;
    const lma1 = ma1[n], lma2 = ma2[n];
    const badge = document.getElementById('trend-badge');
    if (lma1 && lma2) { badge.textContent = lma1 > lma2 ? '▲ Tendência de Alta' : '▼ Tendência de Baixa'; badge.className = 'chart-badge ' + (lma1 > lma2 ? 'badge-trend-up' : 'badge-trend-dn'); }

    const gridColor = 'rgba(80,140,255,0.06)';
    const tickColor = '#4a6090';

    //ALTERAÇÃO
    // ===== AJUSTE DINÂMICO DO EIXO Y =====
    const allPrices = [
        ...highs,
        ...lows,
        ...bb.upper,
        ...bb.lower
    ].filter(v => v != null);

    const minY = Math.min(...allPrices);
    const maxY = Math.max(...allPrices);

    // margem para respiro visual
    const padding = (maxY - minY) * 0.1;
    //

    // PRICE CHART
    STATE.charts['priceChart'] = new Chart(document.getElementById('priceChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Candle', data: c.map((x, i) => [Math.min(x.c, x.o), Math.max(x.c, x.o)]), backgroundColor: upColor, borderColor: upColor, borderWidth: 1, borderSkipped: false, barPercentage: 0.6 },
                { type: 'line', label: `MM${p1}`, data: ma1, borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
                { type: 'line', label: `MM${p2}`, data: ma2, borderColor: '#f5a623', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
                { type: 'line', label: 'BB Superior', data: bb.upper, borderColor: 'rgba(167,139,250,0.5)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, tension: 0.3, fill: false },
                { type: 'line', label: 'BB Inferior', data: bb.lower, borderColor: 'rgba(167,139,250,0.5)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, tension: 0.3, fill: '3' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { mode: 'index', intersect: false, backgroundColor: '#0d1525', borderColor: 'rgba(80,140,255,0.3)', borderWidth: 1, titleColor: '#8899bb', bodyColor: '#e8edf8' },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x', // arrastar horizontal
                    },
                    zoom: {
                        wheel: {
                            enabled: true // scroll do mouse
                        },
                        pinch: {
                            enabled: true // zoom no celular
                        },
                        drag: {
                            enabled: true // 👈 permite arrastar pra dar zoom
                        },
                        mode: 'xy' // zoom horizontal e vertical
                    }
                },
            },
            scales: {
                x: { ticks: { autoSkip: true, maxTicksLimit: 12, color: tickColor, font: { size: 10, family: "'Space Mono',monospace" } }, grid: { color: gridColor } },
                y: {
                    position: 'right',
                    min: minY - padding,
                    max: maxY + padding,
                    ticks: {
                        color: tickColor, font: { size: 10, family: "'Space Mono',monospace" }, callback: v => '' + v.toFixed(2)
                    },
                    grid: { color: gridColor }
                }
            },
        }
    });

    // VOLUME CHART
    STATE.charts['volChart'] = new Chart(document.getElementById('volChart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Volume', data: vols, backgroundColor: c.map(x => x.c >= x.o ? 'rgba(16,217,136,0.4)' : 'rgba(240,74,90,0.4)'), borderWidth: 0, barPercentage: 0.7 }] },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtVol(ctx.raw) } } },
            scales: {
                x: { display: false },
                y: { position: 'right', ticks: { color: tickColor, font: { size: 9, family: "'Space Mono',monospace" }, callback: v => fmtVol(v) }, grid: { display: false } }
            }
        }
    });

    // RSI CHART
    STATE.charts['rsiChart'] = new Chart(document.getElementById('rsiChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'RSI', data: rsi, borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
                { label: 'OB', data: Array(c.length).fill(70), borderColor: 'rgba(240,74,90,0.4)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0 },
                { label: 'OS', data: Array(c.length).fill(30), borderColor: 'rgba(16,217,136,0.4)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { autoSkip: true, maxTicksLimit: 8, color: tickColor, font: { size: 9 } }, grid: { color: gridColor } },
                y: { min: 0, max: 100, position: 'right', ticks: { color: tickColor, font: { size: 9 }, callback: v => v + '' }, grid: { color: gridColor } }
            }
        }
    });

    // MACD CHART
    STATE.charts['macdChart'] = new Chart(document.getElementById('macdChart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar', label: 'Hist', data: hist, backgroundColor: hist.map(v => v == null ? 'transparent' : v >= 0 ? 'rgba(16,217,136,0.5)' : 'rgba(240,74,90,0.5)'), borderWidth: 0 },
                { type: 'line', label: 'MACD', data: macdLine, borderColor: '#3b82f6', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
                { type: 'line', label: 'Sinal', data: signal, borderColor: '#f5a623', borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, tension: 0.3 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { autoSkip: true, maxTicksLimit: 8, color: tickColor, font: { size: 9 } }, grid: { color: gridColor } },
                y: { position: 'right', ticks: { color: tickColor, font: { size: 9 } }, grid: { color: gridColor } }
            }
        }
    });

    // STOCH CHART
    STATE.charts['stochChart'] = new Chart(document.getElementById('stochChart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: '%K', data: stoch.k, borderColor: '#60a5fa', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false },
                { label: '%D', data: stoch.d, borderColor: '#f5a623', borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, tension: 0.3, fill: false },
                { label: 'OB', data: Array(c.length).fill(80), borderColor: 'rgba(240,74,90,0.3)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0 },
                { label: 'OS', data: Array(c.length).fill(20), borderColor: 'rgba(16,217,136,0.3)', borderWidth: 1, borderDash: [4, 3], pointRadius: 0 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { autoSkip: true, maxTicksLimit: 8, color: tickColor, font: { size: 9 } }, grid: { color: gridColor } },
                y: { min: 0, max: 100, position: 'right', ticks: { color: tickColor, font: { size: 9 } }, grid: { color: gridColor } }
            }
        }
    });

    // Also update sidebar indicators
    if (STATE.meta) updateSidebar(STATE.meta);
}

// ===================== CONTROLS =====================
function selectTicker(ticker, btn) {
    STATE.ticker = ticker;
    if (!STATE.watchlist.includes(ticker)) STATE.watchlist.push(ticker);
    document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadData();
}

function addCustomTicker() {
    const val = document.getElementById('custom-ticker').value.trim().toUpperCase();
    if (!val) return;
    const ticker = val.includes('.') ? val : val + '.SA';
    document.getElementById('custom-ticker').value = '';
    selectTicker(ticker, null);
}

document.getElementById('custom-ticker').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomTicker(); });

function setInterval_(iv, btn) {
    STATE.interval = iv;
    document.querySelectorAll('.iv-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadData();
}

let autoTimer = null;
function setupAutoRefresh() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    const sec = +document.getElementById('auto-interval').value;
    if (sec > 0) autoTimer = setInterval(loadData, sec * 1000);
}

function resetZoom() {
  STATE.charts['priceChart'].resetZoom();
}

// ===================== HELPERS =====================
function setLoading(v, msg = '') {
    document.getElementById('loader').style.display = v ? 'flex' : 'none';
    if (msg) document.getElementById('loader-text').textContent = msg;
}
function showError() { document.getElementById('error-banner').style.display = 'block'; }
function hideError() { document.getElementById('error-banner').style.display = 'none'; }
function fmtVol(v) {
    if (!v) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return '' + v;
}



// ===================== INIT =====================
setupAutoRefresh();
loadData();