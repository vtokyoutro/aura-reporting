import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Save
} from 'lucide-react'
import {
  animate,
  AnimatePresence,
  domMax,
  LayoutGroup,
  LazyMotion,
  useMotionValue,
  useReducedMotion,
  useTransform
} from 'motion/react'
import * as m from 'motion/react-m'
import { type ReportRow, type Shift, type Staff } from '../lib/report-data'
import {
  type ModelName,
  type ReportPeriod,
  dateLabel,
  money,
  revenue,
  sum
} from '../lib/report-view'
import { MotionButton, MotionCard } from './WorkspaceMotion'
import '../assets/dashboard.css'

type Destination = 'history' | 'analytics' | 'calendar'

type DashboardProps = {
  dateToday: string
  displayName: string
  isLeader: boolean
  period: ReportPeriod
  onPeriodChange: (period: ReportPeriod) => void
  person: string
  team: Staff[]
  onPersonChange: (person: string) => void
  rows: ReportRow[]
  todayReports: ReportRow[]
  nameOf: (id: string) => string
  loading: boolean
  draftFound: boolean
  onRestoreDraft: () => void
  onEdit: (row: ReportRow) => void
  onNavigate: (destination: Destination) => void
}

const periods = [
  { value: '7', label: '7 дней' },
  { value: '30', label: '30 дней' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' }
] satisfies { value: ReportPeriod; label: string }[]

const shifts = [
  { value: 'morning', label: 'Утро', full: 'Утренняя' },
  { value: 'day', label: 'День', full: 'Дневная' },
  { value: 'night', label: 'Ночь', full: 'Ночная' }
] satisfies { value: Shift; label: string; full: string }[]

const integerFormat = new Intl.NumberFormat('ru-RU')
const models: ModelName[] = ['alice', 'alexa']

function ReportCount({ value }: { value: number }): JSX.Element {
  const reduce = useReducedMotion()
  const current = useMotionValue(value)
  const label = useTransform(current, (count) => integerFormat.format(Math.round(count)))

  useEffect(() => {
    if (reduce) {
      current.set(value)
      return
    }
    const animation = animate(current, value, { duration: 0.2, ease: 'easeOut' })
    return () => animation.stop()
  }, [value, current, reduce])

  return (
    <>
      <span className="sr-only">{integerFormat.format(value)}</span>
      <m.span aria-hidden="true">{label}</m.span>
    </>
  )
}

export function DashboardView({
  dateToday,
  displayName,
  isLeader,
  period,
  onPeriodChange,
  person,
  team,
  onPersonChange,
  rows,
  todayReports,
  nameOf,
  loading,
  draftFound,
  onRestoreDraft,
  onEdit,
  onNavigate
}: DashboardProps): JSX.Element {
  const reduce = useReducedMotion()
  const [showActivity, setShowActivity] = useState(false)
  const counts = useMemo(() => {
    const result = { morning: 0, day: 0, night: 0 }
    for (const row of rows) {
      if (Object.hasOwn(result, row.shift_type)) result[row.shift_type] += 1
    }
    return result
  }, [rows])
  const activityStaff = useMemo(
    () => [...new Set(todayReports.map((row) => row.staff_id))],
    [todayReports]
  )

  return (
    <div className="aurora">
      <header className="aurora-heading">
        <div>
          <p className="aurora-date">
            <CalendarDays size={15} aria-hidden="true" /> {dateLabel(dateToday)}
          </p>
          <h1>Обзор результатов</h1>
          <p className="aurora-greeting">Здравствуйте, {displayName}.</p>
        </div>
        <div className="aurora-filters">
          <LazyMotion features={domMax}>
            <LayoutGroup>
              <div className="aurora-period" role="group" aria-label="Период">
                {periods.map(({ value, label }) => (
                  <MotionButton
                    key={value}
                    aria-pressed={period === value}
                    onClick={() => onPeriodChange(value)}
                  >
                    {period === value && (
                      <m.span
                        className="aurora-period-active"
                        aria-hidden="true"
                        layoutId={reduce ? undefined : 'aurora-period-active'}
                        transition={{ duration: reduce ? 0 : 0.19, ease: 'easeOut' }}
                      />
                    )}
                    <span>{label}</span>
                  </MotionButton>
                ))}
              </div>
            </LayoutGroup>
          </LazyMotion>
          {isLeader && (
            <label className="aurora-person">
              <span className="sr-only">Сотрудник</span>
              <select value={person} onChange={(event) => onPersonChange(event.target.value)}>
                <option value="all">Все сотрудники</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {nameOf(member.id)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {draftFound && (
        <MotionCard className="aurora-draft">
          <Save size={18} aria-hidden="true" />
          <span>Есть незавершённый отчёт</span>
          <MotionButton className="aurora-link" onClick={onRestoreDraft}>
            Продолжить <ArrowRight size={15} aria-hidden="true" />
          </MotionButton>
        </MotionCard>
      )}

      <div className="aurora-main-grid">
        <MotionCard className="aurora-hero">
          <div className="aurora-hero-title">
            <ClipboardList size={19} aria-hidden="true" />
            <h2>Отчёты за период</h2>
          </div>
          <div className="aurora-count number" aria-busy={loading}>
            {loading ? (
              <span className="aurora-placeholder" role="status" aria-label="Загрузка отчётов" />
            ) : (
              <ReportCount value={rows.length} />
            )}
          </div>
          <div className="aurora-shifts">
            <div className="aurora-shift-track" aria-hidden="true">
              {shifts.map(({ value }) => (
                <m.span
                  key={value}
                  className={`aurora-shift-${value}`}
                  style={{ flexGrow: counts[value] }}
                  initial={reduce ? false : { opacity: 0.4 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                />
              ))}
            </div>
            <dl>
              {shifts.map(({ value, label }) => (
                <div key={value}>
                  <dt>
                    <span className={`aurora-shift-${value}`} />
                    {label}
                  </dt>
                  <dd>{loading ? '—' : counts[value]}</dd>
                </div>
              ))}
            </dl>
          </div>
        </MotionCard>
        <div className="aurora-models" aria-label="Показатели моделей">
          {models.map((model, index) => {
            const label = model === 'alice' ? 'Alice' : 'Alexa'
            const balance = rows.reduce((total, row) => total + revenue(row, model), 0)
            const Direction = balance < 0 ? ArrowDownRight : ArrowUpRight
            return (
              <MotionCard
                key={model}
                delay={0.045 + index * 0.045}
                className={`aurora-model aurora-${model}`}
              >
                <section aria-label={label}>
                  <div className="aurora-model-title">
                    <h2>{label}</h2>
                    <MotionButton
                      className="aurora-arrow"
                      aria-label={`Открыть раздел аналитики из карточки ${label}`}
                      onClick={() => onNavigate('analytics')}
                    >
                      <ArrowUpRight size={18} aria-hidden="true" />
                    </MotionButton>
                  </div>
                  <div className="aurora-model-balance">
                    {!loading && <Direction size={19} aria-hidden="true" />}
                    <strong className="number">{loading ? '—' : money(balance)}</strong>
                  </div>
                  <p>Изменение баланса</p>
                  <dl>
                    <div>
                      <dt>Продажи</dt>
                      <dd>{loading ? '—' : sum(rows, `${model}_sales`)}</dd>
                    </div>
                    <div>
                      <dt>Покупатели</dt>
                      <dd>{loading ? '—' : sum(rows, `${model}_customers`)}</dd>
                    </div>
                    <div>
                      <dt>Лиды</dt>
                      <dd>{loading ? '—' : sum(rows, `${model}_leads`)}</dd>
                    </div>
                  </dl>
                </section>
              </MotionCard>
            )
          })}
        </div>
      </div>

      <div className="aurora-lower-grid">
        <section className="aurora-recent" aria-label="Последние отчёты">
          <div className="aurora-section-head">
            <h2>Последние отчёты</h2>
            <MotionButton className="aurora-link" onClick={() => onNavigate('history')}>
              Вся история <ArrowRight size={15} aria-hidden="true" />
            </MotionButton>
          </div>
          {rows.length ? (
            <ul className="aurora-report-list">
              {rows.slice(0, 5).map((row) => (
                <li key={row.id}>
                  <MotionButton
                    className="aurora-report-row"
                    onClick={() => onEdit(row)}
                    aria-label={`Изменить отчёт за ${dateLabel(row.report_date)}${isLeader ? `, ${nameOf(row.staff_id)}` : ''}`}
                  >
                    <span>{dateLabel(row.report_date)}</span>
                    <span>
                      {shifts.find(({ value }) => value === row.shift_type)?.full ?? row.shift_type}
                    </span>
                    {isLeader && <span title={nameOf(row.staff_id)}>{nameOf(row.staff_id)}</span>}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </MotionButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="aurora-empty" role="status">
              {loading ? 'Загружаем отчёты…' : 'За выбранный период отчётов нет.'}
            </p>
          )}
        </section>
        <MotionCard reveal className="aurora-today">
          <section aria-label="Сегодня">
            <div className="aurora-section-head">
              <h2>Сегодня</h2>
              <Activity size={18} aria-hidden="true" />
            </div>
            <div className="aurora-today-value">
              <strong className="number">{loading ? '—' : todayReports.length}</strong>
              <span>Отчётов за день</span>
            </div>
            <MotionButton className="aurora-link" onClick={() => onNavigate('calendar')}>
              Открыть календарь <ArrowRight size={15} aria-hidden="true" />
            </MotionButton>
            {isLeader && activityStaff.length > 0 && (
              <>
                <MotionButton
                  className="aurora-link aurora-disclosure"
                  aria-expanded={showActivity}
                  aria-controls="aurora-activity-list"
                  onClick={() => setShowActivity((open) => !open)}
                >
                  Кто отчитался <ChevronDown size={15} aria-hidden="true" />
                </MotionButton>
                <div id="aurora-activity-list" aria-hidden={!showActivity}>
                  <AnimatePresence initial={false}>
                    {showActivity && (
                      <m.ul
                        className="aurora-activity"
                        initial={reduce ? false : { opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? undefined : { opacity: 0, y: -3 }}
                        transition={{ duration: reduce ? 0 : 0.16 }}
                      >
                        {activityStaff.map((id) => (
                          <li key={id}>{nameOf(id)}</li>
                        ))}
                      </m.ul>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )}
          </section>
        </MotionCard>
      </div>
    </div>
  )
}
