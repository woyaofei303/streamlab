"use client"

/** React Hook Form + Zod 演示登录/注册/找回。固定验证码 246810，不发送邮件、不创建真实登录会话。 */
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight, Check, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import type { User } from "@/lib/types"
import { useApp } from "./providers"
import { Avatar, Button, inputClass, Modal } from "./ui/primitives"

const schema = z.object({
  email: z.email(),
  name: z.string().max(40),
  code: z.string(),
})
type Fields = z.infer<typeof schema>
export function AuthDialog() {
  const { authOpen, setAuthOpen, state, login, act, t, toast } = useApp()
  const [mode, setMode] = useState<"login" | "register" | "reset">("login"),
    [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Fields>({
    resolver: zodResolver(schema),
    defaultValues: { email: "alex@example.test", name: "", code: "" },
  })
  const submit = handleSubmit(async (values) => {
    try {
      if (values.code !== "246810") {
        toast(t("本地演示验证码为 246810", "Demo verification code: 246810"))
        return
      }
      if (mode === "reset") {
        toast(
          t(
            "验证成功。演示账号使用验证码登录，无需设置密码。",
            "Verified. Demo accounts use verification codes.",
          ),
        )
        setMode("login")
        return
      }
      if (mode === "register") {
        if (!values.name.trim()) {
          toast(t("请填写昵称", "Please enter a name"))
          return
        }
        const u = (await act({
          type: "register",
          email: values.email,
          name: values.name,
        })) as User
        login(u.id)
      } else {
        const u = state?.users.find((u) => u.email === values.email)
        if (!u) {
          toast(
            t("账号不存在，请先注册", "Account not found. Please register."),
          )
          return
        }
        login(u.id)
      }
    } catch {}
  })
  return (
    <Modal
      open={authOpen}
      onOpenChange={setAuthOpen}
      title={t(
        mode === "register"
          ? "找到你的同频伙伴"
          : mode === "reset"
            ? "找回你的账号"
            : "欢迎回到 StreamLab",
        mode === "register"
          ? "Find your people"
          : mode === "reset"
            ? "Recover your account"
            : "Welcome to StreamLab",
      )}
      description={t(
        "本地演示账号，不会发送邮件或连接真实账户。",
        "Local demo accounts. No email is sent or real account connected.",
      )}
    >
      <div className="mb-6 grid grid-cols-3 gap-2">
        {state?.users.slice(0, 3).map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => login(u.id)}
            className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] p-3 hover:border-violet-400"
          >
            <Avatar name={u.name} />
            <span className="text-xs font-semibold">{u.name}</span>
            <span className="text-[10px] text-zinc-500">
              {u.role === "creator"
                ? t("主播", "Creator")
                : u.role === "moderator"
                  ? t("房管", "Moderator")
                  : t("观众", "Viewer")}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-5 flex items-center gap-3 text-[11px] text-zinc-500">
        <span className="h-px flex-1 bg-white/10" />
        {t("或使用邮箱验证码", "OR CONTINUE WITH EMAIL")}
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={submit} className="space-y-4">
        {mode === "register" && (
          <label className="block text-sm">
            {t("昵称", "Name")}
            <input
              {...register("name")}
              className={`${inputClass} mt-2`}
              autoComplete="nickname"
            />
          </label>
        )}
        <label className="block text-sm">
          {t("邮箱", "Email")}
          <input
            {...register("email")}
            className={`${inputClass} mt-2`}
            type="email"
            autoComplete="email"
          />
          {errors.email && (
            <span className="text-xs text-red-400">
              {t("请输入有效邮箱", "Enter a valid email")}
            </span>
          )}
        </label>
        <label className="block text-sm">
          {t("验证码", "Verification code")}
          <div className="mt-2 flex gap-2">
            <input
              {...register("code")}
              className={inputClass}
              placeholder="246810"
              inputMode="numeric"
            />
            <Button variant="secondary" onClick={() => setSent(true)}>
              {sent ? <Check size={16} /> : t("获取验证码", "Get code")}
            </Button>
          </div>
        </label>
        {sent && (
          <p className="text-xs text-violet-300">
            {t("演示验证码：246810", "Demo code: 246810")}
          </p>
        )}
        <Button className="w-full" type="submit" busy={isSubmitting}>
          {t(
            mode === "register"
              ? "创建账号"
              : mode === "reset"
                ? "验证账号"
                : "登录",
            mode === "register"
              ? "Create account"
              : mode === "reset"
                ? "Verify"
                : "Sign in",
          )}
          <ArrowRight size={16} />
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-xs">
        <button
          type="button"
          className="text-violet-300"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
        >
          {t(
            mode === "register" ? "已有账号？登录" : "没有账号？注册",
            mode === "register"
              ? "Already a member? Sign in"
              : "New here? Sign up",
          )}
        </button>
        <button
          type="button"
          className="text-zinc-500"
          onClick={() => setMode("reset")}
        >
          {t("找回账号", "Recover account")}
        </button>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
        <ShieldCheck size={13} />
        {t("演示数据仅保存在此浏览器", "Demo data stays in this browser")}
      </p>
    </Modal>
  )
}
