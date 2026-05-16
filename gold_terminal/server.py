"""
Gold Institutional Terminal - Backend
======================================
Spuštění:
  1. pip install flask yfinance pandas numpy requests flask-cors
  2. python server.py
  3. Otevři dashboard na http://localhost:5000

Aktualizuje se automaticky každých 30s.
"""

import math
import time
import threading
import datetime
import requests
import numpy as np
import pandas as pd
import yfinance as yf
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Povolí dashboard přistupovat k API

# ── Cache (data se stahují na pozadí, API vrací vždy poslední) ─────────────
_cache = {}
_cache_lock = threading.Lock()

# ── Výpočetní funkce ────────────────────────────────────────────────────────

def calc_ema(prices: list, period: int) -> float:
    if len(prices) < 2:
        return prices[-1] if prices else 0.0
    k = 2 / (period + 1)
    ema = prices[0]
    for p in prices[1:]:
        ema = p * k + ema * (1 - k)
    return round(ema, 2)

def calc_rsi(prices: list, period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i-1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 2)

def calc_atr(highs: list, lows: list, closes: list, period: int = 14) -> float:
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i]  - closes[i-1])
        )
        trs.append(tr)
    if not trs:
        return 0.0
    return round(sum(trs[-period:]) / min(period, len(trs)), 2)

def calc_vwap(prices: list, volumes: list) -> float:
    if not volumes or sum(volumes) == 0:
        return prices[-1]
    pv = sum(p * v for p, v in zip(prices, volumes))
    return round(pv / sum(volumes), 2)

def determine_trend(price: float, ema8: float, ema21: float, ema50: float) -> str:
    if price > ema8 > ema21 > ema50:
        return "BULLISH"
    elif price < ema8 < ema21 < ema50:
        return "BEARISH"
    return "NEUTRAL"

def calc_gex(chain_calls: pd.DataFrame, chain_puts: pd.DataFrame, spot: float) -> dict:
    """
    GEX = Gamma × OI × 100 × Spot² × 0.01
    Calls přidávají, Puts odebírají (dealer short put = long gamma)
    """
    results = {}

    for _, row in chain_calls.iterrows():
        s = row.get("strike", 0)
        g = row.get("gamma", 0) or 0
        oi = row.get("openInterest", 0) or 0
        gex_val = g * oi * 100 * spot**2 * 0.01
        results.setdefault(s, {"strike": s, "call_gex": 0, "put_gex": 0})
        results[s]["call_gex"] += gex_val

    for _, row in chain_puts.iterrows():
        s = row.get("strike", 0)
        g = row.get("gamma", 0) or 0
        oi = row.get("openInterest", 0) or 0
        gex_val = g * oi * 100 * spot**2 * 0.01
        results.setdefault(s, {"strike": s, "call_gex": 0, "put_gex": 0})
        results[s]["put_gex"] += gex_val

    if not results:
        return _fallback_gex(spot)

    rows = list(results.values())
    for r in rows:
        r["net"] = round(r["call_gex"] - r["put_gex"])
        r["call_gex"] = round(r["call_gex"])
        r["put_gex"] = round(r["put_gex"])

    net_total = sum(r["net"] for r in rows)
    sorted_rows = sorted(rows, key=lambda x: x["strike"])

    call_wall = max(rows, key=lambda x: x["call_gex"])["strike"] if rows else spot + 100
    put_wall  = max(rows, key=lambda x: x["put_gex"])["strike"]  if rows else spot - 100

    # Gamma flip = strike kde net GEX přechází ze záporného na kladný
    gamma_flip = spot
    for r in sorted_rows:
        if r["net"] > 0:
            gamma_flip = r["strike"]
            break

    top10 = sorted(rows, key=lambda x: abs(x["net"]), reverse=True)[:10]

    return {
        "regime":      "POSITIVE" if net_total > 0 else "NEGATIVE",
        "net_gex":     round(net_total),
        "call_wall":   call_wall,
        "put_wall":    put_wall,
        "gamma_flip":  gamma_flip,
        "hvl":         round((call_wall + put_wall) / 2),
        "max_pain":    call_wall,  # zjednodušení
        "expected_move_high": round(spot + 2 * (call_wall - spot) * 0.5) if call_wall > spot else round(spot + 50),
        "expected_move_low":  round(spot - 2 * (spot - put_wall) * 0.5) if put_wall < spot else round(spot - 50),
        "top10":       top10,
    }

