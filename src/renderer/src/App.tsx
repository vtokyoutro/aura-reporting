import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useRef,
  type CSSProperties,
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
  History,
  BarChart3,
  Users,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Bell,
  Save,
  X,
  Clock3
} from 'lucide-react'
import { loadReports, loadTeam, type ReportRow, type Shift, type Staff } from './lib/report-data'
import ModelAnalytics from './components/ModelAnalytics'
import {
  createReportsCsv,
  dateLabel,
  filterReports,
  indexReportsByDate,
  money,
  revenue,
  shiftLabels,
  sum,
  type ModelName,
  type ReportPeriod
} from './lib/report-view'

type ProfileReport = { startingBalance: string; endingBalance: string; sales: string; customers: string; leads: string }
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
const colors = { bg: '#0e1018', panel: '#171b27', border: '#2a3041', muted: '#9ca7bf', accent: '#8b6cff', text: '#f6f6fc' }
const fieldStyle: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '13px 14px', background: '#10141f', border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.text, fontSize: 14, outlineColor: colors.accent, colorScheme: 'dark' }
const panelStyle: CSSProperties = { background: colors.panel, border: `1px solid ${colors.border}`, borderRadius: 18, padding: 26 }
const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '12px 18px', background: colors.accent, color: 'white', border: 0, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 650 }
const secondaryButton: CSSProperties = { ...primaryButton, background: '#24293a', color: '#d6dcf0', border: `1px solid ${colors.border}` }

function ProfileFields({ title, report, onChange }: { title: string; report: ProfileReport; onChange: (next: ProfileReport) => void }): JSX.Element {
  const fields: { key: keyof ProfileReport; label: string; step: string; min?: string }[] = [
    { key: 'startingBalance', label: 'Начальный баланс ($)', step: '0.01', min: '0' },
    { key: 'endingBalance', label: 'Конечный баланс ($)', step: '0.01', min: '0' },
    { key: 'sales', label: 'Продажи', step: '1', min: '0' },
    { key: 'customers', label: 'Покупатели', step: '1', min: '0' },
    { key: 'leads', label: 'Лиды за смену', step: '1', min: '0' }
  ]
  return <section style={panelStyle}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
      <span style={{ width: 9, height: 9, background: title === 'Alice' ? '#aa8cff' : '#5dc8d9', borderRadius: '50%' }} />
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      <span style={{ color: colors.muted, fontSize: 12, marginLeft: 'auto' }}>5 показателей</span>
    </div>
    <div className="aura-fields">
      {fields.map(field => <label key={field.key} style={{ display: 'grid', gap: 9, minWidth: 0 }}>
        <span style={{ color: '#b5bfd5', fontSize: 13 }}>{field.label}</span>
        <input type="number" min={field.min} step={field.step} value={report[field.key]} onChange={e => onChange({ ...report, [field.key]: e.target.value })} placeholder="0" required style={fieldStyle} />
      </label>)}
    </div>
  </section>
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
    <>
      <AppStyles />
      {checkingAuth ? (
        <div style={centerStyle}>Проверяем авторизацию...</div>
      ) : account ? (
        <Workspace key={account.scope.generation} scope={account.scope} email={account.email} />
      ) : (
        <LoginForm authError={authError} />
      )}
    </>
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
    <div style={centerStyle}>
      <form
        onSubmit={handleLogin}
        style={{ ...panelStyle, width: 400, maxWidth: 'calc(100% - 32px)', padding: 32 }}
      >
        <h1 style={{ fontSize: 34, margin: '0 0 6px' }}>
          AURA<span style={{ color: colors.accent }}>.</span>
        </h1>
        <p style={{ color: colors.muted, margin: '0 0 30px' }}>Reporting System</p>
        <div style={{ display: 'grid', gap: 14 }}>
          <input
            name="email"
            type="email"
            autoComplete="username"
            placeholder="Электронная почта"
            required
            style={fieldStyle}
          />
          <input
            ref={passwordRef}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Пароль"
            disabled={loading}
            required
            style={fieldStyle}
          />
          <button type="submit" disabled={loading} style={primaryButton}>
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </div>
        {visibleError && (
          <p role="alert" style={{ color: '#ff9898', overflowWrap: 'anywhere' }}>
            {visibleError}
          </p>
        )}
      </form>
    </div>
  )
}

