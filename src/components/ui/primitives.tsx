"use client"

/** 共享展示组件：Tailwind 样式 + Radix Dialog 可访问性能力，自建组件而非整套 shadcn/ui。 */
import * as Dialog from "@radix-ui/react-dialog"
import { type ClassValue, clsx } from "clsx"
import { LoaderCircle, X } from "lucide-react"
import Image from "next/image"
import { useRef } from "react"
import { twMerge } from "tailwind-merge"
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
export function Button({
  className,
  variant = "primary",
  busy,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  busy?: boolean
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary"
          ? "bg-violet-500 text-white hover:bg-violet-400"
          : variant === "secondary"
            ? "bg-white/10 text-zinc-100 hover:bg-white/15"
            : variant === "danger"
              ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : "text-zinc-400 hover:bg-white/5 hover:text-white",
        className,
      )}
    >
      {busy && <LoaderCircle size={16} className="animate-spin" />}
      {children}
    </button>
  )
}
export const inputClass =
  "w-full rounded-lg border border-white/10 bg-[#111114] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-400 disabled:opacity-50"
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
}) {
  // 弹窗由外部 state 打开，没有 Dialog.Trigger；手动记住触发元素，让 Escape/关闭后焦点回到原处。
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current?.isConnected) opener.current.focus()
          }}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(94vw,460px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/10 bg-[#1b1b20] p-6 shadow-2xl"
        >
          <Dialog.Title className="pr-8 text-xl font-bold">
            {title}
          </Dialog.Title>
          <Dialog.Description
            className={cn(
              "mt-2 text-sm leading-6 text-zinc-400",
              !description && "sr-only",
            )}
          >
            {description ?? title}
          </Dialog.Description>
          <Dialog.Close
            className="absolute right-4 top-4 rounded-md p-1.5 text-zinc-400 hover:bg-white/10"
            aria-label="Close"
          >
            <X size={18} />
          </Dialog.Close>
          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function Avatar({
  name,
  color = "#a78bfa",
  src,
  size = "md",
}: {
  name: string
  color?: string
  src?: string
  size?: "sm" | "md" | "lg"
}) {
  return (
    <span
      style={{ backgroundColor: `${color}20`, color }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 font-bold",
        size === "sm"
          ? "size-8 text-xs"
          : size === "lg"
            ? "size-16 text-2xl"
            : "size-10 text-sm",
      )}
    >
      {src ? (
        <Image
          src={src}
          width={64}
          height={64}
          alt={name}
          className="size-full rounded-full object-cover"
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-6 py-16 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
        {description}
      </p>
      <div className="mt-5">{children}</div>
    </div>
  )
}
export function Badge({
  children,
  live = false,
}: {
  children: React.ReactNode
  live?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-bold",
        live ? "bg-rose-500 text-white" : "bg-white/8 text-zinc-400",
      )}
    >
      {live && <span className="size-1.5 rounded-full bg-white" />}
      {children}
    </span>
  )
}
