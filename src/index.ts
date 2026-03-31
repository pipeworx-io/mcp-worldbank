/**
 * World Bank MCP — wraps the World Bank Data API v2 (free, no auth)
 *
 * Tools:
 * - get_country: basic country info (region, income level, capital, coordinates)
 * - get_indicator: time-series data for any World Bank indicator
 * - get_population: shortcut for SP.POP.TOTL (total population)
 * - get_gdp: shortcut for NY.GDP.MKTP.CD (GDP in current USD)
 *
 * Common indicators:
 *   NY.GDP.MKTP.CD  — GDP (current USD)
 *   SP.POP.TOTL     — Population, total
 *   EN.ATM.CO2E.KT  — CO2 emissions (kt)
 *   SE.ADT.LITR.ZS  — Literacy rate, adult total (% of people 15+)
 *   SH.DYN.MORT     — Mortality rate, under-5 (per 1,000 live births)
 *   SI.POV.GINI     — Gini index
 */

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

const BASE_URL = 'https://api.worldbank.org/v2';

const tools: McpToolExport['tools'] = [
  {
    name: 'get_country',
    description:
      'Get basic information about a country: full name, region, income level, capital city, and coordinates. Use ISO 3166-1 alpha-2 or alpha-3 country codes (e.g., "US", "GBR", "IN").',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: 'ISO country code (2 or 3 letters, e.g., "US", "GBR", "CN")',
        },
      },
      required: ['country_code'],
    },
  },
  {
    name: 'get_indicator',
    description:
      'Get time-series values for a World Bank indicator for a specific country. Common indicators: NY.GDP.MKTP.CD (GDP), SP.POP.TOTL (population), EN.ATM.CO2E.KT (CO2 emissions), SE.ADT.LITR.ZS (literacy rate).',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: 'ISO country code (e.g., "US", "GBR", "CN")',
        },
        indicator: {
          type: 'string',
          description: 'World Bank indicator code (e.g., "NY.GDP.MKTP.CD", "SP.POP.TOTL")',
        },
        date_range: {
          type: 'string',
          description:
            'Year range in format "start:end" (default: 2015:2024). Example: "2000:2023"',
        },
      },
      required: ['country_code', 'indicator'],
    },
  },
  {
    name: 'get_population',
    description:
      'Get total population over time for a country. Shortcut for get_indicator with SP.POP.TOTL.',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: 'ISO country code (e.g., "US", "GBR", "CN")',
        },
      },
      required: ['country_code'],
    },
  },
  {
    name: 'get_gdp',
    description:
      'Get GDP (current USD) over time for a country. Shortcut for get_indicator with NY.GDP.MKTP.CD.',
    inputSchema: {
      type: 'object',
      properties: {
        country_code: {
          type: 'string',
          description: 'ISO country code (e.g., "US", "GBR", "CN")',
        },
      },
      required: ['country_code'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_country':
      return getCountry(args.country_code as string);
    case 'get_indicator':
      return getIndicator(
        args.country_code as string,
        args.indicator as string,
        (args.date_range as string) ?? '2015:2024',
      );
    case 'get_population':
      return getIndicator(args.country_code as string, 'SP.POP.TOTL', '2015:2024');
    case 'get_gdp':
      return getIndicator(args.country_code as string, 'NY.GDP.MKTP.CD', '2015:2024');
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getCountry(code: string) {
  const res = await fetch(
    `${BASE_URL}/country/${encodeURIComponent(code)}?format=json`,
  );
  if (!res.ok) throw new Error(`World Bank API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as [
    { total?: number; page?: number },
    {
      id: string;
      iso2Code: string;
      name: string;
      region?: { id?: string; value?: string };
      adminregion?: { id?: string; value?: string };
      incomeLevel?: { id?: string; value?: string };
      lendingType?: { id?: string; value?: string };
      capitalCity?: string;
      longitude?: string;
      latitude?: string;
    }[],
  ];

  const meta = data[0];
  const countries = data[1];

  if (!countries || countries.length === 0 || meta?.total === 0) {
    throw new Error(`Country not found: ${code}`);
  }

  const c = countries[0];
  return {
    id: c.id,
    iso2: c.iso2Code,
    name: c.name,
    region: c.region?.value ?? null,
    admin_region: c.adminregion?.value ?? null,
    income_level: c.incomeLevel?.value ?? null,
    lending_type: c.lendingType?.value ?? null,
    capital: c.capitalCity ?? null,
    longitude: c.longitude ? parseFloat(c.longitude) : null,
    latitude: c.latitude ? parseFloat(c.latitude) : null,
  };
}

async function getIndicator(countryCode: string, indicator: string, dateRange: string) {
  const params = new URLSearchParams({
    format: 'json',
    date: dateRange,
    per_page: '50',
  });

  const res = await fetch(
    `${BASE_URL}/country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicator)}?${params}`,
  );
  if (!res.ok) throw new Error(`World Bank API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as [
    { total?: number; page?: number; pages?: number; per_page?: string; lastupdated?: string },
    {
      indicator?: { id?: string; value?: string };
      country?: { id?: string; value?: string };
      countryiso3code?: string;
      date?: string;
      value?: number | null;
      unit?: string;
      obs_status?: string;
      decimal?: number;
    }[] | null,
  ];

  const meta = data[0];
  const values = data[1];

  if (!values || values.length === 0) {
    throw new Error(`No data found for indicator "${indicator}" in country "${countryCode}"`);
  }

  const firstEntry = values[0];
  return {
    country: firstEntry.country?.value ?? countryCode.toUpperCase(),
    country_id: firstEntry.country?.id ?? null,
    indicator_id: firstEntry.indicator?.id ?? indicator,
    indicator_name: firstEntry.indicator?.value ?? null,
    date_range: dateRange,
    total_records: meta?.total ?? values.length,
    last_updated: meta?.lastupdated ?? null,
    data: values
      .filter((v) => v.value !== null && v.value !== undefined)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map((v) => ({
        year: v.date ?? null,
        value: v.value ?? null,
      })),
  };
}

export default { tools, callTool } satisfies McpToolExport;
