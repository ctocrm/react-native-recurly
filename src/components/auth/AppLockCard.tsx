/**
 * Phase A Settings card — manage the app-pass leg from Settings:
 * enable (enroll + one-time phrase), change pass, regenerate phrase,
 * disable. Android-only (CadenceVault native module).
 *
 * The phrase flow here mirrors the gate's (FLAG_SECURE, shown once,
 * verify-back); the phrase exists only in memory during the flow.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import {
  changeAppPass,
  disableAppPass,
  enrollAppPass,
  getVaultMode,
  regenerateRecoveryPhrase,
  setSecureWindow,
  type VaultMode,
} from "@/services/auth/vault";

const PASS_MIN = 8;

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
}) {
  return (
    <View className="mb-3">
      <Text className="text-sm font-sans-medium text-muted-foreground mb-1">
        {props.label}
      </Text>
      <TextInput
        className="auth-input"
        value={props.value}
        onChangeText={props.onChange}
        secureTextEntry={props.secure ?? false}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Row(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      className={`auth-button mb-3 ${props.destructive ? "bg-destructive" : "bg-accent"} ${
        props.disabled ? "opacity-50" : ""
      }`}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <Text className="auth-button-text text-white">{props.label}</Text>
    </Pressable>
  );
}

function PhrasePanel(props: {
  phrase: string[];
  onDone: () => void;
  headline: string;
}) {
  const [checked, setChecked] = useState(false);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const indices = [2, 7, 11]; // fixed spot-check (1-based: 3, 8, 12)

  useEffect(() => {
    setSecureWindow(true);
    return () => setSecureWindow(false);
  }, []);

  const verified = indices.every(
    (wordIndex, i) =>
      answers[i]?.trim().toLowerCase() ===
      props.phrase[wordIndex].toLowerCase(),
  );

  return (
    <View>
      <Text className="text-sm text-muted-foreground mb-2">
        {props.headline}
      </Text>
      <Text className="text-sm text-muted-foreground mb-2">
        Try to commit these words to memory. If you must, write them down — on
        paper, kept somewhere secure. Order and spelling matter.
      </Text>
      <View className="my-3 rounded-xl bg-muted p-4">
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
        Shown only once — it is never stored and cannot be displayed again.
        Screenshots are blocked on this screen; capturing it any other way is
        at your own risk.
      </Text>
      {indices.map((wordIndex, i) => (
        <View key={wordIndex} className="mb-2">
          <Text className="text-sm font-sans-medium text-muted-foreground mb-1">
            Confirm word #{wordIndex + 1}
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
      {error ? (
        <Text className="text-destructive text-sm mb-2">{error}</Text>
      ) : null}
      <Pressable
        className="flex-row items-center mb-3"
        onPress={() => setChecked(!checked)}
      >
        <View
          className={`size-5 mr-2 items-center justify-center rounded border ${
            checked ? "bg-accent border-accent" : "border-input"
          }`}
        >
          {checked ? <Text className="text-white text-xs">✓</Text> : null}
        </View>
        <Text className="text-sm text-primary">I have saved these words</Text>
      </Pressable>
      <Row
        label="Done"
        disabled={!checked}
        onPress={() => {
          if (!verified) {
            setError("One or more confirmation words do not match.");
            return;
          }
          props.onDone();
        }}
      />
    </View>
  );
}

type Flow =
  | "summary"
  | "create"
  | "phrase"
  | "change"
  | "regen-pass"
  | "disable";

export function AppLockCard({ userId }: { userId: string }) {
  const [mode, setMode] = useState<VaultMode>("none");
  const [flow, setFlow] = useState<Flow>("summary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string[]>([]);
  const [pass, setPass] = useState("");
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const refreshMode = async () => setMode(await getVaultMode(userId));

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void refreshMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (Platform.OS !== "android") return null;

  const reset = () => {
    setPass("");
    setOldPass("");
    setNewPass("");
    setConfirmPass("");
    setError(null);
  };

  const finish = async (message: string) => {
    reset();
    await refreshMode();
    setFlow("summary");
    setNotice(message);
  };

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "Something went wrong.");

  const validateNew = (): string | null => {
    if (newPass.length < PASS_MIN) {
      return `Use at least ${PASS_MIN} characters.`;
    }
    if (newPass !== confirmPass) return "The two passwords do not match.";
    return null;
  };

  let body: ReactNode = null;
  if (flow === "summary") {
    body = (
      <View>
        <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
          {mode === "pass"
            ? "App password is ON. The database opens only after the password (or recovery phrase)."
            : mode === "plain"
              ? "App password is OFF. The database opens after your device lock — biometrics or your PIN/pattern."
              : "No database key yet — it is created on first unlock."}
        </Text>
        {notice ? (
          <Text className="text-green-600 text-sm mb-3">{notice}</Text>
        ) : null}
        {mode !== "pass" ? (
          <Row
            label="Enable app password"
            onPress={() => {
              reset();
              setFlow("create");
            }}
          />
        ) : (
          <>
            <Row
              label="Change app password"
              onPress={() => {
                reset();
                setFlow("change");
              }}
            />
            <Row
              label="Regenerate recovery phrase"
              onPress={() => {
                reset();
                setFlow("regen-pass");
              }}
            />
            <Row
              label="Disable app password"
              destructive
              onPress={() => {
                reset();
                setFlow("disable");
              }}
            />
          </>
        )}
      </View>
    );
  } else if (flow === "create") {
    body = (
      <View>
        <Field label="App password" value={pass} onChange={setPass} secure />
        <Field
          label="Confirm password"
          value={confirmPass}
          onChange={setConfirmPass}
          secure
        />
        <Row
          label={busy ? "Creating..." : "Create"}
          disabled={busy}
          onPress={async () => {
            if (pass.length < PASS_MIN) {
              setError(`Use at least ${PASS_MIN} characters.`);
              return;
            }
            setBusy(true);
            setError(null);
            try {
              setPhrase(await enrollAppPass(userId, pass));
              setFlow("phrase");
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    );
  } else if (flow === "phrase") {
    body = (
      <PhrasePanel
        phrase={phrase}
        headline="Save this phrase now — it is your only recovery path if you forget the app password."
        onDone={() => void finish("App password enabled. Phrase verified.")}
      />
    );
  } else if (flow === "change") {
    body = (
      <View>
        <Field label="Current password" value={oldPass} onChange={setOldPass} secure />
        <Field label="New password" value={newPass} onChange={setNewPass} secure />
        <Field
          label="Confirm new password"
          value={confirmPass}
          onChange={setConfirmPass}
          secure
        />
        <Row
          label={busy ? "Saving..." : "Save new password"}
          disabled={busy}
          onPress={async () => {
            const problem = validateNew();
            if (problem) {
              setError(problem);
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await changeAppPass(oldPass, newPass);
              await finish("App password changed.");
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    );
  } else if (flow === "regen-pass") {
    body = (
      <View>
        <Text className="text-sm text-muted-foreground mb-3">
          Regenerating invalidates your current phrase. Enter your app password
          to continue.
        </Text>
        <Field label="App password" value={pass} onChange={setPass} secure />
        <Row
          label={busy ? "Generating..." : "Generate new phrase"}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              setPhrase(await regenerateRecoveryPhrase(pass));
              setFlow("phrase");
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    );
  } else if (flow === "disable") {
    body = (
      <View>
        <Text className="text-sm text-muted-foreground mb-3">
          The database will open with your device lock (biometrics or PIN)
          instead. Your recovery phrase is also removed.
        </Text>
        <Field label="App password" value={pass} onChange={setPass} secure />
        <Row
          label={busy ? "Disabling..." : "Disable app password"}
          destructive
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await disableAppPass(userId, pass);
              await finish("App password disabled.");
            } catch (e) {
              fail(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    );
  }
  // PART3_MARKER

  return (
    <View className="auth-card mb-5">
      <Text className="text-base font-sans-semibold text-primary mb-3">
        App Lock
      </Text>
      {error ? (
        <Text className="text-destructive text-sm mb-2">{error}</Text>
      ) : null}
      {body}
      {flow !== "summary" ? (
        <Pressable
          onPress={() => {
            reset();
            setFlow("summary");
          }}
        >
          <Text className="text-sm text-muted-foreground text-center underline">
            Cancel
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