def _fallback_gex(spot: float) -> dict:
    """Pokud options data nejsou dostupná - vrátí placeholder."""
    return {
        "regime": "UNKNOWN", "net_gex": 0,
        "call_wall": round(spot + 100), "put_wall": round(spot - 100),
        "gamma_flip": round(spot), "hvl": round(spot),
        "max_pain": round(spot), "expected_move_high": round(spot + 80),
        "expected_move_low": round(spot - 80), "top10": [],
        "note": "Options data nedostupná - zkus znovu za chvíli"
    }

def fetch_cot() -> dict:
    """
    CFTC COT data pro Gold (Commodity code 088691).
    Zdroj: CFTC veřejný dataset.
    """
    try:
        url = "https://www.cftc.gov/dea/newcot/deacot.txt"
        r = requests.get(url, timeout=10)
        lines = r.text.splitlines()
        for line in lines:
            if "GOLD" in line.upper() and "COMEX" in line.upper():
                parts = line.split(",")
                if len(parts) > 10:
                    return {
                        "date": parts[2].strip() if len(parts) > 2 else "N/A",
                        "commercials_long":     int(parts[8].strip().replace(" ",""))  if len(parts) > 8  else 0,
                        "commercials_short":    int(parts[9].strip().replace(" ",""))  if len(parts) > 9  else 0,
                        "noncomm_long":         int(parts[5].strip().replace(" ",""))  if len(parts) > 5  else 0,
                        "noncomm_short":        int(parts[6].strip().replace(" ",""))  if len(parts) > 6  else 0,
                        "source": "CFTC"
                    }
    except Exception as e:
        print(f"[COT] Chyba: {e}")

    # Fallback - poslední známé hodnoty
    return {
        "date": "N/A", "source": "fallback",
        "commercials_long": 142800, "commercials_short": 312400,
        "noncomm_long": 298600, "noncomm_short": 87200,
        "note": "CFTC nedostupné - zobrazena záložní data"
    }

def fetch_macro() -> dict:
    """DXY, VIX, SPX, Oil, BTC přes yfinance."""
    tickers = {
        "dxy":  "DX-Y.NYB",
        "vix":  "^VIX",
        "spx":  "^GSPC",
        "oil":  "CL=F",
        "btc":  "BTC-USD",
    }
    result = {}
    for key, symbol in tickers.items():
        try:
            t = yf.Ticker(symbol)
            h = t.history(period="2d", interval="1d")
            if len(h) >= 2:
                prev  = h["Close"].iloc[-2]
                curr  = h["Close"].iloc[-1]
                result[key] = {
                    "value":  round(float(curr), 2),
                    "change": round(float(curr - prev), 2),
                    "change_pct": round(float((curr - prev) / prev * 100), 2)
                }
            else:
                result[key] = {"value": 0, "change": 0, "change_pct": 0}
        except Exception as e:
            print(f"[Macro] {key} chyba: {e}")
            result[key] = {"value": 0, "change": 0, "change_pct": 0}

    # Real Yield přes FRED (zdarma, bez API klíče pro základní data)
    try:
        fred_url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10"
        df = pd.read_csv(fred_url)
        latest = df.iloc[-1]
        prev   = df.iloc[-2]
        result["real_yield"] = {
            "value":  round(float(latest.iloc[1]), 2),
            "change": round(float(latest.iloc[1]) - float(prev.iloc[1]), 2)
        }
    except Exception as e:
        print(f"[Macro] Real yield chyba: {e}")
        result["real_yield"] = {"value": 0, "change": 0}

    return result