function hasSavedDraft(key: string): boolean {
  try {
    return Boolean(localStorage.getItem(key))
  } catch {
    return false
  }
}

function Workspace({ scope, email }: { scope: SessionScope; email: string | undefined }): JSX.Element {
  const userId = scope.userId
  const signal = scope.controller.signal
  const draftKey = `aura-draft-v05-${userId}`
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
  const [editing, setEditing] = useState<ReportRow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')
  const [draftFound, setDraftFound] = useState(() => hasSavedDraft(draftKey))
  const [audit, setAudit] = useState<{id:string;changed_at:string;changed_by:string|null;before_data:Record<string,unknown>|null;after_data:Record<string,unknown>|null}[]>([])
  const [auditError, setAuditError] = useState('')
  const [showAudit, setShowAudit] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
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
  const filtered = useMemo(
    () => filterReports(reports, { period, person, shift: filterShift, search }, staffById, new Date()),
    [reports, period, person, filterShift, search, staffById]
  )
  const calendarReports = useMemo(
    () => (page === 'calendar' ? indexReportsByDate(reports, person) : undefined),
    [page, reports, person]
  )
  const totals = useMemo(() => ({ shifts: filtered.length, alice: filtered.reduce((a,r) => a + revenue(r,'alice'),0), alexa: filtered.reduce((a,r) => a + revenue(r,'alexa'),0), sales: sum(filtered,'alice_sales') + sum(filtered,'alexa_sales'), leads: sum(filtered,'alice_leads') + sum(filtered,'alexa_leads'), customers: sum(filtered,'alice_customers') + sum(filtered,'alexa_customers') }), [filtered])
  const nameOf = (id: string): string =>
    id === staff?.id
      ? staff?.display_name || email || 'Я'
      : (staffById.get(id)?.display_name ?? 'Сотрудник')
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
    }
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
    setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function calendarCells(): string[] {
    const [y, m] = calendarMonth.split('-').map(Number)
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const days = new Date(y, m, 0).getDate()
    return [
      ...Array(offset).fill(''),
      ...Array.from({ length: days }, (_, i) => `${calendarMonth}-${String(i + 1).padStart(2, '0')}`)
    ] as string[]
  }
  function renderRows(rows: ReportRow[]): JSX.Element { return <div className="aura-table-wrap"><table className="aura-table"><thead><tr><th>Дата</th><th>Смена</th>{isLeader && <th>Сотрудник</th>}<th>Alice</th><th>Alexa</th><th>Продажи</th><th>Лиды</th><th>Действие</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{dateLabel(r.report_date)}</td><td>{shiftLabels[r.shift_type] ?? r.shift_type}</td>{isLeader && <td>{nameOf(r.staff_id)}</td>}<td style={{color:'#aa8cff'}}>{money(revenue(r,'alice'))}</td><td style={{color:'#5dc8d9'}}>{money(revenue(r,'alexa'))}</td><td>{Number(r.alice_sales??0)+Number(r.alexa_sales??0)}</td><td>{Number(r.alice_leads??0)+Number(r.alexa_leads??0)}</td><td><button type="button" style={{...secondaryButton,padding:'7px 10px'}} onClick={()=>editReport(r)}><Pencil size={14}/> Изменить</button></td></tr>)}{rows.length===0 && <tr><td colSpan={isLeader ? 8 : 7} style={{color:colors.muted}}>Отчётов за выбранный период пока нет.</td></tr>}</tbody></table></div> }

  if (!staff)
    return (
      <div style={centerStyle}>
        <section style={panelStyle}>
          {dataError ? <p role="alert">{dataError}</p> : <p role="status">Загружаем профиль...</p>}
          {error && <p role="alert">{error}</p>}
          {dataError && (
            <button type="button" onClick={retryProfile} style={secondaryButton}>
              <RefreshCw size={18} /> Повторить загрузку
            </button>
          )}
          <button type="button" onClick={handleLogout} style={secondaryButton}>
            <LogOut size={18} /> Выйти
          </button>
        </section>
      </div>
    )

  return <div className="aura-layout" style={{ background: colors.bg, color: colors.text, fontFamily: 'Inter, Segoe UI, Arial, sans-serif' }}>
    <aside className="aura-sidebar">
      <div style={{ marginBottom: 25 }}>
        <h1 style={{ fontSize: 30, margin: '0 0 6px', letterSpacing: -1 }}>AURA<span style={{ color: colors.accent }}>.</span></h1>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.1, color: colors.muted }}>REPORTING SYSTEM</span>
      </div>
      {([['dashboard','Главная',LayoutDashboard],['history','История отчётов',History],['analytics','Аналитика',BarChart3],['calendar','Календарь',CalendarDays],...(isLeader ? [['team','Команда',Users]] : [])] as [Page,string,typeof LayoutDashboard][]).map(([target,label,Icon]) => <button key={target} type="button" onClick={() => navigate(target)} style={{ ...navButton, background: page === target ? '#302849' : 'transparent', color: page === target ? '#c3b3ff' : '#abb5ca' }}><Icon size={18}/>{label}</button>)}
      <div className="aura-sidebar-spacer" style={{ flex: 1 }} />
      <div style={{ borderTop: `1px solid ${colors.border}`, padding: '16px 10px 6px', display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: colors.muted, overflowWrap: 'anywhere', minWidth: 0 }}>
        <UserRound size={17} style={{ flexShrink: 0 }} /><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{email}</span>
      </div>
      <button type="button" onClick={handleLogout} style={navButton}><LogOut size={18} /> Выйти</button>
      {error && <p style={{ color: '#ff9898', fontSize: 12 }}>{error}</p>}
    </aside>

    <main className="aura-content">
      {toast && <div className="aura-toast" role="status"><div style={{display:'flex',alignItems:'center',gap:12}}><Bell size={18}/><span>{toast}</span><button type="button" onClick={()=>setToast('')} style={{...secondaryButton,padding:6,marginLeft:'auto'}}><X size={14}/></button></div></div>}
      {dataError && <div role="alert" style={{...panelStyle, color:'#ff9999', marginBottom:20}}>Ошибка загрузки: {dataError}</div>}
      {page !== 'report' && <div style={{width:'100%'}}> 
        <div style={eyebrow}>{isLeader ? 'Панель руководителя' : 'Личный кабинет'} · {staff?.display_name ?? 'AURA'}</div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <h1 style={heading}>{page === 'dashboard' ? 'Обзор результатов' : page === 'history' ? 'История отчётов' : page === 'analytics' ? 'Аналитика' : page === 'calendar' ? 'Календарь смен' : 'Команда'}</h1>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" onClick={() => void refreshData(staff.role)} disabled={fetching} style={secondaryButton}><RefreshCw size={16}/>{fetching ? 'Загрузка...' : 'Обновить'}</button><button type="button" onClick={openReport} style={primaryButton}><FilePlus2 size={16}/> Создать отчёт</button></div>
        </div>
        <p style={subtitle}>{isLeader ? 'Результаты команды и управление отчётами.' : 'Твои смены, результаты и история.'}</p>
        {page !== 'calendar' && <div className="aura-filter">
          <select aria-label="Период" value={period} onChange={e => setPeriod(e.target.value as typeof period)} style={fieldStyle}><option value="7">Последние 7 дней</option><option value="30">Последние 30 дней</option><option value="month">Текущий месяц</option><option value="all">Всё время</option></select>
          {isLeader && <select aria-label="Сотрудник" value={person} onChange={e => setPerson(e.target.value)} style={fieldStyle}><option value="all">Все сотрудники</option>{team.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select>}
          {(page === 'history' || page === 'team') && <><select aria-label="Смена" value={filterShift} onChange={e => setFilterShift(e.target.value)} style={fieldStyle}><option value="all">Все смены</option>{(Object.keys(shiftLabels) as Shift[]).map(s => <option key={s} value={s}>{shiftLabels[s]}</option>)}</select><input aria-label="Поиск" placeholder="Поиск по дате или имени" value={search} onChange={e => setSearch(e.target.value)} style={fieldStyle}/></>}
        </div>}
        {(page === 'dashboard' || page === 'team') && <div className="aura-stats">
          {[['Выручка (изменение балансов)',money(totals.alice + totals.alexa)],['Смен',String(totals.shifts)],['Продажи',String(totals.sales)],['Лиды',String(totals.leads)],['Покупатели',String(totals.customers)]].map(([label,value]) => <section key={label} style={{...panelStyle,padding:20}}><div style={{fontSize:12,color:colors.muted,marginBottom:12}}>{label}</div><div style={{fontSize:27,fontWeight:750}}>{value}</div></section>)}
        </div>}
        {page === 'dashboard' && <>
          {draftFound && <section style={{...panelStyle,marginBottom:22,borderColor:'#8b6cff'}}><div className="aura-section-header"><div><h2 style={{margin:0}}>Незавершённый отчёт</h2><p style={subtitle}>Есть локально сохранённый черновик.</p></div><button type="button" onClick={restoreDraft} style={primaryButton}><Save size={16}/> Продолжить</button></div></section>}
          <div className="aura-dashboard-grid">
            <section style={panelStyle}>
              <div className="aura-section-header"><h2 style={{margin:0,fontSize:20}}>Последние отчёты</h2><button type="button" style={{...secondaryButton,padding:'8px 12px'}} onClick={()=>navigate('history')}>Вся история</button></div>
              {renderRows(filtered.slice(0,5))}
            </section>
            <section style={panelStyle}>
              <div className="aura-section-header"><h2 style={{margin:0,fontSize:20}}>Активность за сегодня</h2><CalendarDays size={19} color={colors.accent}/></div>
              <p style={subtitle}>Отчётов за {dateLabel(today())}</p>
              <div style={{fontSize:36,fontWeight:750,margin:'12px 0'}}>{reports.filter(r=>r.report_date===today() && (person==='all'||r.staff_id===person)).length}</div>
              {isLeader && <><p style={{...subtitle,marginBottom:10}}>Сотрудники, сдавшие отчёт сегодня:</p>{[...new Set(reports.filter(r=>r.report_date===today()).map(r=>r.staff_id))].map(id=><div key={id} style={{padding:'7px 0',borderBottom:'1px solid #2a3041'}}>{nameOf(id)}</div>)}{!reports.some(r=>r.report_date===today()) && <p style={subtitle}>Пока никто не отчитался.</p>}</>}
              <button type="button" style={{...secondaryButton,marginTop:18}} onClick={()=>navigate('calendar')}><CalendarDays size={16}/> Открыть календарь</button>
            </section>
          </div>
          <div className="aura-dashboard-grid" style={{marginTop:20}}>
            {(['alice','alexa'] as ModelName[]).map(model=>{
              const accent=model==='alice'?'#aa8cff':'#5dc8d9'
              const modelRows=filtered
              return <section key={model} style={{...panelStyle,borderTop:`3px solid ${accent}`}}>
                <div className="aura-section-header"><h2 style={{margin:0,color:accent}}>{model==='alice'?'Alice':'Alexa'}</h2><button type="button" style={{...secondaryButton,padding:'8px 12px'}} onClick={()=>navigate('analytics')}>Подробнее</button></div>
                <p style={subtitle}>Краткие показатели модели за выбранный период</p>
                <div className="aura-dashboard-model-metrics"><div><small>Изменение баланса</small><strong>{money(modelRows.reduce((n,r)=>n+revenue(r,model),0))}</strong></div><div><small>Продажи</small><strong>{sum(modelRows,`${model}_sales` as keyof ReportRow)}</strong></div><div><small>Лиды</small><strong>{sum(modelRows,`${model}_leads` as keyof ReportRow)}</strong></div></div>
              </section>
            })}
          </div>
          <p style={{fontSize:12,color:'#78839b',marginTop:18}}>AURA v0.5 · Изменение баланса не обязательно равно выручке · Данные из Supabase</p>
        </>}
        {page === 'history' && <><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:16}}><span style={{color:colors.muted}}>Найдено: {filtered.length}</span><button type="button" onClick={exportCSV} style={secondaryButton}><Download size={16}/> Экспорт CSV</button></div>{renderRows(filtered)}</>}
        {page === 'analytics' && <>
          <section style={{...panelStyle,marginTop:20,marginBottom:20}}><h2 style={{margin:'0 0 8px'}}>Подробная аналитика моделей</h2><p style={subtitle}>Для каждой модели — собственные показатели и графики по сменам. Данные Alice и Alexa не смешиваются.</p></section>
          <div className="aura-model-stack"><ModelAnalytics model="alice" rows={filtered} panelStyle={panelStyle} subtitleStyle={subtitle}/><ModelAnalytics model="alexa" rows={filtered} panelStyle={panelStyle} subtitleStyle={subtitle}/></div>
        </>}
        {page === 'team' && isLeader && <><h2>Сотрудники</h2><div className="aura-stats">{team.map(t => { const own = filtered.filter(r => r.staff_id === t.id); return <button key={t.id} type="button" onClick={() => {setPerson(t.id);setPage('history')}} style={{...panelStyle,textAlign:'left',color:colors.text,cursor:'pointer'}}><strong>{t.display_name}</strong><p style={subtitle}>{t.role === 'leader' ? 'Руководитель' : 'Чаттер'} · {own.length} смен</p><h2>{money(own.reduce((a,r) => a + revenue(r,'alice')+revenue(r,'alexa'),0))}</h2></button>})}</div><h2>Отчёты команды</h2>{renderRows(filtered)}</>}
        {page === 'calendar' && <section style={{...panelStyle,width:'100%'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}><button type="button" style={secondaryButton} onClick={() => changeMonth(-1)}><ChevronLeft size={18}/></button><h2 style={{margin:0}}>{new Date(`${calendarMonth}-01T12:00:00`).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</h2><button type="button" style={secondaryButton} onClick={() => changeMonth(1)}><ChevronRight size={18}/></button></div><div className="aura-calendar">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <div key={d} style={{textAlign:'center',color:colors.muted,fontSize:12}}>{d}</div>)}{calendarCells().map((d,i) => { const dayReports = d ? (calendarReports?.get(d) ?? []) : []; return <button key={i} type="button" disabled={!d} onClick={() => {if (dayReports.length===1) editReport(dayReports[0]); else if (d) {setPeriod('all');setSearch(d);setPage('history')}}} style={{borderColor:dayReports.length ? colors.accent : colors.border}}>{d?.slice(-2)}{dayReports.length>0 && <div style={{fontSize:11,color:'#ad9bff',marginTop:6}}>{dayReports.length} отч.</div>}</button>})}</div><p style={{...subtitle,fontSize:12,marginTop:18}}>Нажми на день с отчётом, чтобы открыть его. Если отчётов несколько — откроется история.</p></section>}
      </div>}
      {page === 'report' && <div style={{width:'100%'}}> 
        <div style={eyebrow}>Отчётность / {editing ? 'Редактирование' : 'Новый отчёт'}</div>
        <h1 style={heading}>{editing ? 'Редактирование отчёта' : 'Новый отчёт'}</h1>
        <p style={subtitle}>{editing ? `Сотрудник: ${nameOf(editing.staff_id)}. Изменения сохранятся в его отчёте.` : 'Заполни результаты своей смены для Alice и Alexa.'}</p>
        <form ref={formRef} onSubmit={handleReport} className="aura-report" style={{marginTop:30}} onChange={() => setDirty(true)}>
          <section style={panelStyle}><div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}><CalendarDays size={19} color={colors.accent}/><h2 style={{margin:0,fontSize:19}}>Информация о смене</h2></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:18}}><label style={{display:'grid',gap:9}}><span style={labelStyle}>Дата</span><input type="date" value={date} disabled={!!editing} onChange={e=>setDate(e.target.value)} required style={fieldStyle}/></label><label style={{display:'grid',gap:9}}><span style={labelStyle}>Смена</span><select value={shift} onChange={e=>setShift(e.target.value as Shift)} style={fieldStyle}>{(Object.keys(shiftLabels) as Shift[]).map(s => <option key={s} value={s}>{shiftLabels[s]}</option>)}</select></label></div><p style={{...subtitle,fontSize:12,marginTop:16}}>Отчёт от имени: {editing ? nameOf(editing.staff_id) : staff.display_name ?? email}</p></section>
          {editing && <div><button type="button" style={secondaryButton} onClick={()=>void loadAudit(editing.id)}><Clock3 size={16}/> История изменений</button></div>}
          {showAudit && editing && <section style={panelStyle}><div className="aura-section-header"><h2 style={{margin:0}}>История изменений</h2><button type="button" style={secondaryButton} onClick={()=>setShowAudit(false)}><X size={16}/> Закрыть</button></div>{auditError && <p style={{color:'#ffaaaa'}}>Журнал недоступен: {auditError}. Проверь SQL и RLS.</p>}{!auditError && !audit.length && <p style={subtitle}>Изменений пока нет.</p>}{audit.map(a=><div key={a.id} style={{borderTop:'1px solid #303449',padding:'14px 0'}}><strong>{new Date(a.changed_at).toLocaleString('ru-RU')}</strong><p style={subtitle}>Изменил: {a.changed_by ? nameOf(a.changed_by) : 'Система'}</p>{Object.keys(a.after_data ?? {}).filter(k=>a.before_data?.[k] !== a.after_data?.[k] && k !== 'updated_at').map(k=><div key={k} style={{fontSize:12,color:colors.muted,marginTop:6}}>{k}: {String(a.before_data?.[k] ?? '—')} → {String(a.after_data?.[k] ?? '—')}</div>)}</div>)}</section>}
          <ProfileFields title="Alice" report={alice} onChange={setAlice}/><ProfileFields title="Alexa" report={alexa} onChange={setAlexa}/>
          {(Number(alice.endingBalance) < Number(alice.startingBalance) || Number(alexa.endingBalance) < Number(alexa.startingBalance) || Number(alice.customers)>Number(alice.sales) || Number(alexa.customers)>Number(alexa.sales)) && <div style={{padding:16,borderRadius:10,background:'#3b2e23',color:'#ffd8a1'}}>Проверь показатели: есть снижение баланса или покупателей больше, чем продаж. Сохранение разрешено.</div>}
          <div style={{display:'flex',justifyContent:'space-between',gap:14,flexWrap:'wrap'}}><button type="button" style={secondaryButton} onClick={()=>navigate(editing ? 'history':'dashboard')}><ArrowLeft size={17}/> Назад</button><button type="submit" disabled={saving} style={primaryButton}><ClipboardCheck size={18}/>{saving ? 'Сохраняем...' : editing ? 'Сохранить изменения' : 'Сохранить отчёт'}</button></div>
          {message && <div role="status" style={{padding:16,borderRadius:10,background:'#26223b',color:'#c9bbff'}}>{message}</div>}
          <p style={{fontSize:12,color:'#78839b'}}>Один отчёт на сотрудника за дату. При повторном сохранении потребуется подтверждение.</p>
        </form>
      </div>}
    </main>
  </div>
}

