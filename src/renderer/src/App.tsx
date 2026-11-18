import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useRef,
  type FormEvent,
  type JSX
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  LayoutDashboard,
  FilePlus2,
  LogOut,
  CalendarDays,
  ClipboardCheck,
  UserRound,
  ArrowLeft,
  ArrowRight,
  History,
  BarChart3,
  Users,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Bell,
  X,
  Clock3,
  FileText,
  SlidersHorizontal,
  CircleAlert,
  Diamond
} from 'lucide-react'
import { loadReports, loadTeam, type ReportRow, type Shift, type Staff } from './lib/report-data'
import { DashboardView } from './components/DashboardView'
import { ProfileMenu, UserAvatar } from './components/ProfileMenu'
import ModelAnalytics from './components/ModelAnalytics'
import {
  MotionProvider,
  SectionTransition,
  MotionButton,
  MotionCard,
  MotionDialog
} from './components/WorkspaceMotion'
import {
  createReportsCsv,
  dateLabel,
  filterReports,
  indexReportsByDate,
  money,
  revenue,
  shiftLabels,
  type ModelName,
  type ReportPeriod
} from './lib/report-view'

type ProfileReport = {
  startingBalance: string
  endingBalance: string
  sales: string
  customers: string
  leads: string
}
type Page = 'dashboard' | 'report' | 'history' | 'analytics' | 'calendar' | 'team'
const toForm = (r: ReportRow, model: 'alice' | 'alexa'): ProfileReport => ({
  startingBalance: String(r[`${model}_start_balance`] ?? ''),
  endingBalance: String(r[`${model}_end_balance`] ?? ''),
  sales: String(r[`${model}_sales`] ?? ''),
  customers: String(r[`${model}_customers`] ?? ''),
  leads: String(r[`${model}_leads`] ?? '')
})
const emptyReport = (): ProfileReport => ({
  startingBalance: '',
  endingBalance: '',
  sales: '',
  customers: '',
  leads: ''
})
const today = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const navigation = [
  { page: 'dashboard', label: 'Главная', icon: LayoutDashboard },
  { page: 'history', label: 'История отчётов', icon: History },
  { page: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { page: 'calendar', label: 'Календарь', icon: CalendarDays },
  { page: 'team', label: 'Команда', icon: Users }
] as const

const pageTitles: Record<Page, string> = {
  dashboard: 'Обзор результатов',
  history: 'История отчётов',
  analytics: 'Аналитика',
  calendar: 'Календарь смен',
  team: 'Команда',
  report: 'Новый отчёт'
}

const shiftNames: Record<Shift, string> = {
  morning: 'Утренняя',
  day: 'Дневная',
  night: 'Ночная'
}

const profileFields: { key: keyof ProfileReport; label: string; step: string }[] = [
  { key: 'startingBalance', label: 'Начальный баланс ($)', step: '0.01' },
  { key: 'endingBalance', label: 'Конечный баланс ($)', step: '0.01' },
  { key: 'sales', label: 'Продажи', step: '1' },
  { key: 'customers', label: 'Покупатели', step: '1' },
  { key: 'leads', label: 'Лиды за смену', step: '1' }
]

function Brand(): JSX.Element {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Diamond size={19} />
      </span>
      <span className="brand-word">
        AURA<small>Reporting System</small>
      </span>
    </div>
  )
}

function ProfileFields({
  model,
  report,
  onChange
}: {
  model: ModelName
  report: ProfileReport
  onChange: (next: ProfileReport) => void
}): JSX.Element {
  const modelName = model === 'alice' ? 'Alice' : 'Alexa'
  return (
    <fieldset className={`panel form-model model-${model}`}>
      <legend>
        <span className="model-dot" />
        {modelName}
      </legend>
      <div className="form-metrics">
        {profileFields.map(({ key, label, step }) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              aria-label={`${modelName} — ${label}`}
              type="number"
              min="0"
              step={step}
              value={report[key]}
              onChange={(event) => onChange({ ...report, [key]: event.target.value })}
              placeholder="0"
              required
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

type SessionScope = {
  userId: string
  generation: number
  controller: AbortController
  accessToken: string
}

function sessionRequest<
  T extends { setHeader(name: string, value: string): T; abortSignal(signal: AbortSignal): T }
>(scope: SessionScope, query: T): T {
  // The SDK may resolve its default token after the active account has changed.
  return query
    .setHeader('Authorization', `Bearer ${scope.accessToken}`)
    .abortSignal(scope.controller.signal)
}

export default function App(): JSX.Element {
  const [account, setAccount] = useState<{ scope: SessionScope; email: string | undefined } | null>(
    null
  )
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [authError, setAuthError] = useState('')
  const generation = useRef(0)

  useEffect(() => {
    let scope: SessionScope | null = null
    let active = true
    let receivedAuthEvent = false
    let receivedAuthChange = false

    function applySession(session: Session | null): void {
      if (scope && scope.userId !== session?.user.id) {
        // Invalidate requests before React commits the next screen.
        scope.controller.abort()
        scope = null
      }
      if (session) {
        if (!scope) {
          scope = {
            userId: session.user.id,
            generation: ++generation.current,
            controller: new AbortController(),
            accessToken: session.access_token
          }
        } else {
          scope.accessToken = session.access_token
        }
        setAccount({ scope, email: session.user.email })
        setAuthError('')
      } else {
        setAccount(null)
      }
      setCheckingAuth(false)
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'INITIAL_SESSION' && receivedAuthChange) return
      receivedAuthEvent = true
      if (event !== 'INITIAL_SESSION') receivedAuthChange = true
      applySession(event === 'SIGNED_OUT' ? null : session)
    })

    function showInitialError(message: string): void {
      if (!active || receivedAuthChange || scope) return
      setAuthError(message)
      setCheckingAuth(false)
    }

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) showInitialError(error.message)
        if (!receivedAuthEvent) applySession(data.session)
      })
      .catch((error: unknown) => {
        showInitialError(error instanceof Error ? error.message : 'Ошибка подключения')
      })

    return () => {
      active = false
      scope?.controller.abort()
      subscription.unsubscribe()
    }
  }, [])

  return (
    <MotionProvider>
      {checkingAuth ? (
        <main className="center-stage">
          <div className="panel startup-panel" role="status">
            <Brand />
            <p>
              <span className="loading-dot" />
              Проверяем авторизацию…
            </p>
          </div>
        </main>
      ) : account ? (
        <Workspace key={account.scope.generation} scope={account.scope} email={account.email} />
      ) : (
        <LoginForm authError={authError} />
      )}
    </MotionProvider>
  )
}

