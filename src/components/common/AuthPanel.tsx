import { useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Brand } from "./Brand";
import { useAuth } from "../../contexts/AuthContext";
import type { Role } from "../../types/commerce";

export function AuthPanel({ role, onBack }: { role: Role; onBack: () => void }) {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const error =
      mode === "forgot"
        ? await requestPasswordReset(email)
        : mode === "signup"
          ? await signUp(String(form.get("name") ?? ""), email, password)
          : await signIn(email, password);
    setBusy(false);
    setMessage(
      error ??
        (mode === "forgot"
          ? "Check your email for a secure password-reset link."
          : mode === "signup"
            ? "Check your email to verify your DIANE account."
            : "Signed in successfully."),
    );
  };

  return (
    <main className="auth-shell">
      <section className="auth-editorial">
        <button className="text-button text-button--light" onClick={onBack}>
          <ArrowLeft size={16} /> Back to portals
        </button>
        <Brand light />
        <div>
          <span className="eyebrow">DIANE PRIVATE ACCESS</span>
          <h1>
            {role === "customer" ? "Your wardrobe, thoughtfully curated." : `${role} workspace`}
          </h1>
          <p>One secure account across shopping, delivery, and store operations.</p>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="eyebrow">{role.toUpperCase()} ACCESS</span>
          <h2>
            {mode === "signin"
              ? "Welcome back"
              : mode === "signup"
                ? "Create your account"
                : "Reset password"}
          </h2>
          <p>
            {mode === "forgot"
              ? "We will email a secure recovery link to your registered address."
              : `Continue to the DIANE ${role} experience.`}
          </p>
          {mode === "signup" && role === "customer" && (
            <label>
              Full name
              <input name="name" autoComplete="name" required />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          {mode !== "forgot" && (
            <label>
              Password
              <span className="password-input">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          )}
          {mode === "signin" && role === "customer" && (
            <button
              type="button"
              className="text-button forgot-button"
              onClick={() => setMode("forgot")}
            >
              Forgot password?
            </button>
          )}
          {message && <div className="form-message">{message}</div>}
          <button className="button button--dark button--full" disabled={busy}>
            {busy
              ? "PLEASE WAIT…"
              : mode === "signin"
                ? "SIGN IN"
                : mode === "signup"
                  ? "CREATE ACCOUNT"
                  : "SEND RESET LINK"}
          </button>
          {role === "customer" && mode !== "forgot" && (
            <button
              type="button"
              className="text-button auth-toggle"
              onClick={() => {
                setMode((value) => (value === "signin" ? "signup" : "signin"));
                setMessage("");
              }}
            >
              {mode === "signin"
                ? "New to DIANE? Create an account"
                : "Already registered? Sign in"}
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              className="text-button auth-toggle"
              onClick={() => setMode("signin")}
            >
              Return to sign in
            </button>
          )}
        </form>
      </section>
    </main>
  );
}

export function ResetPasswordPanel() {
  const { updatePassword, signOut } = useAuth();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  return (
    <main className="auth-shell">
      <section className="auth-editorial">
        <Brand light />
        <div>
          <span className="eyebrow">SECURE ACCOUNT RECOVERY</span>
          <h1>Choose a new password.</h1>
          <p>Your recovered Supabase session is ready for a secure password update.</p>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const password = String(form.get("password") ?? "");
            const confirmation = String(form.get("confirmation") ?? "");
            if (password !== confirmation) {
              setMessage("Passwords do not match.");
              return;
            }
            setBusy(true);
            const error = await updatePassword(password);
            setMessage(
              error ?? "Your password has been successfully changed. You can now log in using your new password.",
            );
            if (!error) setPasswordUpdated(true);
            setBusy(false);
          }}
        >
          <span className="eyebrow">PASSWORD RESET</span>
          <h2>New password</h2>
          <p>Use at least eight characters and keep your password private.</p>
          <label>
            New password
            <span className="password-input">
              <input
                name="password"
                type={showNewPassword ? "text" : "password"}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                onClick={() => setShowNewPassword((value) => !value)}
              >
                {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <label>
            Confirm password
            <span className="password-input">
              <input
                name="confirmation"
                type={showConfirmation ? "text" : "password"}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"}
                onClick={() => setShowConfirmation((value) => !value)}
              >
                {showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          {message && <div className="form-message">{message}</div>}
          {!passwordUpdated ? (
            <button className="button button--dark button--full" disabled={busy}>
              {busy ? "UPDATING…" : "UPDATE PASSWORD"}
            </button>
          ) : (
            <button
              type="button"
              className="button button--dark button--full"
              onClick={async () => {
                setBusy(true);
                try {
                  await signOut();
                  try {
                    window.localStorage.setItem("diane-last-portal-role", "customer");
                  } catch {
                    // Login navigation should still work if storage is unavailable.
                  }
                  window.location.hash = "/customer";
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Password changed, but sign-out failed. Please return to sign in manually.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {busy ? "PLEASE WAIT…" : "RETURN TO SIGN IN"}
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
