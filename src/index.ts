interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * World Bank MCP — wraps the World Bank Data API v2 (free, no auth)
 *
 * Tools:
 * - get_country: basic country info (region, income level, capital, coordinates)
 * - get_indicator: time-series data for any World Bank indicator
 * - get_population: shortcut for SP.POP.TOTL (total population)
 * - get_gdp: shortcut for NY.GDP.MKTP.CD (GDP in current USD)
 * - compare_countries: rank an indicator across multiple countries
 * - country_co2_emissions: national CO2 for any country — the discoverable
 *   entry point for "CO2 emissions by country" (see RETIRED SERIES below)
 *
 * Common indicators:
 *   NY.GDP.MKTP.CD  — GDP (current USD)
 *   SP.POP.TOTL     — Population, total
 *   EN.GHG.CO2.MT.CE.AR5 — CO2 excl. LULUCF (Mt CO2e), AR5 basis
 *   SE.ADT.LITR.ZS  — Literacy rate, adult total (% of people 15+)
 *   SH.DYN.MORT     — Mortality rate, under-5 (per 1,000 live births)
 *   SI.POV.GINI     — Gini index
 *
 * RETIRED SERIES — do not reintroduce. The World Bank DELETED the CDIAC-based
 * EN.ATM.CO2E.* family (EN.ATM.CO2E.PC, .KT). The API answers a request for one
 * with "The indicator was not found. It may have been deleted or archived."
 * Those codes were recommended in this pack's OWN tool descriptions until
 * 2026-07-29, which sent agents to a dead series. The live replacement is the
 * AR5 family (EN.GHG.*), sourced from Climate Watch/PIK, current through 2024.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Worldbank');
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
      'Get World Bank time-series data — economic, social, and development statistics — for ANY country worldwide (Spain, Brazil, Germany, Nigeria, Japan, etc.). PREFER for "unemployment rate in <country>", "<country> inflation rate", "GDP of <country>", "<country> population / life expectancy / poverty rate / CO2 emissions". Pass the ISO country code + a World Bank indicator code; common ones: GDP=NY.GDP.MKTP.CD, GDP per capita=NY.GDP.PCAP.CD, inflation=FP.CPI.TOTL.ZG, unemployment=SL.UEM.TOTL.ZS, population=SP.POP.TOTL, life expectancy=SP.DYN.LE00.IN, poverty rate=SI.POV.DDAY, literacy=SE.ADT.LITR.ZS. For CO2 use the dedicated country_co2_emissions tool (the old EN.ATM.CO2E.* codes were DELETED by the World Bank; the live series is EN.GHG.CO2.MT.CE.AR5). (Annual data — a national statistics office may have fresher monthly figures.)',
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
      'Fetch annual total population (SP.POP.TOTL) for a country from the World Bank, defaulting to 2015–2024. Returns a year-by-year array of values. Shortcut for get_indicator.',
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
      'Fetch annual GDP in current USD (NY.GDP.MKTP.CD) for a country from the World Bank, defaulting to 2015–2024. Returns a year-by-year array of values. Shortcut for get_indicator.',
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
    name: 'compare_countries',
    description:
      'Compare a World Bank indicator across MULTIPLE countries in one call, returned ranked high→low. PREFER for "GDP per capita: US vs China vs Germany", "rank the G7 by CO2 emissions", "compare population of <countries>". Pass 2+ ISO country codes. Defaults to each country\'s most-recent available value; pass a year for a specific year. Common indicators: NY.GDP.MKTP.CD (GDP), NY.GDP.PCAP.CD (GDP per capita), SP.POP.TOTL (population), EN.GHG.CO2.MT.CE.AR5 (CO2, Mt), FP.CPI.TOTL.ZG (inflation %). For CO2 rankings prefer country_co2_emissions, which knows the right series.',
    inputSchema: {
      type: 'object',
      properties: {
        country_codes: {
          type: 'string',
          description: '2+ ISO country codes, comma- or semicolon-separated (e.g. "US,CN,DE" or "USA;CHN;DEU").',
        },
        indicator: {
          type: 'string',
          description: 'World Bank indicator code (e.g. "NY.GDP.PCAP.CD", "SP.POP.TOTL", "EN.GHG.CO2.MT.CE.AR5").',
        },
        year: {
          type: 'string',
          description: 'Optional 4-digit year (e.g. "2023"). Omit for each country\'s most-recent available value.',
        },
      },
      required: ['country_codes', 'indicator'],
    },
  },
  {
    name: 'country_co2_emissions',
    description:
      'National CO2 emissions for ANY country worldwide, annual, from the World Bank (AR5 basis, excluding LULUCF). PREFER for "CO2 emissions of <country>", "how much CO2 does <country> emit", "carbon emissions by country", "rank countries by CO2", "<country> emissions per capita", "CO2 emissions trend for <country>". Pass one country for a year-by-year series, or several to rank them high→low. Set per_capita for tonnes per person. NOTE: other emissions tools in this catalog are US-only (EPA facility/sector data) or electricity grid-intensity — this is the one for country-level national totals.',
    inputSchema: {
      type: 'object',
      properties: {
        country_codes: {
          type: 'string',
          description:
            'One or more ISO country codes, comma- or semicolon-separated (e.g. "BR", "US,CN,IN"). Also accepts "WLD" for the world total.',
        },
        date_range: {
          type: 'string',
          description: 'Year range "start:end" (default "2015:2024"). Example: "2000:2024".',
        },
        per_capita: {
          type: 'boolean',
          description:
            'Return tonnes of CO2 per person instead of national totals (computed from population for the same year). Default false.',
        },
      },
      required: ['country_codes'],
    },
  },
];