function LoginForm({ authError }: { authError: string }): JSX.Element {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const passwordField = passwordRef.current
    if (submitting.current || !passwordField) return

    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    const password = passwordField.value
    passwordField.value = ''
    submitting.current = true
    setLoading(true)
    setError('')
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) setError(loginError.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сети')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const visibleError = error ?? authError
  return (
    <main className="center-stage login-stage">
      <MotionCard className="login-frame">
        <div className="login-brand-panel">
          <Brand />
          <p>
            Отчётность по сменам
            <br />и аналитика команды.
          </p>
        </div>
        <form onSubmit={handleLogin} className="login-form" aria-busy={loading}>
          <h1>Вход в AURA</h1>
          <label className="field">
            <span>Электронная почта</span>
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="field">
            <span>Пароль</span>
            <input
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </label>
          {visibleError && (
            <p className="message message-error" role="alert">
              {visibleError}
            </p>
          )}
          <MotionButton
            type="submit"
            className="button button-primary login-submit"
            disabled={loading}
          >
            {loading ? 'Входим…' : 'Войти'} <ArrowRight size={17} aria-hidden="true" />
          </MotionButton>
        </form>
      </MotionCard>
    </main>
  )
}

function hasSavedDraft(key: string): boolean {
  try {
    return Boolean(localStorage.getItem(key))
  } catch {
    return false
  }
}

const reportPageSize = 25
const teamPageSize = 12

function Pagination({
  page,
  total,
  pageSize,
  label,
  onChange
}: {
  page: number
  total: number
  pageSize: number
  label: 'отчётов' | 'сотрудников'
  onChange: (page: number) => void
}): JSX.Element | null {
  const pageCount = Math.ceil(total / pageSize)
  if (pageCount <= 1) return null
  return (
    <nav className="pagination" aria-label={`Страницы ${label}`}>
      <span className="pagination-summary" aria-live="polite">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} из {total}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="button button-quiet icon-button"
          aria-label={`Предыдущая страница ${label}`}
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span aria-label={`Страница ${page + 1} из ${pageCount}`}>
          {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          className="button button-quiet icon-button"
          aria-label={`Следующая страница ${label}`}
          disabled={page + 1 === pageCount}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

function ReportTable({
  rows,
  leader,
  label,
  loading,
  paginate,
  nameOf,
  onEdit
}: {
  rows: ReportRow[]
  leader: boolean
  label: string
  loading: boolean
  paginate?: boolean
  nameOf: (id: string) => string
  onEdit: (row: ReportRow) => void
}): JSX.Element {
  const [requestedPage, setRequestedPage] = useState(0)
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(rows.length / reportPageSize) - 1))
  const visibleRows = paginate
    ? rows.slice(page * reportPageSize, (page + 1) * reportPageSize)
    : rows

  if (!rows.length) {
    return (
      <div className="empty-state" role="status">
        <FileText size={25} aria-hidden="true" />
        <p>{loading ? 'Загружаем отчёты…' : 'Отчёты не найдены'}</p>
        {!loading && <span>Попробуйте изменить период или другие фильтры.</span>}
      </div>
    )
  }

  return (
    <>
      <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
        <table className="report-table" aria-label={label}>
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Смена</th>
              {leader && <th scope="col">Сотрудник</th>}
              <th scope="col" className="number model-alice">
                Alice
              </th>
              <th scope="col" className="number model-alexa">
                Alexa
              </th>
              <th scope="col" className="number">
                Продажи
              </th>
              <th scope="col" className="number">
                Лиды
              </th>
              <th scope="col" className="table-action">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <time dateTime={row.report_date}>{dateLabel(row.report_date)}</time>
                </th>
                <td>
                  <span className="shift-pill">{shiftNames[row.shift_type] ?? row.shift_type}</span>
                </td>
                {leader && (
                  <td className="employee-cell">
                    <span className="employee-name" title={nameOf(row.staff_id)}>
                      {nameOf(row.staff_id)}
                    </span>
                  </td>
                )}
                <td className="number model-alice">{money(revenue(row, 'alice'))}</td>
                <td className="number model-alexa">{money(revenue(row, 'alexa'))}</td>
                <td className="number">
                  {Number(row.alice_sales ?? 0) + Number(row.alexa_sales ?? 0)}
                </td>
                <td className="number">
                  {Number(row.alice_leads ?? 0) + Number(row.alexa_leads ?? 0)}
                </td>
                <td className="table-action">
                  <button
                    type="button"
                    className="button button-quiet edit-button"
                    aria-label={`Изменить отчёт за ${dateLabel(row.report_date)}${leader ? `, ${nameOf(row.staff_id)}` : ''}`}
                    onClick={() => onEdit(row)}
                  >
                    <Pencil size={15} aria-hidden="true" /> Изменить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginate && (
        <Pagination
          page={page}
          total={rows.length}
          pageSize={reportPageSize}
          label="отчётов"
          onChange={setRequestedPage}
        />
      )}
    </>
  )
}