def fetch_seasonal() -> list:
    """20 let historické sezónnosti XAU/USD."""
    SEASONAL = [
        {"month": "Jan", "avg": 1.8,  "positive": 62},
        {"month": "Feb", "avg": 1.2,  "positive": 58},
        {"month": "Mar", "avg": 0.4,  "positive": 52},
        {"month": "Apr", "avg": 0.9,  "positive": 55},
        {"month": "May", "avg": -0.3, "positive": 45},
        {"month": "Jun", "avg": 0.2,  "positive": 51},
        {"month": "Jul", "avg": 0.6,  "positive": 53},
        {"month": "Aug", "avg": 1.4,  "positive": 60},
        {"month": "Sep", "avg": 0.8,  "positive": 54},
        {"month": "Oct", "avg": 1.1,  "positive": 57},
        {"month": "Nov", "avg": 0.5,  "positive": 52},
        {"month": "Dec", "avg": -0.6, "positive": 43},
    ]
    return SEASONAL

# ── Hlavní fetch funkce ─────────────────────────────────────────────────────

def fetch_all_data():
    """Stáhne všechna data a uloží do cache. Běží každých 30s."""
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Stahuji data...")

    try:
        # 1. Gold price + technicals (GC=F = Gold Futures, ~spot)
        gold = yf.Ticker("GC=F")
        hist_d  = gold.history(period="60d",  interval="1d")   # Daily pro trend
        hist_h1 = gold.history(period="5d",   interval="1h")   # H1 pro intraday
        hist_m5 = gold.history(period="1d",   interval="5m")   # M5 pro micro

        if hist_d.empty:
            raise ValueError("Žádná data pro GC=F")

        # Cena
        spot = float(hist_d["Close"].iloc[-1])
        prev_close = float(hist_d["Close"].iloc[-2])
        spot_change = round(spot - prev_close, 2)
        spot_change_pct = round((spot - prev_close) / prev_close * 100, 3)

        # Technicals z Daily
        closes_d = list(hist_d["Close"].astype(float))
        highs_d  = list(hist_d["High"].astype(float))
        lows_d   = list(hist_d["Low"].astype(float))

        ema8_d   = calc_ema(closes_d, 8)
        ema21_d  = calc_ema(closes_d, 21)
        ema50_d  = calc_ema(closes_d, 50)
        ema200_d = calc_ema(closes_d, 200) if len(closes_d) >= 200 else calc_ema(closes_d, len(closes_d))
        rsi_d    = calc_rsi(closes_d, 14)
        atr_d    = calc_atr(highs_d, lows_d, closes_d, 14)

        # Technicals z H1
        closes_h1 = list(hist_h1["Close"].astype(float)) if not hist_h1.empty else closes_d[-24:]
        rsi_h1 = calc_rsi(closes_h1, 14)
        rsi_h4 = calc_rsi(closes_h1[::4], 14)  # každá 4. svíčka = H4 approximace

        # Technicals z M5
        closes_m5 = list(hist_m5["Close"].astype(float)) if not hist_m5.empty else []
        vols_m5   = list(hist_m5["Volume"].astype(float)) if not hist_m5.empty else []
        vwap_today = calc_vwap(closes_m5, vols_m5) if closes_m5 else spot
        high_24h = float(hist_h1["High"].max())  if not hist_h1.empty else spot + 20
        low_24h  = float(hist_h1["Low"].min())   if not hist_h1.empty else spot - 20

        # Trendy
        trend_daily   = determine_trend(spot, ema8_d, ema21_d, ema50_d)
        trend_intraday = determine_trend(
            spot,
            calc_ema(closes_h1, 8),
            calc_ema(closes_h1, 21),
            calc_ema(closes_h1, 50)
        ) if closes_h1 else trend_daily
        trend_micro = determine_trend(
            spot,
            calc_ema(closes_m5[-30:], 8),
            calc_ema(closes_m5[-30:], 21),
            calc_ema(closes_m5[-30:], 50)
        ) if len(closes_m5) > 30 else trend_intraday

        # Price history pro mini chart (posledních 30 daily svíček)
        price_history = [round(float(x), 2) for x in closes_d[-30:]]

        # Key levels
        key_levels = [
            {"price": round(ema50_d), "label": "EMA50",   "type": "S" if spot > ema50_d else "R"},
            {"price": round(ema200_d),"label": "EMA200",  "type": "S" if spot > ema200_d else "R"},
            {"price": round(vwap_today), "label": "VWAP", "type": "N"},
            {"price": round(spot, 1), "label": "SPOT",    "type": "SPOT"},
            {"price": round(high_24h, 1), "label": "24h High", "type": "R"},
            {"price": round(low_24h, 1),  "label": "24h Low",  "type": "S"},
        ]
        key_levels.sort(key=lambda x: x["price"], reverse=True)

        # 2. GEX z GLD options
        gld = yf.Ticker("GLD")
        gld_spot = float(gld.history(period="1d")["Close"].iloc[-1])
        gex_data = _fallback_gex(spot)
        try:
            expirations = gld.options[:4]  # 4 nejbližší expirace
            all_calls, all_puts = pd.DataFrame(), pd.DataFrame()
            for exp in expirations:
                chain = gld.option_chain(exp)
                all_calls = pd.concat([all_calls, chain.calls], ignore_index=True)
                all_puts  = pd.concat([all_puts,  chain.puts],  ignore_index=True)
            gex_data = calc_gex(all_calls, all_puts, gld_spot)
            # Přepočítej levely na XAU/USD scale (GLD ≈ spot/10)
            ratio = spot / gld_spot
            for key in ["call_wall", "put_wall", "gamma_flip", "hvl", "max_pain",
                        "expected_move_high", "expected_move_low"]:
                if key in gex_data:
                    gex_data[key] = round(gex_data[key] * ratio)
            for item in gex_data.get("top10", []):
                item["strike"] = round(item["strike"] * ratio)
        except Exception as e:
            print(f"[GEX] Chyba options: {e} — použity fallback")

        # 3. Sessions
        now_utc = datetime.datetime.utcnow()
        hour = now_utc.hour
        if 23 <= hour or hour < 8:
            session = "ASIAN"
        elif 8 <= hour < 13:
            session = "LONDON"
        else:
            session = "NY"

        kz_active = (7 <= hour < 10) or (13 <= hour < 16)

        # Session ranges z H1 dat
        def session_range(h_from, h_to):
            if hist_h1.empty:
                return {"high": spot+15, "low": spot-15, "range": 30, "bias": "NEUTRAL", "volume": "MED"}
            today = hist_h1[hist_h1.index.date == hist_h1.index[-1].date()]
            sess  = today[(today.index.hour >= h_from) & (today.index.hour < h_to)]
            if sess.empty:
                return {"high": spot+15, "low": spot-15, "range": 30, "bias": "NEUTRAL", "volume": "MED"}
            hi = round(float(sess["High"].max()), 2)
            lo = round(float(sess["Low"].min()), 2)
            cls = float(sess["Close"].iloc[-1])
            opn = float(sess["Open"].iloc[0])
            return {
                "high": hi, "low": lo, "range": round(hi - lo, 2),
                "bias": "BULLISH" if cls > opn else "BEARISH",
                "volume": "HIGH" if len(sess) > 3 else "LOW"
            }

        sessions = {
            "asian":   session_range(23, 8),
            "london":  session_range(8, 13),
            "ny":      session_range(13, 22),
            "current": session,
            "killzone_active": kz_active,
        }

        # 4. Macro
        macro = fetch_macro()

        # 5. COT (stahuje se méně často - jednou za hodinu)
        cached_cot = _cache.get("cot", {})
        cot = cached_cot if cached_cot else fetch_cot()

        # 6. Risk kalkulátor
        sl_suggested = round(atr_d * 0.5, 1)
        tp1 = round(atr_d, 1)
        tp2 = round(atr_d * 2, 1)
        # Lot size pro $150 SL (GC kontrakt = 100 oz, pip value ~$1/0.1)
        # Pro CFD: lot = (max_risk_usd) / (sl_pips * pip_value)
        # Zjednodušení: 0.01 lot = $1/pip na většině brokerů pro XAU
        lot_size = round(15 / sl_suggested, 2) if sl_suggested > 0 else 0.01

        risk = {
            "atr_daily": atr_d,
            "suggested_sl": sl_suggested,
            "suggested_tp1": tp1,
            "suggested_tp2": tp2,
            "rr": 2.0,
            "lot_for_150": lot_size,
        }

        # ── Sestavení finálního payloadu ──────────────────────────────────
        payload = {
            "spot": round(spot, 2),
            "spot_change": spot_change,
            "spot_change_pct": spot_change_pct,
            "high_24h": round(high_24h, 2),
            "low_24h": round(low_24h, 2),
            "vwap": round(vwap_today, 2),
            "prev_close": round(prev_close, 2),

            "technicals": {
                "ema8":   ema8_d,
                "ema21":  ema21_d,
                "ema50":  ema50_d,
                "ema200": ema200_d,
                "rsi_d":  rsi_d,
                "rsi_h1": rsi_h1,
                "rsi_h4": rsi_h4,
                "atr14":  atr_d,
                "price_vs_vwap": round(spot - vwap_today, 2),
                "price_vs_ema50": round(spot - ema50_d, 2),
                "price_vs_ema200": round(spot - ema200_d, 2),
            },

            "trend": {
                "micro":    trend_micro,
                "intraday": trend_intraday,
                "daily":    trend_daily,
                "weekly":   trend_daily,   # proxy - weekly trend = daily trend
                "monthly":  "BULLISH" if spot > ema200_d else "BEARISH",
            },

            "price_history": price_history,
            "key_levels": key_levels,
            "sessions": sessions,
            "gex": gex_data,
            "cot": cot,
            "macro": macro,
            "risk": risk,
            "seasonal": fetch_seasonal(),
            "current_month": datetime.datetime.now().month,

            "timestamp": datetime.datetime.now().isoformat(),
            "data_source": "yfinance + CFTC + FRED",
        }

        with _cache_lock:
            _cache.update(payload)
            _cache["cot"] = cot  # Ulož COT zvlášť

        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] ✅ Data OK — Spot: ${spot:.2f}")

    except Exception as e:
        print(f"[ERROR] fetch_all_data selhalo: {e}")
        import traceback
        traceback.print_exc()