function AppStyles(): JSX.Element {
  return (
    <style>{`
    html, body, #root { width: 100% !important; min-width: 0 !important; min-height: 100% !important; margin: 0 !important; padding: 0 !important; max-width: none !important; background: ${colors.bg} !important; background-image: none !important; }
    body { overflow-x: hidden; }
    #root { display: block !important; }
    * { box-sizing: border-box; }
    button, input, select { font-family: inherit; }
    button:hover { filter: brightness(1.09); }
    button:disabled { opacity: .65; cursor: wait; }
    .aura-layout { display: flex; width: 100%; min-height: 100vh; align-items: stretch; }
    .aura-sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; width: 244px; flex: 0 0 244px; background: #161a25; border-right: 1px solid ${colors.border}; padding: 30px 20px 22px; display: flex; flex-direction: column; gap: 12px; }
    .aura-content { flex: 1; min-width: 0; padding: 38px clamp(22px, 3vw, 55px) 80px; overflow: visible; }
    .aura-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 18px; }
    .aura-report { display: grid; gap: 22px; width: 100%; }
    .aura-stats { display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:16px;margin:24px 0; }
    .aura-table-wrap {overflow-x:auto;border:1px solid ${colors.border};border-radius:14px;}
    .aura-table {width:100%;border-collapse:collapse;white-space:nowrap;text-align:left;font-size:13px;}
    .aura-table th {padding:15px 16px;color:${colors.muted};background:#1b2030;font-weight:600;}
    .aura-table td {padding:14px 16px;border-top:1px solid ${colors.border};}
    .aura-table tr:hover td {background:#1b2030;}
    .aura-calendar {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;}
    .aura-calendar button {min-height:66px;background:#10141f;border:1px solid ${colors.border};border-radius:9px;color:${colors.text};cursor:pointer;}
    .aura-calendar button:disabled {opacity:.25;cursor:default;}
    .aura-filter {display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:20px 0;}
    .aura-filter select,.aura-filter input {width:auto;min-width:150px;}

    .aura-section-header {display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px;flex-wrap:wrap}
    .aura-model-stack {display:grid;gap:24px;margin-top:22px}
    .aura-dashboard-grid {display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr);gap:18px}
    .aura-dashboard-grid > section {min-width:0}
    .aura-dashboard-model-metrics {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}
    .aura-dashboard-model-metrics > div {background:#111623;border:1px solid #2a3041;border-radius:10px;padding:14px;display:grid;gap:8px;min-width:0}
    .aura-dashboard-model-metrics small {font-size:12px;color:#9ca7bf}
    .aura-dashboard-model-metrics strong {font-size:20px;overflow-wrap:anywhere}
    @media(max-width:1100px){.aura-dashboard-grid{grid-template-columns:1fr}}
    @media(max-width:620px){.aura-dashboard-model-metrics{grid-template-columns:1fr}}
    .aura-model-panel {min-width:0}
    .aura-model-kpis {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0}
    .aura-mini-stat {background:#111623;border:1px solid #2a3041;border-radius:12px;padding:16px;display:grid;gap:10px;min-width:0}
    .aura-mini-stat small {color:#9ca7bf;font-size:12px}
    .aura-mini-stat strong {font-size:23px;overflow-wrap:anywhere}
    .aura-chart-block {padding:16px 0;border-top:1px solid #2a3041}
    .aura-chart {width:100%;height:165px;display:block;margin:12px 0}
    .aura-toast {position:fixed;right:24px;bottom:24px;z-index:20;background:#302849;border:1px solid #8b6cff;border-radius:12px;padding:14px 18px;max-width:380px;box-shadow:0 12px 30px #0008}
    .aura-fields {grid-template-columns:repeat(5,minmax(0,1fr))}
    @media (max-width:1200px) {.aura-model-kpis {grid-template-columns:repeat(2,minmax(0,1fr))}.aura-fields {grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width: 720px) { .aura-model-kpis {grid-template-columns:repeat(2,minmax(0,1fr))} .aura-fields {grid-template-columns:repeat(2,minmax(0,1fr))}  .aura-layout { flex-direction: column; } .aura-sidebar { position:relative;height:auto;width: 100%; flex: none; padding: 18px; gap: 8px; } .aura-sidebar-spacer { display: none; } .aura-content { padding: 26px 18px; } .aura-fields { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); } }
  `}</style>
  )
}

const navButton: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 14px', border: 0, borderRadius: 10, background: 'transparent', color: '#abb5ca', textAlign: 'left', fontSize: 14, cursor: 'pointer' }
const centerStyle: CSSProperties = { minHeight: '100vh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.text, fontFamily: 'Inter, Segoe UI, Arial, sans-serif' }
const eyebrow: CSSProperties = { color: '#ad9bff', fontSize: 13, fontWeight: 650, marginBottom: 10 }
const heading: CSSProperties = { fontSize: 'clamp(26px, 3vw, 38px)', lineHeight: 1.2, letterSpacing: -0.8, margin: '0 0 10px' }
const subtitle: CSSProperties = { color: colors.muted, lineHeight: 1.6, margin: 0, fontSize: 15 }
const labelStyle: CSSProperties = { color: '#b5bfd5', fontSize: 13 }
