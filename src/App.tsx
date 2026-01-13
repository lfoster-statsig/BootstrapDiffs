import './App.css'

import { useMemo, useState } from 'react'

type DiffStatus = 'added' | 'removed' | 'changed'

type DiffRow = {
  path: string
  status: DiffStatus
  clientValue: unknown
  bootstrapValue: unknown
}

const IGNORED_PATHS = ['statsigEnvironment']

const sampleEvent: Record<string, unknown> = {
  userID: 'a-user',
  city: 'Boydton',
  state: 'USVA',
  country: 'US',
  sessionID: '4b45db8b-8a8b-4824-9238-a0ef6599b55d',
  deviceType: 'Desktop',
  gate: 'a_gate',
  gateValue: 'true',
  ruleID: 'pass:all:id_override',
  bootstrapMetadata:
    '{"user":{"userID":"a-user"},"generatorSDKInfo":{"sdkType":"statsig-node","sdkVersion":"6.4.5"},"lcut":1767919970932}',
  reason: 'BootstrapStableIDMismatch:Recognized',
  lcut: '1767919970932',
  receivedAt: '1767949908191',
  idType: 'userID',
  ruleName: 'pass:all:id_override',
  isExposureStale: 'false',
  systemName: 'Windows',
  systemVersion: '10.0.0',
  browserName: 'Chrome',
  browserVersion: '141.0.7390',
  customIDs: {
    stableID: '11f65358-95af-4a61-977f-bcbb34b2dc77',
  },
}

const defaultInput = JSON.stringify(sampleEvent, null, 2)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractClientUser(input: unknown): Record<string, unknown> | null {
  if (!isPlainObject(input)) {
    return null
  }

  const record = input as Record<string, unknown>
  const directKeys = ['clientUser', 'user', 'statsigUser']
  for (const key of directKeys) {
    if (key in record && isPlainObject(record[key])) {
      return record[key] as Record<string, unknown>
    }
  }

  const candidate: Record<string, unknown> = {}
  const userKeys = [
    'userID',
    'stableID',
    'email',
    'ip',
    'appVersion',
    'sessionID',
    'city',
    'state',
    'country',
    'locale',
    'platform',
    'systemName',
    'systemVersion',
    'browserName',
    'browserVersion',
    'deviceType',
    'customIDs',
    'custom',
    'privateAttributes',
    'userAgent',
  ]

  for (const key of userKeys) {
    if (key in record) {
      const value = record[key]
      if (value !== undefined) {
        candidate[key] = value
      }
    }
  }

  if (Object.keys(candidate).length > 0) {
    return candidate
  }

  return null
}

function parseBootstrapMetadata(input: unknown) {
  if (!isPlainObject(input)) {
    return {
      metadata: null,
      bootstrapUser: null,
      cleanedString: null,
      rawString: null,
      wasCleaned: false,
      error: null,
    }
  }

  const record = input as Record<string, unknown>
  const rawValue = record['bootstrapMetadata']

  if (rawValue === undefined) {
    return {
      metadata: null,
      bootstrapUser: null,
      cleanedString: null,
      rawString: null,
      wasCleaned: false,
      error: 'No bootstrapMetadata field found on this payload.',
    }
  }

  if (typeof rawValue !== 'string') {
    return {
      metadata: null,
      bootstrapUser: null,
      cleanedString: null,
      rawString: null,
      wasCleaned: false,
      error: 'bootstrapMetadata exists but is not a string.',
    }
  }

  const cleaned = rawValue.replace(/\\/g, '')

  try {
    const metadata = JSON.parse(cleaned) as Record<string, unknown>
    const userFromMetadata = isPlainObject(metadata['user'])
      ? (metadata['user'] as Record<string, unknown>)
      : null
    const bootstrapUser = userFromMetadata ?? extractClientUser(metadata)

    return {
      metadata,
      bootstrapUser,
      cleanedString: cleaned,
      rawString: rawValue,
      wasCleaned: cleaned !== rawValue,
      error: null,
    }
  } catch (error) {
    return {
      metadata: null,
      bootstrapUser: null,
      cleanedString: cleaned,
      rawString: rawValue,
      wasCleaned: cleaned !== rawValue,
      error: `Unable to parse bootstrapMetadata: ${(error as Error).message}`,
    }
  }
}

