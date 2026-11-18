import { useId, useLayoutEffect, useRef, type JSX, type ReactNode } from 'react'
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  MotionConfig,
  useReducedMotion,
  type HTMLMotionProps
} from 'motion/react'
import * as m from 'motion/react-m'
import { X } from 'lucide-react'

export function MotionProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  )
}

export function SectionTransition({
  sectionKey,
  children
}: {
  sectionKey: string
  children: ReactNode
}): JSX.Element {
  const reduce = useReducedMotion()
  return (
    <m.div
      key={sectionKey}
      className="aura-section-transition"
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.19, ease: 'easeOut' }}
    >
      {children}
    </m.div>
  )
}

export function MotionCard({
  children,
  className,
  delay = 0,
  reveal = false
}: {
  children: ReactNode
  className?: string
  delay?: number
  reveal?: boolean
}): JSX.Element {
  const reduce = useReducedMotion()
  const visible = { opacity: 1, y: 0 }
  return (
    <m.div
      className={className}
      initial={reduce ? false : { opacity: 0.68, y: 5 }}
      animate={reduce || !reveal ? visible : undefined}
      whileInView={!reduce && reveal ? visible : undefined}
      viewport={{ once: true, amount: 'some' }}
      transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : delay, ease: 'easeOut' }}
    >
      {children}
    </m.div>
  )
}

export function MotionButton({
  type = 'button',
  disabled,
  ...props
}: HTMLMotionProps<'button'>): JSX.Element {
  const reduce = useReducedMotion()
  return (
    <m.button
      {...props}
      type={type}
      disabled={disabled}
      whileHover={reduce || disabled ? undefined : { y: -1 }}
      whileTap={reduce || disabled ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
    />
  )
}

export function MotionDialog({
  open,
  onClose,
  title,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const reduce = useReducedMotion()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (open && dialog && !dialog.open) dialog.showModal()
    if (!open && reduce && dialog?.open) dialog.close()
  }, [open, reduce])

  return (
    <dialog
      ref={dialogRef}
      className="aura-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (open) onClose()
      }}
    >
      <div inert={!open}>
        <AnimatePresence
          onExitComplete={() => {
            if (!open) dialogRef.current?.close()
          }}
        >
          {open && (
            <m.div
              className="aura-dialog-panel"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: 4 }}
              transition={{ duration: reduce ? 0 : 0.16, ease: 'easeOut' }}
            >
              <header className="aura-dialog-heading">
                <h2 id={titleId}>{title}</h2>
                <MotionButton
                  className="aura-button aura-icon-button"
                  aria-label="Закрыть"
                  onClick={onClose}
                >
                  <X aria-hidden="true" size={18} />
                </MotionButton>
              </header>
              {children}
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </dialog>
  )
}