// Agents naturally pass `country` / `countries` (and camelCase) rather than the
// declared `country_code` / `country_codes`, which silently became the string
// "undefined" and produced 'No data found for indicator "undefined" in country
// "undefined"'. Accept the obvious aliases instead of failing on a name.
function argAlias(args: Record<string, unknown>, names: string[]): string | undefined {
  for (const n of names) {
    const v = args[n];
    if (typeof v === 'string' && v.trim() && v.trim() !== 'undefined') return v.trim();
    if (Array.isArray(v) && v.length) return v.map(String).join(';');
  }
  return undefined;
}

const COUNTRY_ALIASES = ['country_code', 'country', 'countryCode', 'iso', 'iso_code', 'country_iso'];
const COUNTRIES_ALIASES = ['country_codes', 'countries', 'countryCodes', 'country_code', 'country'];
const INDICATOR_ALIASES = ['indicator', 'indicator_code', 'indicatorCode', 'series', 'metric'];

function requireArg(v: string | undefined, label: string, example: string): string {
  if (!v) {
    throw new Error(`Required argument "${label}" is missing. ${example}`);
  }
  return v;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_country':
      return getCountry(requireArg(argAlias(args, COUNTRY_ALIASES), 'country_code',
        'Pass an ISO country code, e.g. get_country({country_code: "BR"}).'));
    case 'get_indicator':
      return getIndicator(
        requireArg(argAlias(args, COUNTRY_ALIASES), 'country_code',
          'Pass an ISO country code, e.g. get_indicator({country_code: "US", indicator: "NY.GDP.MKTP.CD"}).'),
        requireArg(argAlias(args, INDICATOR_ALIASES), 'indicator',
          'Pass a World Bank indicator code, e.g. "NY.GDP.MKTP.CD" (GDP) or "SP.POP.TOTL" (population).'),
        (args.date_range as string) || '2015:2024',
      );
    case 'get_population':
      return getIndicator(requireArg(argAlias(args, COUNTRY_ALIASES), 'country_code',
        'Pass an ISO country code, e.g. get_population({country_code: "NG"}).'), 'SP.POP.TOTL', '2015:2024');
    case 'get_gdp':
      return getIndicator(requireArg(argAlias(args, COUNTRY_ALIASES), 'country_code',
        'Pass an ISO country code, e.g. get_gdp({country_code: "DE"}).'), 'NY.GDP.MKTP.CD', '2015:2024');
    case 'compare_countries':
      return compareCountries(
        requireArg(argAlias(args, COUNTRIES_ALIASES), 'country_codes',
          'Pass semicolon-separated ISO codes, e.g. compare_countries({country_codes: "US;CN;IN", indicator: "NY.GDP.MKTP.CD"}).'),
        requireArg(argAlias(args, INDICATOR_ALIASES), 'indicator',
          'Pass a World Bank indicator code, e.g. "NY.GDP.MKTP.CD".'),
        typeof args.year === 'string' ? args.year : undefined,
      );
    case 'country_co2_emissions':
      return countryCo2Emissions(
        requireArg(argAlias(args, COUNTRIES_ALIASES), 'country_codes',
          'Pass one or more ISO country codes, e.g. country_co2_emissions({country_codes: "BR"}) or ({country_codes: "US,CN,IN"}).'),
        (args.date_range as string) || '2015:2024',
        args.per_capita === true || args.per_capita === 'true',
      );
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getCountry(code: string) {
  const res = await fetchWithRetry(
    `${BASE_URL}/country/${encodeURIComponent(code)}?format=json`,
  );
  if (!res.ok) throw await httpError(res, 'World Bank API error');

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

  const res = await fetchWithRetry(
    `${BASE_URL}/country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicator)}?${params}`,
  );

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
    // The codes that reach here are invented ones — `NY.GDP.MKTP.KD.ZS.AG` is a
    // real prefix with a made-up suffix, i.e. an agent guessing. Asking for a
    // series that doesn't exist is not our defect, and the `user_error:` prefix
    // also suppresses the retry fan-out, which cannot help a nonexistent code.
    throw new Error(
      `user_error: No data found for indicator "${indicator}" in country "${countryCode}". ` +
      `Indicator codes are exact and cannot be assembled by analogy — look the code up at ` +
      `https://data.worldbank.org/indicator, or use get_gdp / get_population / country_co2_emissions ` +
      `for the common series.`,
    );
  }

  const firstEntry = values[0];
  let rows = values
    .filter((v) => v.value !== null && v.value !== undefined)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .map((v) => ({
      year: v.date ?? null,
      value: v.value ?? null,
    }));

  // Silent-zero rescue (fleet #1343). The World Bank API can return HTTP 200
  // with `values.length > 0` — country and indicator both matched — while
  // EVERY row's `value` is null, because the requested window is narrower than
  // what has been published (e.g. "2020:2025" asked for an indicator whose
  // latest print is 2024). That filtered `rows` down to [] while total_records
  // stayed positive: a clean 200 that answers nothing, indistinguishable from
  // a real empty result to a caller that only checks status. Measured live
  // 2026-09-07: a 4-country fan-out where every worldbank leg came back this
  // shape (lookups=0, gaps=4) despite the indicator and all four country codes
  // being correct.
  //
  // One retry against the widest range this API will reasonably serve, mirroring
  // the FRED empty-window rescue (fred/src/index.ts) — same failure shape,
  // same fix. Only fires when the caller's own window produced nothing, so a
  // genuinely out-of-range request (e.g. a defunct series with real historical
  // data outside 1960-today) is unaffected.
  let rescueNote: string | undefined;
  if (rows.length === 0 && dateRange !== '1960:2025') {
    const rescueRes = await fetchWithRetry(
      `${BASE_URL}/country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicator)}?${new URLSearchParams({ format: 'json', date: '1960:2025', per_page: '50' })}`,
    );
    const rescueData = (await rescueRes.json()) as typeof data;
    const rescueValues = rescueData[1];
    if (rescueValues && rescueValues.length > 0) {
      rows = rescueValues
        .filter((v) => v.value !== null && v.value !== undefined)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, 10)
        .map((v) => ({ year: v.date ?? null, value: v.value ?? null }));
      if (rows.length > 0) {
        rescueNote = `No published value for "${indicator}" in ${countryCode.toUpperCase()} within ${dateRange} — that window has no data yet, not zero. Showing the latest available observations instead.`;
      }
    }
  }

  // Still nothing after the rescue: country and indicator both matched (we
  // would have thrown above otherwise), but every observation in EVERY window
  // we tried was null. That is a real absence, not a formatting slip — say so
  // instead of handing back total_records > 0 with data: [] and no
  // explanation, which reads as "it worked" to anything checking status alone.
  if (rows.length === 0) {
    throw new Error(
      `user_error: "${indicator}" for country "${countryCode}" matched (${meta?.total ?? values.length} record(s)) but every observation's value is null, in ${dateRange} and in the full 1960:2025 range. The series exists for this country but has no published numeric data.`,
    );
  }

  return {
    country: firstEntry.country?.value ?? countryCode.toUpperCase(),
    country_id: firstEntry.country?.id ?? null,
    indicator_id: firstEntry.indicator?.id ?? indicator,
    indicator_name: firstEntry.indicator?.value ?? null,
    date_range: dateRange,
    total_records: meta?.total ?? values.length,
    last_updated: meta?.lastupdated ?? null,
    ...(rescueNote ? { note: rescueNote } : {}),
    data: rows,
  };
}

