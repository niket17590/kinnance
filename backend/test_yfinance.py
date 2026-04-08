import yfinance as yf

for sym in ['QESS', 'QESS.CN', 'SHOP', 'SHOP.TO', 'BB', 'BB.TO', 'RY.TO', 'ZSP.TO', 'DLR.TO', 'QNC' ]:
    try:
        t = yf.Ticker(sym)
        hist = t.history(period='5d')
        info = t.info
        if not hist.empty:
            print(f"OK {sym}: {info.get('longName','?')} | last={hist['Close'].iloc[-1]:.2f} {info.get('currency','?')}")
        else:
            print(f"NO DATA {sym}")
    except Exception as e:
        print(f"ERROR {sym}: {e}")