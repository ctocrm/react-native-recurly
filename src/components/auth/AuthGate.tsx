/**
 * Phase A gate UI — the full-screen factor challenge rendered by
 * DatabaseProvider instead of app children while the vault is locked.
 *
 * Routes (resolveGate): create-pass (foot-down; also the plain->pass
 * migration) -> phrase-display -> verify-back; enter-pass (with the
 * recovery escape hatch); device-prompt (OS decides biometry-vs-PIN).
 *
 * The recovery phrase exists ONLY in memory during this flow — shown once
 * under FLAG_SECURE, never persisted, logged, or re-displayed.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";
import { styled } from "nativewind";

import { PasswordInput } from "@/components/auth/PasswordInput";

import {
  confirmDeviceCredential,
  enrollAppPass,
  setAppPassFromKey,
  setSecureWindow,
  unlockWithPass,
  unlockWithPhrase,
  validateRecoveryPhrase,
} from "@/services/auth/vault";
import { resolveGate, type GateRoute } from "@/services/auth/authGate";

const SafeAreaView = styled(RNSafeAreaView);

type GateView =
  | GateRoute
  | "phrase-display"
  | "verify-back"
  | "recovery-entry"
  | "recovery-new-pass";

const PASS_MIN = 8;

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text className="text-destructive text-sm mt-2">{message}</Text>;
}

function PassField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-sans-medium text-muted-foreground mb-1">
        {props.label}
      </Text>
      <PasswordInput
        value={props.value}
        onChange={props.onChange}
        autoFocus={props.autoFocus ?? false}
      />
    </View>
  );
}

function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      className={`auth-button ${props.disabled ? "auth-button-disabled" : ""}`}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <Text className="auth-button-text">{props.label}</Text>
    </Pressable>
  );
}

function LinkButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable className="mt-4" onPress={props.onPress}>
      <Text className="text-sm text-muted-foreground text-center underline">
        {props.label}
      </Text>
    </Pressable>
  );
}

function CreatePassView(props: {
  userId: string;
  onEnrolled: (pass: string, phrase: string[]) => void;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (pass.length < PASS_MIN) {
      setError(`Use at least ${PASS_MIN} characters.`);
      return;
    }
    if (pass !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const phrase = await enrollAppPass(props.userId, pass);
      props.onEnrolled(pass, phrase);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-1">
        Create an app password
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        This device has no screen lock, so Cadence needs its own password
        before it can open your data. You will also get a recovery phrase.
      </Text>
      <PassField label="App password" value={pass} onChange={setPass} autoFocus />
      <PassField label="Confirm password" value={confirm} onChange={setConfirm} />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Creating..." : "Create password"}
        onPress={submit}
        disabled={busy}
      />
    </View>
  );
}

const PHRASE_COPY = [
  "These 12 words are the only way to recover your data if you forget your app password.",
  "Try to commit them to memory. If you must, write them down — on paper, kept somewhere secure. Order and spelling matter.",
];

function PhraseDisplayView(props: {
  phrase: string[];
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState(false);

  // FLAG_SECURE for exactly this flow — no screenshots, no recents thumb.
  useEffect(() => {
    setSecureWindow(true);
    return () => setSecureWindow(false);
  }, []);

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-2">
        Your recovery phrase
      </Text>
      {PHRASE_COPY.map((line) => (
        <Text key={line} className="text-sm text-muted-foreground mb-2">
          {line}
        </Text>
      ))}
      <View className="my-4 rounded-xl bg-muted p-4">
        {Array.from({ length: 4 }, (_, row) => (
          <View key={row} className="flex-row mb-1">
            {props.phrase.slice(row * 3, row * 3 + 3).map((word, col) => (
              <Text
                key={word + col}
                className="flex-1 text-base text-primary font-sans-medium"
              >
                {row * 3 + col + 1}. {word}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <Text className="text-xs text-muted-foreground mb-3">
        This phrase is shown only once and cannot be recovered or re-displayed.
        If you lose both your password and these words, everything scans again
        from scratch as a new device. Screenshots are blocked on this screen —
        capturing it any other way is at your own risk.
      </Text>
      <Pressable
        className="flex-row items-center mb-4"
        onPress={() => setChecked(!checked)}
      >
        <View
          className={`size-5 mr-2 items-center justify-center rounded border ${
            checked ? "bg-accent border-accent" : "border-input"
          }`}
        >
          {checked ? <Text className="text-white text-xs">✓</Text> : null}
        </View>
        <Text className="text-sm text-primary">
          I have saved these words
        </Text>
      </Pressable>
      <PrimaryButton
        label="Continue"
        onPress={props.onSaved}
        disabled={!checked}
      />
    </View>
  );
}

function VerifyBackView(props: {
  phrase: string[];
  onVerified: () => void;
  onBack: () => void;
}) {
  const [indices] = useState(() => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for (let i = all.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, 3).sort((a, b) => a - b);
  });
  const [answers, setAnswers] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const ok = indices.every(
      (wordIndex, i) =>
        answers[i]?.trim().toLowerCase() ===
        props.phrase[wordIndex].toLowerCase(),
    );
    if (!ok) {
      setError("One or more words do not match. Check your notes and try again.");
      return;
    }
    props.onVerified();
  };

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-2">
        Confirm your phrase
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Enter these words from your phrase to confirm you have saved it.
      </Text>
      {indices.map((wordIndex, i) => (
        <View key={wordIndex} className="mb-3">
          <Text className="text-sm font-sans-medium text-muted-foreground mb-1">
            Word #{wordIndex + 1}
          </Text>
          <TextInput
            className="auth-input"
            value={answers[i]}
            onChangeText={(v) =>
              setAnswers(answers.map((a, j) => (j === i ? v : a)))
            }
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ))}
      <ErrorText message={error} />
      <PrimaryButton label="Verify" onPress={submit} />
      <LinkButton label="Show the phrase again" onPress={props.onBack} />
    </View>
  );
}

function EnterPassView(props: {
  onUnlocked: (passphrase: string) => void;
  onForgot: () => void;
}) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !pass) return;
    setBusy(true);
    setError(null);
    try {
      const passphrase = await unlockWithPass(pass);
      props.onUnlocked(passphrase);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "WRONG_PASS"
          ? "Wrong password."
          : "Unlock failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-1">
        Unlock Cadence
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Enter your app password.
      </Text>
      <PassField label="App password" value={pass} onChange={setPass} autoFocus />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Unlocking..." : "Unlock"}
        onPress={submit}
        disabled={busy}
      />
      <LinkButton label="Forgot password?" onPress={props.onForgot} />
    </View>
  );
}

function RecoveryEntryView(props: {
  onRecovered: (passphrase: string) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      const valid = await validateRecoveryPhrase(words);
      if (!valid) {
        setError("These 12 words are not a valid phrase. Check order and spelling.");
        return;
      }
      const passphrase = await unlockWithPhrase(words);
      props.onRecovered(passphrase);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "WRONG_PHRASE"
          ? "That phrase does not match this device."
          : "Recovery failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-1">
        Recover with your phrase
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Enter your 12 recovery words, in order, separated by spaces.
      </Text>
      <TextInput
        className="auth-input"
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={3}
      />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Checking..." : "Recover"}
        onPress={submit}
        disabled={busy}
      />
      <LinkButton label="Back to password" onPress={props.onBack} />
    </View>
  );
}

function RecoveryNewPassView(props: {
  onSet: (newPass: string) => void;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (pass.length < PASS_MIN) {
      setError(`Use at least ${PASS_MIN} characters.`);
      return;
    }
    if (pass !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await props.onSet(pass);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-1">
        Set a new app password
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Your phrase was verified. Choose a new app password for next time.
      </Text>
      <PassField label="New app password" value={pass} onChange={setPass} autoFocus />
      <PassField label="Confirm new password" value={confirm} onChange={setConfirm} />
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Saving..." : "Save and unlock"}
        onPress={submit}
        disabled={busy}
      />
    </View>
  );
}

function DevicePromptView(props: { onUnlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false);

  const prompt = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await confirmDeviceCredential(
        "Unlock Cadence",
        "Confirm it's you to open your subscriptions.",
      );
      if (ok) props.onUnlocked();
      else setError("Device unlock was cancelled. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Device unlock failed.");
    } finally {
      setBusy(false);
    }
  };

  // Auto-fire exactly once per mount; retries are user-initiated.
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void prompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View className="auth-card p-6">
      <Text className="text-lg font-sans-bold text-primary mb-1">
        Unlock Cadence
      </Text>
      <Text className="text-sm text-muted-foreground mb-4">
        Confirm it&apos;s you with your device lock — biometrics or your
        PIN/pattern, whichever you use on this phone.
      </Text>
      <ErrorText message={error} />
      <PrimaryButton
        label={busy ? "Waiting for device unlock..." : "Use device lock"}
        onPress={prompt}
        disabled={busy}
      />
    </View>
  );
}

/**
 * The gate itself: resolves the route once per mount, owns the in-memory
 * flow state (phrase / recovered key never leave this component's
 * lifetime), and calls onUnlocked exactly once, at the end.
 */