/** CO2 excluding LULUCF, Mt CO2e, AR5 basis. Verified live 2026-07-29 (Germany
 *  2024 = 579.94 Mt, lastupdated 2026-07-13). Replaces the DELETED EN.ATM.CO2E.* */
const CO2_TOTAL_MT = 'EN.GHG.CO2.MT.CE.AR5';

interface WbRow {
  country?: { id?: string; value?: string };
  countryiso3code?: string;
  date?: string;
  value?: number | null;
}

/**
 * The World Bank API is measurably flaky: observed 2026-07-29 returning 400s
 * and hanging for minutes on URLs that answered 200 moments later, both from a
 * laptop and from the edge. So a first-attempt failure says little about the
 * request. One bounded retry converts most of that noise into a served answer.
 *
 * Deliberately retries 400 as well as 5xx, which is not normally sound — here
 * it is, because a genuinely bad parameter comes back as HTTP 200 with a
 * `message` block (handled below), not as a 400. Two attempts, not more: past
 * that we are queueing on a sick upstream rather than riding out a blip.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    try {
      const res = await pwFetch(url);
      if (res.ok) return res;
      lastErr = new Error(`World Bank API error: ${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Fetch one indicator for 1..n countries over a year range. */
async function fetchSeries(codes: string[], indicator: string, dateRange: string) {
  const params = new URLSearchParams({ format: 'json', date: dateRange, per_page: '1000' });
  const path = codes.map(encodeURIComponent).join(';');
  const res = await fetchWithRetry(`${BASE_URL}/country/${path}/indicator/${encodeURIComponent(indicator)}?${params}`);
  const data = (await res.json()) as [{ lastupdated?: string; message?: { value?: string }[] }, WbRow[] | null];
  const msg = data[0]?.message?.[0]?.value;
  if (msg) {
    // The indicator here is OURS (hardcoded), so an "invalid parameter" from the
    // World Bank is almost always a bad country code. Blaming the indicator
    // would send the caller to fix the one thing they didn't choose.
    throw new Error(
      `World Bank rejected the request for [${codes.join(', ')}]: ${msg}. Check the ISO country codes — use e.g. "BR", "USA", "CN", or "WLD" for the world total.`,
    );
  }
  return { lastUpdated: data[0]?.lastupdated ?? null, rows: data[1] ?? [] };
}

