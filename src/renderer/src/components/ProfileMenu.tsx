import { useEffect, useId, useRef, useState, type ChangeEvent, type JSX } from 'react'
import { ChevronDown, ImagePlus, LogOut, Settings, Trash2 } from 'lucide-react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { avatarDataUrl, prepareAvatar } from '../lib/avatar-image'
import { createAvatarStorage, type AvatarScope } from '../lib/avatar-storage'
import { MotionButton, MotionDialog } from './WorkspaceMotion'
import '../assets/profile.css'

const storage =
  import.meta.env.VITE_AVATAR_STORAGE_ENABLED === 'true'
    ? createAvatarStorage(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
    : null

type Preview = { image: Blob; source: string }

type ProfileMenuProps = {
  scope: AvatarScope
  name: string
  role: string
  avatar: string | null
  onAvatarChange: (avatar: string | null) => void
  onLogout: () => void
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0] ?? '')
      .join('')
      .toLocaleUpperCase('ru-RU') || '?'
  )
}

export function UserAvatar({ name, avatar }: { name: string; avatar: string | null }): JSX.Element {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return (
    <span className="avatar aura-user-avatar" aria-hidden="true">
      {avatar && avatar !== failedSource ? (
        <img src={avatar} alt="" decoding="async" onError={() => setFailedSource(avatar)} />
      ) : (
        initials(name)
      )}
    </span>
  )
}

