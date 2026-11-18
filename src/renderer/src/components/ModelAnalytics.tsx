import type { CSSProperties, JSX } from 'react'
import { TrendingUp } from 'lucide-react'
import type { ReportRow } from '../lib/report-data'
import { dateLabel, money, revenue, sum, type ModelName } from '../lib/report-view'

export default function ModelAnalytics({
  model,
  rows,
  panelStyle,
  subtitleStyle
}: {
  model: ModelName
  rows: ReportRow[]
  panelStyle: CSSProperties
  subtitleStyle: CSSProperties
}): JSX.Element {
  const name = model === 'alice' ? 'Alice' : 'Alexa'
  const accent = model === 'alice' ? '#aa8cff' : '#5dc8d9'
  const ordered = [...rows].sort((a, b) => a.report_date.localeCompare(b.report_date)).slice(-40)
  const balance = ordered.map((r) => revenue(r, model))
  const sales = ordered.map((r) => Number(r[`${model}_sales`] ?? 0))
  const leads = ordered.map((r) => Number(r[`${model}_leads`] ?? 0))
  const total = (key: 'sales' | 'customers' | 'leads'): number =>
    sum(rows, `${model}_${key}` as keyof ReportRow)
  const line = (values: number[]): string => {
    if (!values.length) return ''
    const low = Math.min(0, ...values),
      high = Math.max(1, ...values)
    const span = Math.max(1, high - low)
    return values
      .map(
        (v, i) =>
          `${i ? 'L' : 'M'}${values.length === 1 ? 160 : 12 + (i * 296) / (values.length - 1)},${83 - ((v - low) / span) * 66}`
      )
      .join(' ')
  }
  return (
    <section
      className="aura-model-panel"
      style={{ ...panelStyle, borderTop: `3px solid ${accent}` }}
    >
      <div className="aura-section-header">
        <div>
          <h2 style={{ margin: '0 0 6px', color: accent }}>{name}</h2>
          <p style={subtitleStyle}>Индивидуальная статистика модели</p>
        </div>
        <TrendingUp size={22} color={accent} />
      </div>
      <div className="aura-model-kpis">
        {[
          ['Изменение баланса', money(rows.reduce((n, r) => n + revenue(r, model), 0))],
          ['Продажи', String(total('sales'))],
          ['Покупатели', String(total('customers'))],
          ['Лиды', String(total('leads'))]
        ].map(([label, value]) => (
          <div key={label} className="aura-mini-stat">
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {(
        [
          ['Изменение баланса', balance, true],
          ['Продажи', sales, false],
          ['Лиды', leads, false]
        ] as [string, number[], boolean][]
      ).map(([label, values, isMoney]) => (
        <div key={label} className="aura-chart-block">
          <div className="aura-section-header">
            <strong>{label}</strong>
            <small style={{ color: subtitleStyle.color }}>Последние {ordered.length} смен</small>
          </div>
          {ordered.length ? (
            <svg
              viewBox="0 0 320 102"
              preserveAspectRatio="none"
              className="aura-chart"
              role="img"
              aria-label={`График: ${name}, ${label}`}
            >
              {[25, 50, 75].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="320"
                  y1={y}
                  y2={y}
                  stroke="#30374b"
                  strokeDasharray="4 5"
                />
              ))}
              <path
                d={line(values)}
                stroke={accent}
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
              {values.length === 1 && <circle cx="160" cy="83" r="4" fill={accent} />}
            </svg>
          ) : (
            <p style={subtitleStyle}>Нет данных за выбранный период.</p>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: subtitleStyle.color
            }}
          >
            <span>{ordered.length ? dateLabel(ordered[0].report_date) : '—'}</span>
            <span>{ordered.length ? dateLabel(ordered[ordered.length - 1].report_date) : '—'}</span>
          </div>
          {values.length > 0 && (
            <p style={{ ...subtitleStyle, fontSize: 12, marginTop: 8 }}>
              Последняя смена:{' '}
              {isMoney ? money(values[values.length - 1]) : values[values.length - 1]}
            </p>
          )}
        </div>
      ))}
    </section>
  )
}
