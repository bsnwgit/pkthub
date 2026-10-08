import { useEffect, useState, type ReactNode } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../api/client'
import { axisProps, tooltipProps, gridProps, INSTRUMENT, InstrumentFrame, InstrumentHead, RadialRing } from './instrument'

const WINDOWS = [
  { hours: 1,   label: '1h' },
  { hours: 6,   label: '6h' },
  { hours: 24,  label: '24h' },
  { hours: 168, label: '7d' },
]
const CHART_H = 180

interface HubChartsData {
  audit_trend: Array<{ t: number; count: number }>
  alert_trend: Array<{ t: number; connection_lost: number; unhealthy: number; token_mismatch: number }>
  top_apps:    Array<{ id: number; name: string; count: number }>
  top_actions: Array<{ action: string; count: number }>
  top_users:   Array<{ username: string; count: number }>
  by_health:   Array<{ status: string; count: number }>
}

// Alarm hues are the suite's only high-chroma colours, so a lost connection
// reads the same here as it does on the app cards.
const ALERT_KINDS = [
  { key: 'connection_lost', name: 'Connection lost', color: '#ff6b5e' },
  { key: 'unhealthy',       name: 'Unhealthy',       color: '#f3c265' },
  { key: 'token_mismatch',  name: 'Token mismatch',  color: INSTRUMENT.ice },
]

const HEALTH: Record<string, { name: string; color: string }> = {
  healthy:     { name: 'Healthy',     color: '#9aeabd' },
  degraded:    { name: 'Degraded',    color: '#f3c265' },
  unreachable: { name: 'Unreachable', color: '#ff8478' },
  unknown:     { name: 'Unknown',     color: INSTRUMENT.inkDim },
}

function timeTick(spanMs: number) {
  const withDate = spanMs > 24 * 3600 * 1000
  return (ms: number) => new Date(ms).toLocaleString([], withDate
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' })
}

const hasTrend = (rows: any[], keys: string[]) =>
  rows.some(r => keys.some(k => (r[k] ?? 0) > 0))

function Empty({ msg, height = 90 }: { msg: string; height?: number }) {
  return <div className="grid place-items-center text-center f-lbl px-4" style={{ height }}>{msg}</div>
}

function Panel({ title, chip, children }: { title: string; chip?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <InstrumentHead right={chip ? <span className="f-lbl">{chip}</span> : undefined}>{title}</InstrumentHead>
      <div className="f-panel p-3">{children}</div>
    </section>
  )
}

/** Horizontal bars scaled to the largest row. */
function BarList({ rows, empty }: { rows: Array<{ key: string; label: string; value: number }>; empty: string }) {
  if (!rows.length) return <Empty msg={empty} />
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map(r => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-xs text-white truncate">{r.label}</span>
            <span className="font-mono text-xs text-white shrink-0">{r.value.toLocaleString()}</span>
          </div>
          <div className="h-1.5 bg-gray-800">
            <div className="h-full bg-cyan-400" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function TrendChart({ rows, spanMs, series, empty }: {
  rows: any[]
  spanMs: number
  series: Array<{ key: string; name: string; color: string }>
  empty: string
}) {
  const totals = series.map(s => ({ ...s, total: rows.reduce((n, r) => n + (r[s.key] ?? 0), 0) }))
  if (totals.every(s => s.total === 0)) return <Empty msg={empty} height={CHART_H} />
  return (
    <div>
      <InstrumentFrame height={CHART_H}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 10, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                   tickFormatter={timeTick(spanMs)} minTickGap={48} {...axisProps} />
            <YAxis width={32} allowDecimals={false} {...axisProps} />
            <Tooltip
              contentStyle={tooltipProps.contentStyle}
              labelStyle={tooltipProps.labelStyle}
              cursor={tooltipProps.cursor}
              labelFormatter={(v: number) => new Date(v).toLocaleString()}
              formatter={(v: number, key: string) => [v, series.find(s => s.key === key)?.name ?? key]}
            />
            {series.map(s => (
              <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </InstrumentFrame>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
        {totals.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 font-mono text-[10px] text-gray-400">
            <span className="w-2 h-2" style={{ background: s.color }} />
            {s.name} <span className="text-white">{s.total}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function HubCharts({ refreshKey }: { refreshKey: number }) {
  const [hours, setHours] = useState(24)
  const [data, setData]   = useState<HubChartsData | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api.dashboardCharts(hours)
      .then(d => { setData(d); setFailed(false) })
      .catch(() => setFailed(true))
  }, [hours, refreshKey])

  const label  = WINDOWS.find(w => w.hours === hours)?.label
  const spanMs = hours * 3600 * 1000
  const health = (data?.by_health ?? []).map(h => ({
    name: HEALTH[h.status]?.name ?? h.status,
    value: h.count,
    color: HEALTH[h.status]?.color ?? INSTRUMENT.inkDim,
  }))
  const apps = health.reduce((n, h) => n + h.value, 0)

  // A panel with nothing to plot is dropped rather than drawn empty.
  const showAlerts = !!data && hasTrend(data.alert_trend, ALERT_KINDS.map(k => k.key))
  const showAudit  = !!data && hasTrend(data.audit_trend, ['count'])
  const anyData = !!data && (showAlerts || showAudit || apps > 0 || data.top_apps.length > 0
    || data.top_users.length > 0 || data.top_actions.length > 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="f-lbl f-lbl-gold">Platform history</p>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button key={w.hours} type="button" onClick={() => setHours(w.hours)}
                    className={`px-2.5 py-1 text-xs font-mono border transition-colors ${
                      hours === w.hours ? 'border-blue-500 text-white bg-gray-800' : 'border-gray-800 text-gray-400 hover:text-white'}`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {failed && !data && <Empty msg="Platform history could not be loaded" />}

      {data && !anyData && <Empty msg={`No activity in the last ${label}`} height={120} />}

      {data && anyData && (
        <>
          {showAlerts && (
            <Panel title="App alerts raised" chip={`by type · ${label}`}>
              <TrendChart rows={data.alert_trend} spanMs={spanMs} series={ALERT_KINDS} empty="" />
            </Panel>
          )}

          {showAudit && (
            <Panel title="Audit activity" chip={label}>
              <TrendChart rows={data.audit_trend} spanMs={spanMs}
                          series={[{ key: 'count', name: 'Events', color: INSTRUMENT.gold }]} empty="" />
            </Panel>
          )}

          {(apps > 0 || data.top_apps.length > 0 || data.top_users.length > 0 || data.top_actions.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {apps > 0 && (
                <Panel title="App health" chip="now">
                  <div>
                    <RadialRing segments={health} label="apps" total={String(apps)} />
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
                      {health.map(h => (
                        <span key={h.name} className="flex items-center gap-1.5 font-mono text-[10px] text-gray-400">
                          <span className="w-2 h-2" style={{ background: h.color }} />
                          {h.name} <span className="text-white">{h.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}
              {data.top_apps.length > 0 && (
                <Panel title="Noisiest apps" chip={label}>
                  <BarList empty=""
                           rows={data.top_apps.map(r => ({ key: String(r.id), label: r.name, value: r.count }))} />
                </Panel>
              )}
              {data.top_users.length > 0 && (
                <Panel title="Most active users" chip={label}>
                  <BarList empty=""
                           rows={data.top_users.map(r => ({ key: r.username, label: r.username, value: r.count }))} />
                </Panel>
              )}
              {data.top_actions.length > 0 && (
                <Panel title="Top audited actions" chip={label}>
                  <BarList empty=""
                           rows={data.top_actions.map(r => ({ key: r.action, label: r.action, value: r.count }))} />
                </Panel>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