function getStableID(user: Record<string, unknown> | null): string | null {
  if (!user) return null

  const maybeStable = user['stableID']
  if (typeof maybeStable === 'string' && maybeStable.trim()) {
    return maybeStable
  }

  const customIDs = user['customIDs']
  if (isPlainObject(customIDs)) {
    const candidate = customIDs['stableID']
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }

  return null
}

function areValuesEqual(left: unknown, right: unknown) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  if (isPlainObject(left) || isPlainObject(right)) {
    return false
  }

  return Object.is(left, right)
}

function diffObjects(
  client: Record<string, unknown>,
  bootstrap: Record<string, unknown>,
  path = ''
): DiffRow[] {
  const keys = new Set([
    ...Object.keys(client ?? {}),
    ...Object.keys(bootstrap ?? {}),
  ])

  const rows: DiffRow[] = []

  keys.forEach((key) => {
    const nextPath = path ? `${path}.${key}` : key
    if (
      IGNORED_PATHS.some(
        (ignored) => nextPath === ignored || nextPath.startsWith(`${ignored}.`)
      )
    ) {
      return
    }

    const clientValue = client?.[key]
    const bootstrapValue = bootstrap?.[key]

    if (isPlainObject(clientValue) && isPlainObject(bootstrapValue)) {
      rows.push(...diffObjects(clientValue, bootstrapValue, nextPath))
    } else if (!areValuesEqual(clientValue, bootstrapValue)) {
      const status: DiffStatus =
        clientValue === undefined
          ? 'added'
          : bootstrapValue === undefined
            ? 'removed'
            : 'changed'

      rows.push({
        path: nextPath,
        status,
        clientValue,
        bootstrapValue,
      })
    }
  })

  return rows
}

function formatInline(value: unknown) {
  if (value === undefined) return '∅'
  if (value === null) return 'null'
  if (typeof value === 'string') {
    return value.length > 90 ? `${value.slice(0, 90)}…` : value
  }

  const json = JSON.stringify(value)
  if (!json) return String(value)
  return json.length > 90 ? `${json.slice(0, 90)}…` : json
}

function formatJson(value: unknown) {
  const json = JSON.stringify(value, null, 2)
  return json ?? ''
}

