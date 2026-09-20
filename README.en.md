# Community Temperature — a fear index from retail chatter

**[한국어](README.md) (full) · English · [中文](README.zh.md)**

**Live → [havanafrog-stock.duckdns.org/?k=R9HzHDGxVnjYeJ5Vqton1w](https://havanafrog-stock.duckdns.org/?k=R9HzHDGxVnjYeJ5Vqton1w)**
Open that keyed link once and the cookie carries you afterwards. Without the key every path returns 404.

Scores what people say in [Toss Securities](https://www.tossinvest.com/) stock communities, turns it into a
**fear index**, and puts it beside a candlestick chart on the same time axis.

**No LLM at runtime.** Scoring is a character n-gram classifier with a dictionary
fallback. No API keys, no token bills. The whole thing is dependency-free Node.

> The full documentation is in Korean: **[README.md](README.md)**. This page is a summary.

---

## What makes it different

Most social-sentiment tools count **mentions** or a **bull/bear ratio**. This one
measures how unusual the *number of fearful posts* is, against a baseline built
per ticker, per hour of the US trading day, per bar length.

```
k     = fearful posts inside the bar's window
μ, σ  = usual count for that ticker · that US Eastern hour · that bar length

z      = (k − μ) / σ
fear   = clamp(50 + 20z, 0, 100)      50 = normal · 90 = alarm
```

Counting instead of ratio-ing matters: a board that is 80% fearful but has three
posts is not the same event as one that is 30% fearful across four hundred.
Normalising per hour-of-day matters because a Korean board at 23:30 KST
(market open in New York) is a different place than at 08:00.

| | Approach | Source |
|---|---|---|
| [ApeWisdom](https://apewisdom.io/wallstreetbets/) | raw mention counts, hourly | ~30 subreddits |
| [SwaggyStocks](https://swaggystocks.com/dashboard/wallstreetbets/ticker-sentiment) | keyword bull/bear ratio | r/wallstreetbets |
| [StockTwits](https://stocktwits.com/) | users self-label Bullish/Bearish | own community |
| [CNN Fear & Greed](https://www.cnn.com/markets/fear-and-greed) | 7 market internals (VIX, breadth, put/call) | market data, not chatter |
| **this** | **z-score of fear-post *count* vs per-hour baseline** | **Toss Securities (Korean retail)** |

As far as I can tell nothing public covers Korean brokerage communities this way.

## Screens

One page, five tabs: **Board** (sortable table of price, change, volume vs prior day,
turnover, strength, fear), **Live** (1/10/60-minute and daily candles, MA 20/120/200,
fear index and its MACD, last hour of posts), **Analysis** (whole collection period
as a table, CSV export), **Posts** (search and filter what was collected), **How** (every formula).

Pinch to zoom on a phone, wheel on a desktop, drag to pan, double-tap to reset.
The fear chart shares the candle grid, so one vertical line reads both.

## Run it

```bash
node fetch-comments.mjs   # → data/{TICKER}.posts.json   posts (incremental; 40–60 min the first time)
node build.mjs            # → data.js                    daily bars + scoring + baselines (seconds)
node server.mjs           # → http://localhost:8731      live server
```

Node 24. No dependencies. `node build.mjs --selftest` runs 74 checks with no network.

**Why a server at all?** The Toss API rejects any request carrying an `Origin`
header, and browsers always attach one on cross-origin requests. Static hosting
alone cannot fetch live prices, candles, or posts. Node calls, then hands over the result.

## Sentiment scoring

A character n-gram naive Bayes classifier splits positive / negative / neutral,
trained on 15,813 labels — most written by EXAONE 3.5 7.8B, some by a human.
If `model.json` is absent it falls back to a 68-word dictionary with negation
flipping. Browser and Node read the same `lexicon.js`, so the two can never drift.

**Two rulers, on purpose.** Measuring against the SLM's own labels only tells you
how well you imitate the SLM. So 240 posts (80 each of P/N/X) were re-labelled by
hand with the original labels hidden, and no model ever trains on them.
Against that human ruler the SLM itself scored 68.8%.

## Limits

- **Undocumented internal API.** It can change without notice; collection dies when it does.
- **The answer key is not human.** The classifier inherits the SLM's eyes, including its mistakes.
- **It over-calls negative.** 53.0% precision on the human ruler — nearly half of what a
  person reads as neutral gets called negative. That is the price of cutting missed
  negatives from 65% to 14%.
- **Fear words are still a dictionary.** Irony and new slang slip through. Because the
  baseline uses the same scorer, steady false positives wash out in the z-score —
  what you are reading is change, not absolute level.
- **Count-based, so a crowd alone lifts it.** The tooltip shows `posts / fearful` together.
- **Correlation is not causation.** A fear spike preceding a move did not predict it.

## Do not trade on this

This counts what people said. It is not a forecast and not investment advice.
