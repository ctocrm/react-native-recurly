import { useSubscriptions } from "@/context/SubscriptionContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import {
  MAIL_PROVIDER_CATALOG,
  importFromConnectedMailboxes,
  type MailProviderId,
} from "@/services/emailscan";
import { listMailboxesAsync } from "@/services/emailscan/persist";
import {
  connectImapAndRecord,
  connectOAuthAndRecord,
  connectPasswordMailAndRecord,
  disconnectMailbox,
  oauthClientId,
} from "@/services/emailscan/providers";
import { useUser } from "@clerk/expo";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

function mailboxLabel(mailboxId: string, providerId: MailProviderId): string {
  const row = MAIL_PROVIDER_CATALOG.find((r) => r.id === providerId);
  const hint = mailboxId.includes(":")
    ? mailboxId.slice(mailboxId.indexOf(":") + 1)
    : mailboxId;
  return row ? `${row.label} · ${hint}` : hint;
}

export default function EmailScanSection({
  openAddOnMount = false,
}: {
  openAddOnMount?: boolean;
}) {
  const { sheetPadding } = useBottomClearance();
  const { user } = useUser();
  const { subscriptions, addSubscription, deleteSubscription } =
    useSubscriptions();
  const userId = user?.id || "anonymous";

  const [boxes, setBoxes] = useState<
    { mailboxId: string; providerId: MailProviderId }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(openAddOnMount);
  const [imapOpen, setImapOpen] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapUser, setImapUser] = useState("");
  const [imapPass, setImapPass] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [passwordKind, setPasswordKind] = useState<"proton" | "tuta" | null>(
    null,
  );
  const [passwordUser, setPasswordUser] = useState("");
  const [passwordPass, setPasswordPass] = useState("");
  const [passwordTotp, setPasswordTotp] = useState("");

  const refreshBoxes = useCallback(async () => {
    try {
      setBoxes(await listMailboxesAsync());
    } catch {
      setBoxes([]);
    }
  }, []);

  useEffect(() => {
    refreshBoxes().catch(() => undefined);
  }, [refreshBoxes]);

  useEffect(() => {
    if (openAddOnMount) setPickerOpen(true);
  }, [openAddOnMount]);

  const addMailbox = async (id: MailProviderId) => {
    setPickerOpen(false);
    if (id === "imap") {
      setImapOpen(true);
      return;
    }
    if (id === "proton" || id === "tuta") {
      setPasswordKind(id);
      return;
    }
    if (!oauthClientId(id)) {
      Alert.alert(
        "Not configured",
        `${id} OAuth needs a public client id. Not connected.`,
      );
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await connectOAuthAndRecord(id, userId);
      await refreshBoxes();
    } catch (error) {
      Alert.alert(
        "Connect",
        error instanceof Error ? error.message : "Connect failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const removeMailbox = (box: {
    mailboxId: string;
    providerId: MailProviderId;
  }) => {
    const associated = subscriptions.filter(
      (s) => s.paymentMethod === box.mailboxId,
    );
    Alert.alert(
      "Remove mailbox",
      associated.length > 0
        ? `Also remove ${associated.length} subscription(s) from this mailbox?`
        : "Disconnect this mailbox?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep subscriptions",
          onPress: () => {
            disconnectMailbox(box.mailboxId, box.providerId)
              .then(refreshBoxes)
              .catch((error) =>
                Alert.alert(
                  "Remove",
                  error instanceof Error ? error.message : "Failed",
                ),
              );
          },
        },
        ...(associated.length > 0
          ? [
              {
                text: "Remove subscriptions too",
                style: "destructive" as const,
                onPress: () => {
                  Promise.all(associated.map((s) => deleteSubscription(s.id)))
                    .then(() =>
                      disconnectMailbox(box.mailboxId, box.providerId),
                    )
                    .then(refreshBoxes)
                    .catch((error) =>
                      Alert.alert(
                        "Remove",
                        error instanceof Error ? error.message : "Failed",
                      ),
                    );
                },
              },
            ]
          : [
              {
                text: "Remove",
                style: "destructive" as const,
                onPress: () => {
                  disconnectMailbox(box.mailboxId, box.providerId)
                    .then(refreshBoxes)
                    .catch((error) =>
                      Alert.alert(
                        "Remove",
                        error instanceof Error ? error.message : "Failed",
                      ),
                    );
                },
              },
            ]),
      ],
    );
  };

  const scanAll = async () => {
    if (boxes.length === 0) {
      Alert.alert("Scan", "Add a mailbox first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { imported, errors } = await importFromConnectedMailboxes({
        userId,
        existing: subscriptions,
        addSubscription,
      });
      setStatus(
        imported === 0
          ? errors.length
            ? errors.join("\n")
            : "Scan finished. No new subscriptions."
          : `Added ${imported} subscription(s).`,
      );
    } finally {
      setBusy(false);
    }
  };

  const submitImap = async () => {
    if (!imapHost.trim() || !imapUser.trim() || !imapPass.trim()) {
      Alert.alert("IMAP", "Host, username, and password are required.");
      return;
    }
    try {
      await connectImapAndRecord({
        host: imapHost.trim(),
        port: Number.parseInt(imapPort, 10) || 993,
        secure: true,
        username: imapUser.trim(),
        password: imapPass,
      });
      setImapOpen(false);
      setImapPass("");
      await refreshBoxes();
    } catch (error) {
      Alert.alert(
        "IMAP",
        error instanceof Error ? error.message : "Failed to store IMAP login",
      );
    }
  };

  const submitPasswordMail = async () => {
    if (!passwordKind) return;
    if (!passwordUser.trim() || !passwordPass.trim()) {
      Alert.alert(
        passwordKind === "proton" ? "Proton Mail" : "Tuta",
        "Email and password are required.",
      );
      return;
    }
    try {
      await connectPasswordMailAndRecord(passwordKind, {
        username: passwordUser.trim(),
        password: passwordPass,
        totp: passwordTotp.trim() || undefined,
      });
      setPasswordKind(null);
      setPasswordPass("");
      setPasswordTotp("");
      await refreshBoxes();
    } catch (error) {
      Alert.alert(
        passwordKind === "proton" ? "Proton Mail" : "Tuta",
        error instanceof Error ? error.message : "Failed to store login",
      );
    }
  };

  return (
    <View className="mb-5 rounded-2xl border border-border bg-card p-4">
      <Text className="text-base font-sans-semibold text-primary mb-2">
        Scan subscriptions
      </Text>
      {boxes.length === 0 ? (
        <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
          No mailboxes yet.
        </Text>
      ) : (
        <View className="gap-2 mb-3">
          {boxes.map((box) => (
            <View
              key={box.mailboxId}
              className="flex-row items-center justify-between"
            >
              <Text
                className="flex-1 pr-2 text-sm font-sans-medium text-primary"
                numberOfLines={1}
              >
                {mailboxLabel(box.mailboxId, box.providerId)}
              </Text>
              <Pressable onPress={() => removeMailbox(box)}>
                <Text className="text-xs font-sans-bold text-destructive">
                  Remove
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <View className="flex-row gap-2">
        <Pressable
          className="flex-1 rounded-xl bg-muted py-3 items-center"
          onPress={() => setPickerOpen(true)}
          disabled={busy}
        >
          <Text className="text-xs font-sans-bold text-primary">
            Add mailbox
          </Text>
        </Pressable>
        <Pressable
          className={`flex-1 rounded-xl py-3 items-center ${
            boxes.length ? "bg-accent" : "bg-muted"
          }`}
          onPress={scanAll}
          disabled={busy || boxes.length === 0}
        >
          {busy ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text
              className={`text-xs font-sans-bold ${
                boxes.length ? "text-white" : "text-muted-foreground"
              }`}
            >
              Scan for subscriptions
            </Text>
          )}
        </Pressable>
      </View>
      {status && (
        <Text className="mt-2 text-xs font-sans-medium text-muted-foreground">
          {status}
        </Text>
      )}

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50"
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            className="mt-auto rounded-t-3xl bg-background p-5"
            style={{ paddingBottom: sheetPadding }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-xl font-sans-bold text-primary mb-4">
              Add mailbox
            </Text>
            {MAIL_PROVIDER_CATALOG.map((row) => (
              <Pressable
                key={row.id}
                className="mb-2 rounded-xl border border-border bg-card p-3"
                onPress={() => addMailbox(row.id)}
              >
                <Text className="text-sm font-sans-medium text-primary">
                  {row.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              className="mt-2 items-center rounded-2xl bg-muted py-4"
              onPress={() => setPickerOpen(false)}
            >
              <Text className="text-base font-sans-bold text-primary">
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={imapOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setImapOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setImapOpen(false)}
          >
            <Pressable
              className="rounded-t-3xl bg-background p-5"
              style={{ paddingBottom: sheetPadding, maxHeight: "85%" }}
              onPress={(e) => e.stopPropagation()}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
                <Text className="text-xl font-sans-bold text-primary mb-2">
                  IMAP / IMAPS
                </Text>
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
                  placeholder="Host"
                  autoCapitalize="none"
                  value={imapHost}
                  onChangeText={setImapHost}
                />
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
                  placeholder="Port (993)"
                  keyboardType="number-pad"
                  value={imapPort}
                  onChangeText={setImapPort}
                />
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
                  placeholder="Username"
                  autoCapitalize="none"
                  value={imapUser}
                  onChangeText={setImapUser}
                />
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-4 text-primary"
                  placeholder="Password / app password"
                  secureTextEntry
                  value={imapPass}
                  onChangeText={setImapPass}
                />
                <Pressable
                  className="mb-3 items-center rounded-2xl bg-accent py-4"
                  onPress={submitImap}
                >
                  <Text className="text-base font-sans-bold text-white">
                    Save IMAP login
                  </Text>
                </Pressable>
                <Pressable
                  className="items-center rounded-2xl bg-muted py-4"
                  onPress={() => setImapOpen(false)}
                >
                  <Text className="text-base font-sans-bold text-primary">
                    Cancel
                  </Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={passwordKind !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPasswordKind(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setPasswordKind(null)}
          >
            <Pressable
              className="rounded-t-3xl bg-background p-5"
              style={{ paddingBottom: sheetPadding, maxHeight: "85%" }}
              onPress={(e) => e.stopPropagation()}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
                <Text className="text-xl font-sans-bold text-primary mb-2">
                  {passwordKind === "proton" ? "Proton Mail" : "Tuta"}
                </Text>
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={passwordUser}
                  onChangeText={setPasswordUser}
                />
                <TextInput
                  className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
                  placeholder="Password"
                  secureTextEntry
                  value={passwordPass}
                  onChangeText={setPasswordPass}
                />
                {passwordKind === "proton" && (
                  <TextInput
                    className="rounded-xl border border-border bg-card p-3 mb-4 text-primary"
                    placeholder="2FA code (if enabled)"
                    keyboardType="number-pad"
                    value={passwordTotp}
                    onChangeText={setPasswordTotp}
                  />
                )}
                <Pressable
                  className="mb-3 items-center rounded-2xl bg-accent py-4"
                  onPress={submitPasswordMail}
                >
                  <Text className="text-base font-sans-bold text-white">
                    Save login
                  </Text>
                </Pressable>
                <Pressable
                  className="items-center rounded-2xl bg-muted py-4"
                  onPress={() => setPasswordKind(null)}
                >
                  <Text className="text-base font-sans-bold text-primary">
                    Cancel
                  </Text>
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