export function ProfileMenu({
  scope,
  name,
  role,
  avatar,
  onAvatarChange,
  onLogout
}: ProfileMenuProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const firstOption = useRef<HTMLButtonElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const remoteRevision = useRef(0)
  const pending = useRef(false)
  const reduce = useReducedMotion()
  const menuId = useId()
  const errorId = useId()
  const [menu, setMenu] = useState(false)
  const [settings, setSettings] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const signal = scope.controller.signal

  useEffect(() => {
    if (!storage) return
    let active = true
    const revision = remoteRevision.current
    void storage
      .load(scope)
      .then(async (image) => {
        const source = image ? await avatarDataUrl(image) : null
        if (active && !signal.aborted && revision === remoteRevision.current) onAvatarChange(source)
      })
      .catch(() => {
        if (active && !signal.aborted && revision === remoteRevision.current)
          setLoadError('Не удалось загрузить аватарку из хранилища.')
      })
    return () => {
      active = false
    }
  }, [scope, signal, onAvatarChange])

  useEffect(() => {
    if (!menu) return
    firstOption.current?.focus()
    function outside(event: PointerEvent): void {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])

  function openSettings(): void {
    setMenu(false)
    trigger.current?.focus()
    setError('')
    setSettings(true)
  }

  function closeSettings(): void {
    selection.current += 1
    setPreparing(false)
    setSettings(false)
    setPreview(null)
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || signal.aborted) return
    const selected = ++selection.current
    setError('')
    setStatus('')
    setPreview(null)
    setPreparing(true)
    try {
      const image = await prepareAvatar(file)
      if (selected !== selection.current || signal.aborted) return
      const source = await avatarDataUrl(image)
      if (selected === selection.current && !signal.aborted) setPreview({ image, source })
    } catch (cause) {
      if (selected === selection.current && !signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Не удалось подготовить изображение.')
      }
    } finally {
      if (selected === selection.current && !signal.aborted) setPreparing(false)
    }
  }

  async function updateAvatar(action: 'save' | 'remove'): Promise<void> {
    if (!storage || signal.aborted || pending.current || (action === 'save' && !preview)) return
    if (action === 'remove' && !window.confirm('Удалить аватарку профиля?')) return
    if (signal.aborted) return
    pending.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try {
      if (action === 'save' && preview) {
        await storage.save(scope, preview.image)
        if (signal.aborted) return
        remoteRevision.current += 1
        onAvatarChange(preview.source)
        setStatus('Аватарка сохранена.')
      } else {
        await storage.remove(scope)
        if (signal.aborted) return
        remoteRevision.current += 1
        onAvatarChange(null)
        setStatus('Аватарка удалена.')
      }
      setPreview(null)
      setLoadError('')
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Не удалось обновить аватарку.')
    } finally {
      pending.current = false
      if (!signal.aborted) setBusy(false)
    }
  }

  return (
    <div
      ref={root}
      className="aura-profile"
      onKeyDown={(event) => {
        if (menu && event.key === 'Escape') {
          event.stopPropagation()
          setMenu(false)
          trigger.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (
          menu &&
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setMenu(false)
      }}
    >
      <MotionButton
        ref={trigger}
        className="topbar-profile aura-profile-trigger"
        aria-label="Меню профиля"
        aria-expanded={menu}
        aria-controls={menuId}
        title={name}
        onClick={() => setMenu((open) => !open)}
      >
        <UserAvatar name={name} avatar={avatar} />
        <span className="account-label">
          <strong>{name}</strong>
          <span>{role}</span>
        </span>
        <ChevronDown className="aura-profile-chevron" size={14} aria-hidden="true" />
      </MotionButton>
      <div id={menuId} className="aura-profile-anchor" inert={!menu}>
        <AnimatePresence>
          {menu && (
            <m.div
              className="aura-profile-popover"
              initial={reduce ? false : { opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -3 }}
              transition={{ duration: reduce ? 0 : 0.15 }}
            >
              <button ref={firstOption} type="button" onClick={openSettings}>
                <Settings size={16} aria-hidden="true" /> Настройки профиля
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  onLogout()
                }}
              >
                <LogOut size={16} aria-hidden="true" /> Выйти
              </button>
            </m.div>
          )}
        </AnimatePresence>
      </div>
      <MotionDialog open={settings} onClose={closeSettings} title="Настройки профиля">
        <div className="aura-profile-settings">
          <div className="aura-avatar-preview">
            <UserAvatar name={name} avatar={preview?.source ?? avatar} />
            <div>
              <strong>{name}</strong>
              <p>{preview ? 'Предпросмотр' : role}</p>
            </div>
          </div>
          <p className="muted">PNG, JPEG или WebP до 5 МБ. Изображение будет обрезано по центру.</p>
          {!storage && (
            <p className="aura-profile-notice">
              Предпросмотр доступен. Сохранение между устройствами станет доступно после настройки
              хранилища.
            </p>
          )}
          {loadError && (
            <p role="status" className="aura-profile-notice">
              {loadError}
            </p>
          )}
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Файл аватарки"
            aria-describedby={error ? errorId : undefined}
            hidden
            onChange={(event) => void selectImage(event)}
          />
          {error && (
            <p id={errorId} role="alert" className="aura-profile-error">
              {error}
            </p>
          )}
          {status && (
            <p role="status" className="aura-profile-notice">
              {status}
            </p>
          )}
          <div className="button-group">
            <MotionButton
              className="button button-secondary"
              disabled={busy || preparing}
              onClick={() => picker.current?.click()}
            >
              <ImagePlus size={17} aria-hidden="true" />{' '}
              {preparing
                ? 'Готовим изображение…'
                : avatar || preview
                  ? 'Заменить файл'
                  : 'Выбрать файл'}
            </MotionButton>
            {preview && (
              <MotionButton
                className="button button-primary"
                disabled={!storage || busy}
                onClick={() => void updateAvatar('save')}
              >
                Сохранить
              </MotionButton>
            )}
            {preview && (
              <MotionButton
                className="button button-quiet"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Сбросить
              </MotionButton>
            )}
            {avatar && !preview && (
              <MotionButton
                className="button button-quiet"
                disabled={!storage || busy}
                onClick={() => void updateAvatar('remove')}
              >
                <Trash2 size={16} aria-hidden="true" /> Удалить
              </MotionButton>
            )}
          </div>
          {busy && (
            <p role="status" className="muted">
              Обновляем аватарку…
            </p>
          )}
        </div>
      </MotionDialog>
    </div>
  )
}