function App() {
  const [rawInput, setRawInput] = useState(defaultInput)

  const parseResult = useMemo(() => {
    if (!rawInput.trim()) {
      return { data: null as unknown, error: null as string | null }
    }

    try {
      return { data: JSON.parse(rawInput) as Record<string, unknown>, error: null }
    } catch (error) {
      return {
        data: null,
        error: `Unable to parse JSON: ${(error as Error).message}`,
      }
    }
  }, [rawInput])

  const clientUser = useMemo(
    () => extractClientUser(parseResult.data),
    [parseResult.data]
  )
  const bootstrapResult = useMemo(
    () => parseBootstrapMetadata(parseResult.data),
    [parseResult.data]
  )

  const stableIdClient = useMemo(
    () => getStableID(clientUser),
    [clientUser]
  )
  const stableIdBootstrap = useMemo(
    () => getStableID(bootstrapResult.bootstrapUser),
    [bootstrapResult.bootstrapUser]
  )

  const diffRows = useMemo(() => {
    if (!clientUser || !bootstrapResult.bootstrapUser) return []
    return diffObjects(clientUser, bootstrapResult.bootstrapUser)
  }, [bootstrapResult.bootstrapUser, clientUser])

  const bootstrapOnlyDiffs = useMemo(
    () =>
      diffRows.filter(
        (row) =>
          row.status === 'added' &&
          !IGNORED_PATHS.some(
            (ignored) => row.path === ignored || row.path.startsWith(`${ignored}.`)
          )
      ),
    [diffRows]
  )

  const stableIdMismatchRow = useMemo(() => {
    if (stableIdClient !== stableIdBootstrap && // don't throw if they're both undefined
      (stableIdClient || stableIdBootstrap)) {
    const pathLabel = clientUser?.customIDs || bootstrapResult.bootstrapUser?.customIDs
      ? 'customIDs.stableID'
      : 'stableID'
    return {
      path: pathLabel,
      status: 'changed' as DiffStatus,
      clientValue: stableIdClient,
      bootstrapValue: stableIdBootstrap,
    }
  }
  }, [bootstrapResult.bootstrapUser?.customIDs, clientUser?.customIDs, stableIdBootstrap, stableIdClient])

  const displayRows = useMemo(
    () => [...bootstrapOnlyDiffs, ...(stableIdMismatchRow ? [stableIdMismatchRow] : [])],
    [bootstrapOnlyDiffs, stableIdMismatchRow]
  )

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Bootstrap debugger</p>
          <h1>Client vs bootstrapped user diff</h1>
          <p className="lede">
            Paste a user payload to automatically compare the client user fields
            against the bootstrap metadata.
          </p>
        </div>
        <div className="pill ghost">Auto-analyzes as you type</div>
      </header>

      <section className="card input-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Input</p>
            <h2>Paste the raw JSON payload</h2>
            <p className="hint">
              We will strip backslashes from <code>bootstrapMetadata</code> and
              parse everything for you.
            </p>
          </div>
        </div>

        <textarea
          className="payload-input"
          spellCheck={false}
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          placeholder="Paste the user JSON blob here..."
        />

        <div className="status-row">
          {parseResult.error ? (
            <span className="status error">{parseResult.error}</span>
          ) : parseResult.data ? (
            <span className="status success">JSON parsed successfully</span>
          ) : (
            <span className="status muted">Waiting for JSON</span>
          )}
          {bootstrapResult.error ? (
            <span className="status warn">{bootstrapResult.error}</span>
          ) : bootstrapResult.bootstrapUser ? (
            <span className="status success">
              Bootstrap metadata parsed
              {bootstrapResult.wasCleaned ? ' (slashes stripped)' : ''}
            </span>
          ) : null}
        </div>
      </section>

      <section className="grid">
        <article className="card panel">
          <div className="panel-heading">
            <div className="pill solid">Client user</div>
            <p className="hint">
              Pulled from <code>user</code>/<code>clientUser</code> or likely
              user fields.
            </p>
          </div>
          {clientUser ? (
            <pre className="json-block">{formatJson(clientUser)}</pre>
          ) : (
            <p className="muted">
              No client user fields detected yet. We look for a <code>user</code>{' '}
              or <code>clientUser</code> object, or top-level identifiers like{' '}
              <code>userID</code> and <code>customIDs</code>.
            </p>
          )}
        </article>

        <article className="card panel">
          <div className="panel-heading">
            <div className="pill accent">Bootstrapped user</div>
            <p className="hint">
              Parsed from <code>bootstrapMetadata</code> fields.
            </p>
          </div>
          {bootstrapResult.bootstrapUser ? (
            <pre className="json-block">
              {formatJson(bootstrapResult.bootstrapUser)}
            </pre>
          ) : (
            <p className="muted">
              {bootstrapResult.error ??
                'Add a bootstrapMetadata field to extract the bootstrapped user.'}
            </p>
          )}
          {bootstrapResult.metadata && (
            <details className="metadata-details">
              <summary>See full bootstrap metadata</summary>
              <pre className="json-block">
                {formatJson(bootstrapResult.metadata)}
              </pre>
            </details>
          )}
        </article>
      </section>

      <section className="card diff-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Diff</p>
          <h2>Bootstrap vs client values</h2>
          <p className="hint">
            Showing fields that exist in bootstrap metadata but are missing on the
            client user (e.g., inferred device/browser/session values). Ignoring
            <code>statsigEnvironment</code>.
            Stable ID mismatches are highlighted when both sides set a stable ID.
          </p>
        </div>
        <div className="legend">
          <span className="pill accent">Bootstrap-only fields</span>
          <span className="pill solid">Stable ID mismatch</span>
        </div>
      </div>

      {!clientUser || !bootstrapResult.bootstrapUser ? (
        <p className="muted">
          We need both a client user and a parsed bootstrap user to compute the diff.
        </p>
      ) : displayRows.length === 0 ? (
        <p className="muted success-text">
          No bootstrap-only fields or stable ID mismatches detected.
        </p>
      ) : (
        <div className="diff-list">
          {displayRows.map((row) => (
            <div key={row.path} className={`diff-row ${row.status}`}>
              <div className="diff-path">
                <span className="dot" />
                <span>{row.path}</span>
              </div>
              <div className="diff-values">
                <div>
                  <p className="label">Client</p>
                  <code>{formatInline(row.clientValue)}</code>
                </div>
                <div>
                  <p className="label">Bootstrap</p>
                  <code>{formatInline(row.bootstrapValue)}</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </section>
    </main>
  )
}

export default App
