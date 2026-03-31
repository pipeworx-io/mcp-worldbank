# @pipeworx/mcp-worldbank

MCP server for World Bank data — country stats, GDP, population, and development indicators via the World Bank Data API.

## Tools

| Tool | Description |
|------|-------------|
| `get_country` | Get basic country info (region, income level, capital, coordinates) |
| `get_indicator` | Get time-series data for any World Bank indicator |
| `get_population` | Get total population over time (shortcut) |
| `get_gdp` | Get GDP in current USD over time (shortcut) |

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "worldbank": {
      "url": "https://gateway.pipeworx.io/worldbank/mcp"
    }
  }
}
```

Or run via CLI:

```bash
npx pipeworx use worldbank
```

## License

MIT
