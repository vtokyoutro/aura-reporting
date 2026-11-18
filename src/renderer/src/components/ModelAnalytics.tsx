import { useMemo, type JSX } from 'react'
import type { ReportRow } from '../lib/report-data'
import { dateLabel, money, revenue, sum, type ModelName } from '../lib/report-view'
import { MotionCard } from './WorkspaceMotion'

type ShiftPoint = { date: string; value: number }
type SeriesName = 'balance' | 'sales' | 'leads'

const axisNumber = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const count = new Intl.NumberFormat('ru-RU')
const plot = { left: 47, right: 315, top: 13, bottom: 105 }

function MetricChart({
  name,
  data,
  id,
  label,
  isMoney = false
}: {
  name: string
  data: ShiftPoint[]
  id: string
  label: string
  isMoney?: boolean
}): JSX.Element {
  if (!data.length) {
    return (
      <figure className="chart-card">
        <figcaption>
          <h3>{label}</h3>
        </figcaption>
        <div className="chart-empty">Нет данных за выбранный период</div>
      </figure>
    )
  }

  const values = data.map((point) => point.value)
  const low = Math.min(0, ...values)
  const high = Math.max(1, ...values)
  const toY = (value: number): number =>
    plot.bottom - ((value - low) / (high - low)) * (plot.bottom - plot.top)
  const points = data.map((point, index) => ({
    x:
      data.length === 1
        ? (plot.left + plot.right) / 2
        : plot.left + (index / (data.length - 1)) * (plot.right - plot.left),
    y: toY(point.value)
  }))
  const line = points
    .map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ')
  const latest = data[data.length - 1]
  const latestPoint = points[points.length - 1]
  const earliest = data[0]
  const firstPoint = points[0]
  const baseline = toY(0)
  const area = `${line} L${latestPoint.x},${baseline} L${firstPoint.x},${baseline} Z`
  const ticks =
    baseline - plot.top > 18 && plot.bottom - baseline > 18 ? [high, 0, low] : [high, low]
  const latestValue = isMoney ? money(latest.value) : count.format(latest.value)

  return (
    <figure className="chart-card">
      <figcaption>
        <h3>{label}</h3>
        <p className="chart-meta">
          Последняя смена <strong className="number">{latestValue}</strong>
        </p>
      </figcaption>
      <svg
        className="chart-plot"
        viewBox="0 0 320 119"
        role="img"
        aria-label={`${name} — ${label}, смен: ${data.length}`}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--model-color)" stopOpacity=".24" />
            <stop offset="100%" stopColor="var(--model-color)" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={toY(tick)}
              y2={toY(tick)}
              className="chart-grid-line"
            />
            <text x={plot.left - 6} y={toY(tick) + 3} textAnchor="end" className="chart-axis-label">
              {isMoney ? '$' : ''}
              {axisNumber.format(tick)}
            </text>
          </g>
        ))}
        {!ticks.includes(0) && (
          <line
            x1={plot.left}
            x2={plot.right}
            y1={baseline}
            y2={baseline}
            className="chart-zero-line"
          />
        )}
        {data.length > 1 && (
          <>
            <path d={area} fill={`url(#${id})`} />
            <path
              d={line}
              fill="none"
              className="chart-series"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        <circle
          cx={latestPoint.x}
          cy={latestPoint.y}
          r="4"
          className="chart-point"
          strokeWidth="1.5"
        >
          <title>{`${dateLabel(latest.date)} — ${latestValue}`}</title>
        </circle>
      </svg>
      <div className="chart-meta chart-dates">
        <time dateTime={earliest.date}>{dateLabel(earliest.date)}</time>
        {latest.date !== earliest.date && (
          <time dateTime={latest.date}>{dateLabel(latest.date)}</time>
        )}
      </div>
    </figure>
  )
}

export default function ModelAnalytics({
  model,
  rows
}: {
  model: ModelName
  rows: ReportRow[]
}): JSX.Element {
  const name = model === 'alice' ? 'Alice' : 'Alexa'
  const ordered = useMemo(
    () => [...rows].sort((a, b) => a.report_date.localeCompare(b.report_date)).slice(-40),
    [rows]
  )
  const kpis = [
    ['Изменение баланса', money(rows.reduce((total, row) => total + revenue(row, model), 0))],
    ['Продажи', count.format(sum(rows, `${model}_sales`))],
    ['Покупатели', count.format(sum(rows, `${model}_customers`))],
    ['Лиды', count.format(sum(rows, `${model}_leads`))]
  ]
  const series: {
    key: SeriesName
    label: string
    isMoney?: boolean
    value: (row: ReportRow) => number
  }[] = [
    {
      key: 'balance',
      label: 'Изменение баланса',
      isMoney: true,
      value: (row) => revenue(row, model)
    },
    { key: 'sales', label: 'Продажи', value: (row) => Number(row[`${model}_sales`] ?? 0) },
    { key: 'leads', label: 'Лиды', value: (row) => Number(row[`${model}_leads`] ?? 0) }
  ]

  return (
    <MotionCard className={`panel model-panel model-${model}`} reveal={model === 'alexa'}>
      <div className="section-heading">
        <h2>
          <span className="model-dot" aria-hidden="true" />
          {name}
        </h2>
        {ordered.length > 0 && (
          <p className="muted chart-meta">
            Смен на графиках: <strong className="number">{ordered.length}</strong>
          </p>
        )}
      </div>
      <dl className="analytics-kpis">
        {kpis.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="analytics-charts">
        {series.map(({ key, label, isMoney, value }) => (
          <MetricChart
            key={key}
            name={name}
            id={`plot-fill-${model}-${key}`}
            label={label}
            isMoney={isMoney}
            data={ordered.map((row) => ({ date: row.report_date, value: value(row) }))}
          />
        ))}
      </div>
    </MotionCard>
  )
}
