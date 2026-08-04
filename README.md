# World Bank — Development Indicators and Country Data

The World Bank Open Data API. Thousands of development, economic, social, and demographic indicators for every country. Time series going back decades. The canonical source for cross-country comparisons of poverty, education, health, gender, environment, infrastructure. Free, no auth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Why this matters for AI agents

For development questions, cross-country comparisons of social indicators, or any "how does country X compare on indicator Y" question, the World Bank's database is the right starting point. Complements [IMF](/docs/reference/imf) (macro/fiscal) with development-specific coverage (WDI, EdStats, GenderStats, etc.).

Common flows:

- **Indicator lookup.** "GDP per capita PPP for India" → World Bank indicator `NY.GDP.PCAP.PP.CD` for India.
- **Country comparison.** Same indicator across multiple countries.
- **Theme browsing.** Education indicators, health indicators, environment indicators, etc.

## Auth

None. World Bank Open Data is fully public, free.

## Indicator code structure

World Bank indicator codes follow a domain.theme.metric pattern:

| Code | Indicator |
|---|---|
| `NY.GDP.MKTP.CD` | GDP (current US$) |
| `NY.GDP.PCAP.PP.CD` | GDP per capita, PPP (current intl $) |
| `SP.POP.TOTL` | Total population |
| `SE.PRM.ENRR` | Primary school enrollment, gross % |
| `EG.ELC.ACCS.ZS` | Access to electricity, % of population |
| `SI.POV.GINI` | Gini index |
| `EN.ATM.CO2E.PC` | CO2 emissions per capita |

Search the catalog when you don't know the code.

## Country and country-group codes

World Bank uses ISO 3-letter codes (USA, BRA, IND) plus aggregate codes:

- `WLD` — World
- `EUU` — European Union
- `LMC` — Lower middle income
- `OED` — OECD members
- `SSA` — Sub-Saharan Africa

Aggregate codes are useful for "how does X compare to its peer group?" questions.

## Common pitfalls

- **Indicator deprecation.** World Bank periodically retires/replaces indicators. The API marks deprecated ones; prefer current ones for new analysis.
- **Coverage gaps.** Not every country reports every indicator every year. The API returns nulls for missing data. Compute aggregates carefully.
- **Vintages.** Indicator values can be revised. Cite the vintage if precision matters.
- **Real vs nominal.** Many financial indicators come in both nominal (current dollars) and real (constant dollars). The `.CD` suffix is current dollars; `.KD` is constant.
- **PPP vs market exchange rate.** Cross-country GDP comparison should use PPP for most "how rich is X" questions; market rates for "what does X export" questions.
- **Data freshness.** World Bank consolidates from member-country reporting; lag varies. Most recent year for many indicators is 1–2 years prior. Check data availability before promising "current."

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "worldbank": {
      "url": "https://gateway.pipeworx.io/worldbank/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Worldbank data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