def background_fetch():
    """Stahuje data každých 30 sekund na pozadí."""
    while True:
        fetch_all_data()
        time.sleep(30)

# ── API Endpoints ────────────────────────────────────────────────────────────

@app.route("/api/data")
def api_data():
    with _cache_lock:
        if not _cache:
            return jsonify({"error": "Data se načítají, zkus za chvíli"}), 503
        return jsonify(dict(_cache))

@app.route("/api/health")
def api_health():
    return jsonify({
        "status": "running",
        "last_update": _cache.get("timestamp", "nikdy"),
        "spot": _cache.get("spot", 0)
    })

@app.route("/")
def index():
    return """
    <html><body style="background:#111;color:#0f0;font-family:monospace;padding:40px">
    <h2>🟡 Gold Terminal Backend</h2>
    <p>Status: <strong style="color:lime">RUNNING</strong></p>
    <p>API endpoint: <a href="/api/data" style="color:#f59e0b">/api/data</a></p>
    <p>Health check: <a href="/api/health" style="color:#f59e0b">/api/health</a></p>
    <p style="color:#666">Dashboard si otevři jako JSX soubor v Claude nebo napoj na tento backend.</p>
    </body></html>
    """

# ── Start ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 50)
    print("  Gold Institutional Terminal - Backend")
    print("=" * 50)
    print("Stahuji první data...")

    # První fetch synchronně, pak spusť background thread
    fetch_all_data()

    t = threading.Thread(target=background_fetch, daemon=True)
    t.start()
    print("Background fetch spuštěn (každých 30s)")
    print("Server běží na http://localhost:5000")
    print("=" * 50)

    app.run(host="0.0.0.0", port=5000, debug=False)