function TeamDirectory({
  team,
  rows,
  currentUser,
  avatar,
  onOpen,
  onAnalyze
}: {
  team: Staff[]
  rows: ReportRow[]
  currentUser: string
  avatar: string | null
  onOpen: (id: string) => void
  onAnalyze: (id: string) => void
}): JSX.Element {
  const [requestedPage, setRequestedPage] = useState(0)
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(team.length / teamPageSize) - 1))
  const summaries = useMemo(() => {
    const byStaff = new Map<string, { shifts: number; lastDate: string }>()
    for (const row of rows) {
      const summary = byStaff.get(row.staff_id) ?? { shifts: 0, lastDate: row.report_date }
      summary.shifts += 1
      if (row.report_date > summary.lastDate) summary.lastDate = row.report_date
      byStaff.set(row.staff_id, summary)
    }
    return byStaff
  }, [rows])

  return (
    <section aria-labelledby="team-directory-heading">
      <div className="section-heading">
        <h2 id="team-directory-heading">Сотрудники</h2>
        <span className="muted number">{team.length}</span>
      </div>
      {team.length ? (
        <ul className="team-grid">
          {team.slice(page * teamPageSize, (page + 1) * teamPageSize).map((member) => {
            const summary = summaries.get(member.id)
            const memberName = member.display_name || 'Сотрудник'
            return (
              <li key={member.id} className="panel team-member">
                <div className="team-identity">
                  <UserAvatar
                    name={memberName}
                    avatar={member.id === currentUser ? avatar : null}
                  />
                  <div>
                    <h3>{memberName}</h3>
                    <span className="role-pill">
                      {member.role === 'leader' ? 'Руководитель' : 'Чаттер'}
                    </span>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Смен</dt>
                    <dd>{summary?.shifts ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Последний отчёт</dt>
                    <dd>{summary ? dateLabel(summary.lastDate) : '—'}</dd>
                  </div>
                </dl>
                <div className="button-group team-actions">
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onOpen(member.id)}
                    aria-label={`Отчёты сотрудника ${memberName}`}
                  >
                    Отчёты <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    onClick={() => onAnalyze(member.id)}
                    aria-label={`Аналитика сотрудника ${memberName}`}
                  >
                    Аналитика <BarChart3 size={16} aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="empty-state">Список сотрудников пока пуст.</p>
      )}
      <Pagination
        page={page}
        total={team.length}
        pageSize={teamPageSize}
        label="сотрудников"
        onChange={setRequestedPage}
      />
    </section>
  )
}

function Workspace({
  scope,
  email
}: {
  scope: SessionScope
  email: string | undefined
}): JSX.Element {
  const userId = scope.userId
  const signal = scope.controller.signal
  const draftKey = `aura-draft-v05-${userId}`
  const [avatar, setAvatar] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState<Page>('dashboard')
  const [date, setDate] = useState(today)
  const [shift, setShift] = useState<Shift>('day')
  const [alice, setAlice] = useState(emptyReport)
  const [alexa, setAlexa] = useState(emptyReport)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [profileAttempt, setProfileAttempt] = useState(0)
  const [{ reports, team }, setWorkspaceData] = useState<{ reports: ReportRow[]; team: Staff[] }>({
    reports: [],
    team: []
  })
  const [fetching, setFetching] = useState(false)
  const [dataError, setDataError] = useState('')
  const [period, setPeriod] = useState<ReportPeriod>('month')
  const [person, setPerson] = useState('all')
  const [search, setSearch] = useState('')
  const [filterShift, setFilterShift] = useState('all')
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(today)
  const [editing, setEditing] = useState<ReportRow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')
  const [draftFound, setDraftFound] = useState(() => hasSavedDraft(draftKey))
  const [audit, setAudit] = useState<
    {
      id: string
      changed_at: string
      changed_by: string | null
      before_data: Record<string, unknown> | null
      after_data: Record<string, unknown> | null
    }[]
  >([])
  const [auditError, setAuditError] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const lastPage = useRef(page)
  const refreshRequest = useRef<AbortController | null>(null)
  const auditRequest = useRef(0)
  const savePending = useRef(false)
  const isLeader = staff?.role === 'leader'

  const refreshData = useCallback(
    async (role: string): Promise<void> => {
      if (signal.aborted) return
      refreshRequest.current?.abort()
      const request = new AbortController()
      refreshRequest.current = request
      const isCurrent = (): boolean =>
        !signal.aborted && !request.signal.aborted && refreshRequest.current === request
      setFetching(true)
      setDataError('')
      try {
        const isBoss = role === 'leader'
        const [reports, team] = await Promise.all([
          loadReports(supabase, scope, isBoss, request.signal),
          isBoss ? loadTeam(supabase, scope, request.signal) : []
        ])
        if (isCurrent()) setWorkspaceData({ reports, team })
      } catch (err) {
        if (isCurrent()) setDataError(err instanceof Error ? err.message : String(err))
      } finally {
        if (isCurrent()) {
          refreshRequest.current = null
          setFetching(false)
        }
        request.abort()
      }
    },
    [scope, signal]
  )

  useEffect(() => {
    let active = true
    async function loadStaff(): Promise<void> {
      if (signal.aborted) return
      try {
        const { data, error: err } = await sessionRequest(
          scope,
          supabase.from('staff').select('id,display_name,role').eq('id', userId)
        ).single()
        if (!active || signal.aborted) return
        if (err) throw new Error(err.message)
        const profile = data as Staff
        setStaff(profile)
        await refreshData(profile.role)
      } catch (err) {
        if (active && !signal.aborted) {
          setDataError(
            `Не удалось загрузить роль: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    }
    void loadStaff()
    return () => {
      active = false
    }
  }, [profileAttempt, refreshData, scope, signal, userId])

  function retryProfile(): void {
    if (signal.aborted || !dataError) return
    setDataError('')
    setProfileAttempt((attempt) => attempt + 1)
  }

  const staffById = useMemo(() => new Map(team.map((member) => [member.id, member])), [team])
  const detailedFilters = page === 'history' || page === 'team'
  const visibleSearch = detailedFilters ? search : ''
  const visibleShift = detailedFilters ? filterShift : 'all'
  const filtered = useMemo(
    () =>
      filterReports(
        reports,
        { period, person, shift: visibleShift, search: visibleSearch },
        staffById,
        new Date()
      ),
    [reports, period, person, visibleShift, visibleSearch, staffById]
  )
  const calendarReports = useMemo(
    () => (page === 'calendar' ? indexReportsByDate(reports, person) : undefined),
    [page, reports, person]
  )
  const shiftsByType = useMemo(() => {
    if (page !== 'team') return null
    const counts = { morning: 0, day: 0, night: 0 }
    for (const row of filtered) {
      const shiftType = row.shift_type
      if (Object.hasOwn(counts, shiftType)) counts[shiftType] += 1
    }
    return counts
  }, [filtered, page])
  const nameOf = (id: string): string =>
    id === staff?.id
      ? staff?.display_name || email || 'Я'
      : staffById.get(id)?.display_name || 'Сотрудник'
  useEffect(() => {
    if (lastPage.current === page) return
    lastPage.current = page
    mainRef.current?.focus()
  }, [page])
  useEffect(() => {
    if (signal.aborted || !dirty || page !== 'report' || editing) return
    try {
      localStorage.setItem(draftKey, JSON.stringify({ date, shift, alice, alexa }))
    } catch {
      /* storage disabled */
    }
  }, [signal, dirty, page, draftKey, editing, date, shift, alice, alexa])
  const handleShortcut = useEffectEvent((e: KeyboardEvent): void => {
    if (signal.aborted || !staff || !(e.ctrlKey || e.metaKey)) return
    if (document.querySelector('dialog[open]')) return
    if (e.key.toLowerCase() === 's' && page === 'report') {
      e.preventDefault()
      formRef.current?.requestSubmit()
    }
    if (e.key.toLowerCase() === 'n') {
      e.preventDefault()
      openReport()
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => handleShortcut(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  function restoreDraft(): void {
    if (signal.aborted) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (typeof saved.date === 'string') setDate(saved.date)
      if (saved.shift && saved.shift in shiftLabels) setShift(saved.shift)
      if (saved.alice) setAlice(saved.alice)
      if (saved.alexa) setAlexa(saved.alexa)
      setEditing(null)
      setDirty(true)
      setPage('report')
      setToast('Черновик восстановлен')
    } catch {
      setToast('Не удалось восстановить черновик')
    }
  }
  async function loadAudit(reportId: string): Promise<void> {
    if (signal.aborted) return
    const request = ++auditRequest.current
    const isCurrent = (): boolean => !signal.aborted && request === auditRequest.current
    setShowAudit(true)
    setAuditLoading(true)
    setAuditError('')
    setAudit([])
    try {
      const { data, error } = await sessionRequest(
        scope,
        supabase
          .from('shift_report_audit')
          .select('id,changed_at,changed_by,before_data,after_data')
          .eq('report_id', reportId)
          .order('changed_at', { ascending: false })
          .limit(50)
      )
      if (!isCurrent()) return
      if (error) setAuditError(error.message)
      else setAudit(data ?? [])
    } catch (err) {
      if (isCurrent()) setAuditError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isCurrent()) setAuditLoading(false)
    }
  }
  function closeAudit(): void {
    auditRequest.current++
    setShowAudit(false)
    setAuditLoading(false)
  }
  function navigate(next: Page): void {
    if (signal.aborted) return
    if (dirty && !window.confirm('Есть несохранённые изменения. Покинуть форму?')) return
    if (signal.aborted) return
    if (next === 'dashboard') setDraftFound(hasSavedDraft(draftKey))
    setDirty(false)
    setMessage('')
    setPage(next)
  }
  function editReport(r: ReportRow): void {
    if (signal.aborted) return
    auditRequest.current++
    setShowAudit(false)
    setEditing(r)
    setDate(r.report_date)
    setShift(r.shift_type)
    setAlice(toForm(r, 'alice'))
    setAlexa(toForm(r, 'alexa'))
    setDirty(false)
    setMessage('')
    setPage('report')
  }
  function exportCSV(): void {
    if (signal.aborted) return
    const blob = new Blob([createReportsCsv(filtered, nameOf)], {
      type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'AURA_reports.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  async function handleLogout(): Promise<void> {
    if (signal.aborted) return
    setError('')
    try {
      const { error: logoutError } = await supabase.auth.signOut()
      if (!signal.aborted && logoutError) setError(logoutError.message)
    } catch (err) {
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Ошибка сети')
    }
  }
  function openReport(): void {
    if (signal.aborted || !staff) return
    if (dirty && !window.confirm('Сбросить несохранённые изменения?')) return
    if (signal.aborted) return
    auditRequest.current++
    setShowAudit(false)
    setEditing(null)
    setDate(today())
    setShift('day')
    setAlice(emptyReport())
    setAlexa(emptyReport())
    setDirty(false)
    setMessage('')
    setPage('report')
  }
  async function handleReport(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (signal.aborted || savePending.current || !staff) return
    savePending.current = true
    setSaving(true)
    setMessage('')

    try {
      // В этой схеме staff.id совпадает с auth.users.id.
      const staffId = editing ? editing.staff_id : userId
      const { data: targetStaff, error: staffError } = await sessionRequest(
        scope,
        supabase.from('staff').select('id').eq('id', staffId)
      ).maybeSingle()
      if (signal.aborted) return
      if (staffError) throw new Error(staffError.message)
      if (!targetStaff) throw new Error('Сотрудник не найден в таблице staff.')

      if (editing && staffId !== userId && !isLeader)
        throw new Error('Недостаточно прав для редактирования.')
      const values = [alice, alexa]
      if (values.some((profile) => Object.values(profile).some((v) => v.trim() === '')))
        throw new Error('Заполни все десять показателей.')
      for (const profile of values) {
        const balances = [profile.startingBalance, profile.endingBalance]
        if (balances.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
          throw new Error('Баланс должен быть неотрицательным числом.')
        }
        if (
          [profile.sales, profile.customers, profile.leads].some(
            (value) => !Number.isSafeInteger(Number(value)) || Number(value) < 0
          )
        )
          throw new Error('Продажи, покупатели и лиды должны быть целыми неотрицательными числами.')
      }

      const payload = {
        staff_id: staffId,
        report_date: date,
        shift_type: shift,
        alice_start_balance: Number(alice.startingBalance),
        alice_end_balance: Number(alice.endingBalance),
        alice_sales: Number(alice.sales),
        alice_customers: Number(alice.customers),
        alice_leads: Number(alice.leads),
        alexa_start_balance: Number(alexa.startingBalance),
        alexa_end_balance: Number(alexa.endingBalance),
        alexa_sales: Number(alexa.sales),
        alexa_customers: Number(alexa.customers),
        alexa_leads: Number(alexa.leads)
      }

      const { data: existing, error: lookupError } = await sessionRequest(
        scope,
        supabase.from('shift_reports').select('id').eq('staff_id', staffId).eq('report_date', date)
      ).maybeSingle()
      if (signal.aborted) return
      if (lookupError) throw new Error(lookupError.message)

      if (existing) {
        const confirmed = window.confirm(
          `Отчёт сотрудника ${nameOf(staffId)} за ${date} уже существует. Сохранить изменения?`
        )
        if (signal.aborted) return
        if (!confirmed) {
          setMessage('Изменения не сохранены: существующий отчёт оставлен без изменений.')
          return
        }
        const { data: updated, error: updateError } = await sessionRequest(
          scope,
          supabase
            .from('shift_reports')
            .update(payload)
            .eq('id', existing.id)
            .eq('staff_id', staffId)
            .select('id')
        ).single()
        if (signal.aborted) return
        if (updateError) throw new Error(updateError.message)
        if (!updated) throw new Error('Не удалось подтвердить обновление отчёта.')
        setMessage('Отчёт успешно обновлён в Supabase!')
      } else {
        const { data: inserted, error: insertError } = await sessionRequest(
          scope,
          supabase.from('shift_reports').insert(payload).select('id')
        ).single()
        if (signal.aborted) return
        if (insertError) {
          if (insertError.code === '23505')
            throw new Error(
              'Отчёт за эту дату уже создан. Нажми «Сохранить отчёт» ещё раз, чтобы предложить обновление.'
            )
          throw new Error(insertError.message)
        }
        if (!inserted) throw new Error('Не удалось подтвердить сохранение отчёта.')
        setMessage('Отчёт успешно сохранён в Supabase!')
      }
      setDirty(false)
      if (!editing) {
        try {
          localStorage.removeItem(draftKey)
        } catch {
          // The report is saved even when local storage is unavailable.
        }
        setDraftFound(false)
      }
      setToast('Отчёт сохранён в Supabase')
      await refreshData(staff.role)
    } catch (err) {
      if (!signal.aborted) setMessage(`Ошибка: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      savePending.current = false
      if (!signal.aborted) setSaving(false)
    }
  }

  function changeMonth(delta: number): void {
    const [y, m] = calendarMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    setCalendarMonth(month)
    setSelectedDay(`${month}-01`)
  }
  function calendarCells(): string[] {
    const [y, m] = calendarMonth.split('-').map(Number)
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const days = new Date(y, m, 0).getDate()
    return [
      ...Array(offset).fill(''),
      ...Array.from(
        { length: days },
        (_, i) => `${calendarMonth}-${String(i + 1).padStart(2, '0')}`
      )
    ] as string[]
  }
  function openDayHistory(): void {
    if (signal.aborted) return
    setPeriod('all')
    setFilterShift('all')
    setSearch(selectedDay)
    navigate('history')
  }

  function openMemberHistory(id: string): void {
    if (signal.aborted) return
    setPerson(id)
    setSearch('')
    navigate('history')
  }

  function openMemberAnalytics(id: string): void {
    if (signal.aborted) return
    setPerson(id)
    navigate('analytics')
  }

  const selectedReports = calendarReports?.get(selectedDay) ?? []
  const dateToday = today()
  const todayReports = useMemo(
    () =>
      page === 'dashboard'
        ? reports.filter(
            (row) => row.report_date === dateToday && (person === 'all' || row.staff_id === person)
          )
        : [],
    [page, reports, dateToday, person]
  )
  const reportTableKey = JSON.stringify([period, person, visibleShift, visibleSearch])

  if (!staff)
    return (
      <main className="center-stage">
        <section className="panel startup-panel">
          <Brand />
          {dataError ? (
            <p className="message message-error" role="alert">
              {dataError}
            </p>
          ) : (
            <p role="status">
              <span className="loading-dot" />
              Загружаем профиль…
            </p>
          )}
          {error && (
            <p className="message message-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-group">
            {dataError && (
              <MotionButton type="button" onClick={retryProfile} className="button button-primary">
                <RefreshCw size={17} aria-hidden="true" /> Повторить загрузку
              </MotionButton>
            )}
            <button type="button" onClick={handleLogout} className="button button-secondary">
              <LogOut size={17} aria-hidden="true" /> Выйти
            </button>
          </div>
        </section>
      </main>
    )

  const title = page === 'report' && editing ? 'Редактирование отчёта' : pageTitles[page]
  const roleName = isLeader ? 'Руководитель' : 'Чаттер'
  const personName = staff.display_name || email || 'Пользователь'
  const kpis = [
    ['Отчёты за период', filtered.length],
    ['Утренние смены', shiftsByType?.morning ?? 0],
    ['Дневные смены', shiftsByType?.day ?? 0],
    ['Ночные смены', shiftsByType?.night ?? 0]
  ]

  return (
    <div className="aura-shell">
      <aside className="sidebar">
        <div className="rail-brand" title="AURA Reporting System">
          <Brand />
        </div>
        <nav className="sidebar-nav" aria-label="Разделы приложения">
          {navigation
            .filter((item) => item.page !== 'team' || isLeader)
            .map(({ page: target, label, icon: Icon }) => (
              <button
                key={target}
                type="button"
                className="nav-button"
                aria-current={page === target ? 'page' : undefined}
                aria-label={label}
                onClick={() => navigate(target)}
              >
                <Icon size={19} aria-hidden="true" />
                <span className="rail-label" aria-hidden="true">
                  {label}
                </span>
              </button>
            ))}
        </nav>
      </aside>

      <div className="workspace-frame">
        <header
          className={`workspace-topbar${page === 'dashboard' ? ' workspace-topbar-wide' : ''}`}
        >
          <div className="workspace-topbar-inner">
            <span className="topbar-section">{page === 'dashboard' ? 'Главная' : title}</span>
            <div className="topbar-actions">
              {page !== 'report' && (
                <>
                  <MotionButton
                    type="button"
                    className="button button-quiet icon-button topbar-refresh"
                    onClick={() => void refreshData(staff.role)}
                    disabled={fetching}
                    aria-label={fetching ? 'Загружаем данные' : 'Обновить'}
                    title="Обновить"
                  >
                    <RefreshCw
                      className={fetching ? 'is-spinning' : undefined}
                      size={18}
                      aria-hidden="true"
                    />
                  </MotionButton>
                  <MotionButton
                    type="button"
                    className="button button-primary topbar-create"
                    onClick={openReport}
                    aria-label="Создать отчёт"
                    title="Создать отчёт"
                  >
                    <FilePlus2 size={18} aria-hidden="true" />
                    <span className="topbar-create-label">Создать отчёт</span>
                  </MotionButton>
                </>
              )}
              <ProfileMenu
                scope={scope}
                name={personName}
                role={roleName}
                avatar={avatar}
                onAvatarChange={setAvatar}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </header>

        <main
          className={`workspace${page === 'dashboard' ? ' workspace-dashboard' : ''}`}
          ref={mainRef}
          tabIndex={-1}
          aria-label={title}
        >
          {error && (
            <p className="message message-error topology-message" role="alert">
              {error}
            </p>
          )}
          {dataError && (
            <p className="message message-error topology-message" role="alert">
              <CircleAlert size={18} aria-hidden="true" /> Ошибка загрузки: {dataError}
            </p>
          )}
          {toast && (
            <div className="toast">
              <span role="status">
                <Bell size={18} aria-hidden="true" />
                {toast}
              </span>
              <button
                type="button"
                className="button button-quiet icon-button"
                aria-label="Закрыть уведомление"
                onClick={() => setToast('')}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          <SectionTransition sectionKey={page}>
            {page !== 'dashboard' && (
              <header className="page-header">
                <h1>{title}</h1>
                {page === 'report' && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => navigate(editing ? 'history' : 'dashboard')}
                  >
                    <ArrowLeft size={17} aria-hidden="true" /> Назад
                  </button>
                )}
              </header>
            )}
            {fetching && (
              <span className="sr-only" role="status">
                Обновляем данные
              </span>
            )}

            {page !== 'dashboard' && page !== 'report' && (page !== 'calendar' || isLeader) && (
              <div className="filters panel" role="group" aria-label="Фильтры">
                <span className="filter-icon" aria-hidden="true">
                  <SlidersHorizontal size={18} />
                </span>
                {page !== 'calendar' && (
                  <label className="field filter-field">
                    <span>Период</span>
                    <select
                      value={period}
                      onChange={(event) => setPeriod(event.target.value as ReportPeriod)}
                    >
                      <option value="7">Последние 7 дней</option>
                      <option value="30">Последние 30 дней</option>
                      <option value="month">Текущий месяц</option>
                      <option value="all">Всё время</option>
                    </select>
                  </label>
                )}
                {isLeader && (
                  <label className="field filter-field">
                    <span>Сотрудник</span>
                    <select value={person} onChange={(event) => setPerson(event.target.value)}>
                      <option value="all">Все сотрудники</option>
                      {team.map((member) => (
                        <option value={member.id} key={member.id}>
                          {member.display_name || 'Сотрудник'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {detailedFilters && (
                  <>
                    <label className="field filter-field">
                      <span>Смена</span>
                      <select
                        value={filterShift}
                        onChange={(event) => setFilterShift(event.target.value)}
                      >
                        <option value="all">Все смены</option>
                        {(Object.keys(shiftNames) as Shift[]).map((value) => (
                          <option key={value} value={value}>
                            {shiftNames[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field filter-search">
                      <span>Поиск</span>
                      <input
                        type="search"
                        value={search}
                        placeholder="Дата или имя"
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
            )}

            {page === 'team' && (
              <div className="kpi-grid" aria-label="Сводка за период">
                {kpis.map(([label, value], index) => (
                  <MotionCard
                    key={label}
                    delay={index * 0.025}
                    className={`panel kpi-card${index === 0 ? ' kpi-featured' : ''}`}
                  >
                    <span>{label}</span>
                    <strong className="number">{value}</strong>
                  </MotionCard>
                ))}
              </div>
            )}

            {page === 'dashboard' && (
              <DashboardView
                dateToday={dateToday}
                displayName={personName}
                isLeader={isLeader}
                period={period}
                onPeriodChange={setPeriod}
                person={person}
                team={team}
                onPersonChange={setPerson}
                rows={filtered}
                todayReports={todayReports}
                nameOf={nameOf}
                loading={fetching && !reports.length}
                draftFound={draftFound}
                onRestoreDraft={restoreDraft}
                onEdit={editReport}
                onNavigate={navigate}
              />
            )}

            {page === 'history' && (
              <section className="panel table-panel" aria-labelledby="history-table-heading">
                <div className="section-heading">
                  <div>
                    <h2 id="history-table-heading">Отчёты</h2>
                    <p className="muted number" aria-live="polite">
                      Найдено: {filtered.length}
                    </p>
                  </div>
                  <button type="button" className="button button-secondary" onClick={exportCSV}>
                    <Download size={17} aria-hidden="true" /> Экспорт CSV
                  </button>
                </div>
                <ReportTable
                  key={reportTableKey}
                  rows={filtered}
                  leader={isLeader}
                  label="История отчётов"
                  loading={fetching && !reports.length}
                  paginate
                  nameOf={nameOf}
                  onEdit={editReport}
                />
              </section>
            )}

            {page === 'analytics' && (
              <div className="analytics-stack">
                <ModelAnalytics model="alice" rows={filtered} />
                <ModelAnalytics model="alexa" rows={filtered} />
              </div>
            )}

            {page === 'team' && isLeader && (
              <>
                <TeamDirectory
                  team={team}
                  rows={filtered}
                  currentUser={userId}
                  avatar={avatar}
                  onOpen={openMemberHistory}
                  onAnalyze={openMemberAnalytics}
                />
                <section className="panel table-panel" aria-labelledby="team-reports-heading">
                  <div className="section-heading">
                    <h2 id="team-reports-heading">Отчёты команды</h2>
                    <span className="muted number">{filtered.length}</span>
                  </div>
                  <ReportTable
                    key={reportTableKey}
                    rows={filtered}
                    leader
                    label="Отчёты команды"
                    loading={fetching && !reports.length}
                    paginate
                    nameOf={nameOf}
                    onEdit={editReport}
                  />
                </section>
              </>
            )}

            {page === 'calendar' && (
              <div className="calendar-layout">
                <section className="panel calendar-panel" aria-labelledby="calendar-month">
                  <div className="section-heading">
                    <h2 id="calendar-month" aria-live="polite">
                      {new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString('ru-RU', {
                        month: 'long',
                        year: 'numeric'
                      })}
                    </h2>
                    <div className="button-group">
                      <button
                        type="button"
                        className="button button-quiet icon-button"
                        aria-label="Предыдущий месяц"
                        onClick={() => changeMonth(-1)}
                      >
                        <ChevronLeft size={19} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="button button-quiet icon-button"
                        aria-label="Следующий месяц"
                        onClick={() => changeMonth(1)}
                      >
                        <ChevronRight size={19} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="calendar-grid">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day, index) => (
                      <span
                        className={index >= 5 ? 'weekend' : undefined}
                        key={day}
                        aria-hidden="true"
                      >
                        {day}
                      </span>
                    ))}
                    {calendarCells().map((day, index) => {
                      if (!day)
                        return (
                          <span className="calendar-gap" aria-hidden="true" key={`gap-${index}`} />
                        )
                      const count = calendarReports?.get(day)?.length ?? 0
                      const date = new Date(`${day}T12:00:00`)
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`calendar-day${index % 7 >= 5 ? ' weekend' : ''}`}
                          aria-pressed={selectedDay === day}
                          aria-current={day === dateToday ? 'date' : undefined}
                          aria-label={`${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}, отчётов: ${count}`}
                          onClick={() => setSelectedDay(day)}
                        >
                          <span className="number">{date.getDate()}</span>
                          {count > 0 && (
                            <small className="day-count">
                              {count}
                              <span> отч.</span>
                            </small>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>
                <MotionCard className="panel calendar-detail" delay={0.04}>
                  <div className="section-title">
                    <span className="section-icon">
                      <CalendarDays size={18} aria-hidden="true" />
                    </span>
                    <h2>{dateLabel(selectedDay)}</h2>
                  </div>
                  {!selectedReports.length ? (
                    <p className="muted">За этот день отчётов нет.</p>
                  ) : (
                    <>
                      <p className="muted">
                        Отчётов: <strong className="number">{selectedReports.length}</strong>
                      </p>
                      <ul className="calendar-detail-list">
                        {selectedReports.slice(0, 4).map((row) => (
                          <li key={row.id}>
                            <span className="shift-pill">
                              {shiftNames[row.shift_type] ?? row.shift_type}
                            </span>
                            {isLeader && <span>{nameOf(row.staff_id)}</span>}
                          </li>
                        ))}
                      </ul>
                      {selectedReports.length === 1 ? (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => editReport(selectedReports[0])}
                        >
                          Открыть отчёт <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={openDayHistory}
                        >
                          Все отчёты дня <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </MotionCard>
              </div>
            )}

            {page === 'report' && (
              <form
                ref={formRef}
                onSubmit={handleReport}
                className="report-form"
                onChange={() => setDirty(true)}
                aria-busy={saving}
              >
                <section className="panel form-panel" aria-labelledby="shift-information">
                  <div className="section-title">
                    <span className="section-icon">
                      <CalendarDays size={18} aria-hidden="true" />
                    </span>
                    <h2 id="shift-information">Информация о смене</h2>
                  </div>
                  <div className="shift-fields">
                    <label className="field">
                      <span>Дата</span>
                      <input
                        type="date"
                        value={date}
                        disabled={!!editing}
                        onChange={(event) => setDate(event.target.value)}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Смена</span>
                      <select
                        value={shift}
                        onChange={(event) => setShift(event.target.value as Shift)}
                      >
                        {(Object.keys(shiftNames) as Shift[]).map((value) => (
                          <option key={value} value={value}>
                            {shiftNames[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-meta">
                    <p className="muted">
                      <UserRound size={16} aria-hidden="true" />{' '}
                      {editing ? nameOf(editing.staff_id) : personName}
                    </p>
                    {editing && (
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() => void loadAudit(editing.id)}
                        aria-haspopup="dialog"
                      >
                        <Clock3 size={17} aria-hidden="true" /> История изменений
                      </button>
                    )}
                  </div>
                </section>
                <ProfileFields model="alice" report={alice} onChange={setAlice} />
                <ProfileFields model="alexa" report={alexa} onChange={setAlexa} />
                {(Number(alice.endingBalance) < Number(alice.startingBalance) ||
                  Number(alexa.endingBalance) < Number(alexa.startingBalance) ||
                  Number(alice.customers) > Number(alice.sales) ||
                  Number(alexa.customers) > Number(alexa.sales)) && (
                  <p className="message message-warning" role="status">
                    <CircleAlert size={18} aria-hidden="true" /> Проверьте показатели: баланс
                    снизился или покупателей больше, чем продаж. Отчёт можно сохранить.
                  </p>
                )}
                {message && (
                  <p
                    className={`message${message.startsWith('Ошибка:') ? ' message-error' : ''}`}
                    role={message.startsWith('Ошибка:') ? 'alert' : 'status'}
                  >
                    {message}
                  </p>
                )}
                <div className="form-footer">
                  <p className="muted">
                    {dirty ? 'Есть несохранённые изменения.' : 'Один отчёт на сотрудника за дату.'}
                  </p>
                  <MotionButton type="submit" className="button button-primary" disabled={saving}>
                    <ClipboardCheck size={18} aria-hidden="true" />{' '}
                    {saving ? 'Сохраняем…' : editing ? 'Сохранить изменения' : 'Сохранить отчёт'}
                  </MotionButton>
                </div>
              </form>
            )}
          </SectionTransition>
          <MotionDialog
            open={page === 'report' && showAudit && !!editing}
            title="История изменений"
            onClose={closeAudit}
          >
            {auditLoading && (
              <p role="status">
                <span className="loading-dot" /> Загружаем историю…
              </p>
            )}
            {auditError && (
              <p className="message message-error" role="alert">
                Журнал недоступен: {auditError}
              </p>
            )}
            {!auditLoading && !auditError && !audit.length && (
              <p className="muted">Изменений пока нет.</p>
            )}
            {audit.length > 0 && (
              <ol className="audit-list">
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <strong>{new Date(entry.changed_at).toLocaleString('ru-RU')}</strong>
                    <p className="muted">
                      Изменил: {entry.changed_by ? nameOf(entry.changed_by) : 'Система'}
                    </p>
                    <dl>
                      {Object.keys(entry.after_data ?? {})
                        .filter(
                          (key) =>
                            entry.before_data?.[key] !== entry.after_data?.[key] &&
                            key !== 'updated_at'
                        )
                        .map((key) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>
                              {String(entry.before_data?.[key] ?? '—')} →{' '}
                              {String(entry.after_data?.[key] ?? '—')}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </MotionDialog>
        </main>
      </div>
    </div>
  )
}