export function AuthGate(props: {
  userId: string;
  onUnlocked: (passphrase?: string) => void;
}) {
  const [route, setRoute] = useState<GateRoute | null>(null);
  const [view, setView] = useState<GateView | null>(null);
  const phraseRef = useRef<string[] | null>(null);
  const passRef = useRef<string | null>(null);
  const recoveredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getVaultMode, isDeviceSecure } = await import(
        "@/services/auth/vault"
      );
      const mode = await getVaultMode(props.userId);
      const secure = await isDeviceSecure();
      if (cancelled) return;
      const resolved = resolveGate(mode, secure);
      setRoute(resolved);
      setView(resolved);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (route === null || view === null) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-muted-foreground">Checking app lock…</Text>
        </View>
      </SafeAreaView>
    );
  }

  let content: ReactNode;
  switch (view) {
    case "create-pass":
      content = (
        <CreatePassView
          userId={props.userId}
          onEnrolled={(pass, phrase) => {
            passRef.current = pass;
            phraseRef.current = phrase;
            setView("phrase-display");
          }}
        />
      );
      break;
    case "phrase-display":
      content = (
        <PhraseDisplayView
          phrase={phraseRef.current ?? []}
          onSaved={() => setView("verify-back")}
        />
      );
      break;
    case "verify-back":
      content = (
        <VerifyBackView
          phrase={phraseRef.current ?? []}
          onBack={() => setView("phrase-display")}
          onVerified={async () => {
            const pass = passRef.current;
            if (!pass) return;
            const passphrase = await unlockWithPass(pass);
            props.onUnlocked(passphrase);
          }}
        />
      );
      break;
    case "enter-pass":
      content = (
        <EnterPassView
          onUnlocked={(passphrase) => props.onUnlocked(passphrase)}
          onForgot={() => setView("recovery-entry")}
        />
      );
      break;
    case "recovery-entry":
      content = (
        <RecoveryEntryView
          onBack={() => setView(route)}
          onRecovered={(passphrase) => {
            recoveredKeyRef.current = passphrase;
            setView("recovery-new-pass");
          }}
        />
      );
      break;
    case "recovery-new-pass":
      content = (
        <RecoveryNewPassView
          onSet={async (newPass) => {
            const key = recoveredKeyRef.current;
            if (!key) return;
            await setAppPassFromKey(key, newPass);
            props.onUnlocked(key);
          }}
        />
      );
      break;
    case "device-prompt":
      content = <DevicePromptView onUnlocked={() => props.onUnlocked()} />;
      break;
    default:
      content = null;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <View className="flex-1 justify-center px-6">{content}</View>
    </SafeAreaView>
  );
}




