import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import * as api from "@/lib/api";
import {
  checkPassword,
  nicknamePattern,
  passwordPattern,
  usernamePattern,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RuleChecklist } from "@/components/RuleChecklist";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  // Nickname mirrors username until the user edits nickname themselves — a
  // username char that's illegal in a nickname (e.g. '-') just leaves the
  // mirrored nickname invalid; the nickname's own rule feedback covers that.
  const [nicknameTouched, setNicknameTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  function onUsernameChange(value: string) {
    setUsername(value);
    if (!nicknameTouched) setNickname(value);
  }

  function onNicknameChange(value: string) {
    setNicknameTouched(true);
    setNickname(value);
  }

  const usernameOk = username.length === 0 || usernamePattern.test(username);
  const nicknameOk = nickname.length === 0 || nicknamePattern.test(nickname);
  const pw = checkPassword(password);
  const passwordOk = password.length === 0 || passwordPattern.test(password);
  const passwordsMatch =
    confirmPassword.length === 0 || password === confirmPassword;

  const canSubmit =
    usernamePattern.test(username) &&
    nicknamePattern.test(nickname) &&
    passwordPattern.test(password) &&
    password === confirmPassword &&
    !!email &&
    !!emailCode;

  async function onSendCode() {
    setError(null);
    setSendingCode(true);
    try {
      await api.sendEmailVerifyCode(email);
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to send the code");
    } finally {
      setSendingCode(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ username, nickname, password, email, emailCode });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "register failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">register</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                autoComplete="username"
                aria-invalid={!usernameOk}
                required
              />
              {username.length > 0 && !usernameOk && (
                <p className="text-destructive text-xs">
                  4-32 chars: letters, numbers, underscores, hyphens
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nickname">nickname</Label>
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => onNicknameChange(e.target.value)}
                aria-invalid={!nicknameOk}
                required
              />
              {nickname.length > 0 && !nicknameOk && (
                <p className="text-destructive text-xs">
                  1-16 chars: letters, numbers, underscores, Chinese characters
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={!passwordOk}
                required
              />
              {password.length > 0 && (
                <RuleChecklist
                  items={[
                    { label: "at least 8 characters", ok: pw.length },
                    { label: "at least 1 letter", ok: pw.letter },
                    { label: "at least 1 digit", ok: pw.digit },
                    { label: "at least 1 special character", ok: pw.special },
                  ]}
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={!passwordsMatch}
                required
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <p className="text-destructive text-xs">
                  passwords do not match
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">email</Label>
              <div className="flex gap-2">
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!email || sendingCode}
                  onClick={onSendCode}
                >
                  {codeSent ? "resend" : sendingCode ? "sending…" : "send code"}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emailCode">email code</Label>
              <Input
                id="emailCode"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                required
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? "creating account…" : "create account"}
            </Button>
            <p className="text-muted-foreground text-center text-sm">
              already have an account?{" "}
              <Link
                to="/login"
                className="text-primary underline underline-offset-4"
              >
                sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