async function countryCo2Emissions(countryCodes: string, dateRange: string, perCapita: boolean) {
  const codes = String(countryCodes ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (codes.length === 0) {
    throw new Error('Provide at least one ISO country code, e.g. country_co2_emissions({country_codes: "BR"}).');
  }

  const co2 = await fetchSeries(codes, CO2_TOTAL_MT, dateRange);
  if (co2.rows.length === 0) {
    throw new Error(
      `No CO2 data found for [${codes.join(', ')}] over ${dateRange}. Check the ISO country codes — the World Bank uses e.g. "BR", "USA", "WLD" (world).`,
    );
  }

  // Per-capita is COMPUTED from two live series rather than read from a
  // per-capita indicator code. The obvious candidate (EN.GHG.CO2.PC.CE.AR5)
  // could not be verified against the API — it was down when this shipped — and
  // encoding an unverified code is how you ship a tool that answers "no data"
  // forever. SP.POP.TOTL and the CO2 series are both confirmed working.
  let pop: Map<string, number> | null = null;
  if (perCapita) {
    const p = await fetchSeries(codes, 'SP.POP.TOTL', dateRange);
    pop = new Map();
    for (const r of p.rows) {
      if (r.value != null && r.country?.id && r.date) pop.set(`${r.country.id}:${r.date}`, r.value);
    }
  }

  const points = co2.rows
    .filter((r) => r.value != null)
    .map((r) => {
      const people = pop?.get(`${r.country?.id ?? ''}:${r.date ?? ''}`);
      // Mt -> t is 1e6; dividing by people gives tonnes per person.
      const value = perCapita
        ? (people ? Number(((r.value! * 1e6) / people).toFixed(3)) : null)
        : r.value!;
      return {
        country: r.country?.value ?? null,
        country_id: r.country?.id ?? null,
        iso3: r.countryiso3code || null,
        year: r.date ?? null,
        value,
      };
    })
    .filter((p) => p.value !== null);

  if (points.length === 0) {
    throw new Error(
      perCapita
        ? `CO2 data exists for [${codes.join(', ')}] but population was unavailable for the same years, so per-capita could not be computed. Retry with per_capita:false.`
        : `No CO2 values for [${codes.join(', ')}] over ${dateRange}.`,
    );
  }

  const unit = perCapita ? 't CO2e per person' : 'Mt CO2e';
  const base = {
    indicator: CO2_TOTAL_MT,
    indicator_name: 'Carbon dioxide (CO2) emissions (total) excluding LULUCF',
    basis: 'AR5',
    unit,
    per_capita: perCapita,
    date_range: dateRange,
    last_updated: co2.lastUpdated,
    // Say what is NOT counted — an emissions number without its boundary is
    // the kind of figure that gets misquoted.
    excludes: 'Land use, land-use change and forestry (LULUCF)',
  };

  // One country reads as a trend; several read as a ranking. Return the shape
  // that matches the question rather than making the caller reshape it.
  if (codes.length === 1) {
    return {
      ...base,
      country: points[0]?.country ?? null,
      iso3: points[0]?.iso3 ?? null,
      data: points
        .sort((a, b) => String(b.year).localeCompare(String(a.year)))
        .map(({ year, value }) => ({ year, value })),
    };
  }

  const latestYear = points.reduce((mx, p) => (String(p.year) > mx ? String(p.year) : mx), '');
  const ranking = points
    .filter((p) => String(p.year) === latestYear)
    .sort((a, b) => (b.value as number) - (a.value as number))
    .map((p, i) => ({ rank: i + 1, country: p.country, iso3: p.iso3, year: p.year, value: p.value }));

  return { ...base, ranked_year: latestYear, ranking, series: points };
}

async function compareCountries(countryCodes: string, indicator: string, year?: string) {
  const codes = String(countryCodes ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (codes.length === 0) {
    throw new Error('Provide ISO country codes, comma- or semicolon-separated (e.g. "US,CN,DE").');
  }
  // One country is not a comparison, but it IS answerable — return the
  // single-country value instead of erroring. Real cost of the old throw: a
  // customer's "Vietnam GDP ... World Bank data" (2026-08-11 sample) had this
  // tool picked by the router with one country filled, and the reply was a
  // lecture about comma-separated codes. Answering beats arguing; the result
  // shape is identical (a ranking of one), and a `note` says what happened.
  const singleCountry = codes.length === 1;
  const path = codes.map(encodeURIComponent).join(';');
  const params = new URLSearchParams({ format: 'json', per_page: '1000' });
  if (year && year.trim()) params.set('date', year.trim());
  else params.set('mrnev', '1'); // most recent non-empty value per country

  const res = await fetchWithRetry(`${BASE_URL}/country/${path}/indicator/${encodeURIComponent(indicator)}?${params}`);

  const data = (await res.json()) as [
    { total?: number; lastupdated?: string; message?: { value?: string }[] },
    {
      indicator?: { id?: string; value?: string };
      country?: { id?: string; value?: string };
      countryiso3code?: string;
      date?: string;
      value?: number | null;
    }[] | null,
  ];

  const meta = data[0];
  const values = data[1];
  if (!values || values.length === 0) {
    throw new Error(
      `user_error: No data found for indicator "${indicator}" across [${codes.join(', ')}]${year ? ` for ${year}` : ''}. Check the indicator code and country codes — codes are exact, and a retired series (e.g. EN.ATM.CO2E.PC) returns nothing even though the code is well-formed.`,
    );
  }

  const ranking = values
    .filter((v) => v.value !== null && v.value !== undefined)
    .map((v) => ({
      country: v.country?.value ?? null,
      country_id: v.country?.id ?? null,
      iso3: v.countryiso3code ?? null,
      year: v.date ?? null,
      value: v.value as number,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    indicator_id: values[0].indicator?.id ?? indicator,
    indicator_name: values[0].indicator?.value ?? null,
    basis: year && year.trim() ? `year ${year.trim()}` : 'most recent available per country',
    last_updated: meta?.lastupdated ?? null,
    count: ranking.length,
    ...(singleCountry ? { note: 'Single country given — returning its value rather than a comparison. Pass 2+ codes (e.g. "VN,TH") to rank countries against each other.' } : {}),
    ranking,
  };
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
