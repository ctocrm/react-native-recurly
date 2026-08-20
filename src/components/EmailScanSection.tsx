import { useSubscriptions } from "@/context/SubscriptionContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import {
  DEFAULT_DISPLAY_FILTERS,
  MAIL_PROVIDER_CATALOG,
  buildCandidateMap,
  candidateToSubscription,
  filterCandidates,
  type DisplayFilters,
  type MailProviderId,
  type ScanCandidate,
} from "@/services/emailscan";
import {
  getMailboxAsync,
  listMailboxesAsync,
} from "@/services/emailscan/persist";
import {
  MailConnectError,
  MailScanUnverifiedError,
  connectImapAndRecord,
  createMailProvider,
  oauthClientId,
} from "@/services/emailscan/providers";
import { useUser } from "@clerk/expo";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

export default function EmailScanSection() {
  const { sheetPadding } = useBottomClearance();
  const { user } = useUser();
  const { addSubscription } = useSubscriptions();
  const userId = user?.id || "anonymous";

  const [busyId, setBusyId] = useState<MailProviderId | null>(null);
  const [connected, setConnected] = useState<
    Partial<Record<MailProviderId, boolean>>
  >({});
  const [filters, setFilters] = useState<DisplayFilters>(
    DEFAULT_DISPLAY_FILTERS,
  );
  const [candidates, setCandidates] = useState<ScanCandidate[]>([]);
  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [imapOpen, setImapOpen] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapUser, setImapUser] = useState("");
  const [imapPass, setImapPass] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [status, setStatus] = useState<string | null>(null);

  const refreshConnected = useCallback(async () => {
    const next: Partial<Record<MailProviderId, boolean>> = {};
    for (const row of MAIL_PROVIDER_CATALOG) {
      const provider = createMailProvider(row.id, userId);
      next[row.id] = await provider.isConnected();
    }
    setConnected(next);
    try {
      const boxes = await listMailboxesAsync();
      if (boxes[0]) {
        const state = await getMailboxAsync(boxes[0].mailboxId);
        if (state) {
          setActiveMailbox(state.mailboxId);
          setCandidates(
            buildCandidateMap(
              Object.values(state.messages).map((m) => m.classified),
            ),
          );
        }
      }
    } catch {
      // DB not ready yet
    }
  }, [userId]);

  useEffect(() => {
    refreshConnected().catch(() => undefined);
  }, [refreshConnected]);

  const shown = filterCandidates(candidates, filters);

  const handleConnect = async (id: MailProviderId) => {
    if (id === "imap") {
      setImapOpen(true);
      return;
    }
    if (!oauthClientId(id)) {
      Alert.alert(
        "Not configured",
        `${id} OAuth needs a public client id in the environment. Not connected.`,
      );
      return;
    }
    setBusyId(id);
    setStatus(null);
    try {
      const provider = createMailProvider(id, userId);
      await provider.connect();
      setConnected((prev) => ({ ...prev, [id]: true }));
      setStatus(`${id} connected. Scan when you are ready.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connect failed";
      Alert.alert("Connect", message);
    } finally {
      setBusyId(null);
    }
  };

  const handleScan = async (id: MailProviderId) => {
    setBusyId(id);
    setStatus(null);
    try {
      const provider = createMailProvider(id, userId);
      const result = await provider.scan();
      setActiveMailbox(result.mailboxId);
      setCandidates(result.candidates);
      setStatus(
        result.candidates.length === 0
          ? "Scan finished. Recurring view is empty (honest miss)."
          : `Scan finished. ${result.candidates.length} candidate(s) cached.`,
      );
    } catch (error) {
      if (error instanceof MailScanUnverifiedError) {
        setStatus(`Unverified: ${error.message}`);
        Alert.alert("Scan unverified", error.message);
      } else if (error instanceof MailConnectError) {
        Alert.alert("Not connected", error.message);
      } else {
        Alert.alert(
          "Scan failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDisconnect = async (id: MailProviderId) => {
    const provider = createMailProvider(id, userId);
    await provider.disconnect();
    setConnected((prev) => ({ ...prev, [id]: false }));
    if (activeMailbox?.startsWith(id)) {
      setCandidates([]);
      setActiveMailbox(null);
    }
  };

  const handleImport = async (candidate: ScanCandidate) => {
    try {
      await addSubscription(candidateToSubscription(candidate));
      Alert.alert(
        "Imported",
        `${candidate.merchant} added. Scan did not auto-create it.`,
      );
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  };

  const submitImap = async () => {
    if (!imapHost.trim() || !imapUser.trim() || !imapPass.trim()) {
      Alert.alert("IMAP", "Host, username, and password are required.");
      return;
    }
    try {
      const mailboxId = await connectImapAndRecord({
        host: imapHost.trim(),
        port: Number.parseInt(imapPort, 10) || 993,
        secure: true,
        username: imapUser.trim(),
        password: imapPass,
      });
      setConnected((prev) => ({ ...prev, imap: true }));
      setActiveMailbox(mailboxId);
      setImapOpen(false);
      setImapPass("");
      setStatus(
        "IMAP credentials stored. Scan is unverified on this Expo client (no native IMAP socket).",
      );
    } catch (error) {
      Alert.alert(
        "IMAP",
        error instanceof Error ? error.message : "Failed to store IMAP login",
      );
    }
  };

  return (
    <View className="auth-card mb-5">
      <Text className="text-base font-sans-semibold text-primary mb-3">
        Email scan
      </Text>
      <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
        Connect a mailbox, then scan. A subscription is an account (including
        $0). Scan never auto-creates rows. I stop at the OAuth/IMAP sheet.
      </Text>
      <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
        Not every merchant emails a receipt. IMAP is iCloud, Yahoo, AOL, or a
        custom host — not Proton or Tuta. Play / StoreKit catalogs are not this
        phase.
      </Text>

      <View className="gap-2 mb-4">
        {MAIL_PROVIDER_CATALOG.map((row) => {
          const isOn = !!connected[row.id];
          const busy = busyId === row.id;
          return (
            <View
              key={row.id}
              className="rounded-xl border border-border bg-card p-3"
            >
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-sans-medium text-primary">
                    {row.label}
                  </Text>
                  <Text className="text-xs font-sans-medium text-muted-foreground">
                    {row.auth === "imap"
                      ? "Host / user / app password"
                      : isOn
                        ? "Connected"
                        : "OAuth"}
                    {!row.liveScanInPhase4 && row.branded
                      ? " · live-scan unverified"
                      : ""}
                  </Text>
                </View>
                {busy && <ActivityIndicator size="small" />}
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  className="flex-1 rounded-xl bg-accent py-2 items-center"
                  onPress={() => handleConnect(row.id)}
                  disabled={busy}
                >
                  <Text className="text-xs font-sans-bold text-white">
                    {row.auth === "imap" ? "IMAP form" : "Connect"}
                  </Text>
                </Pressable>
                <Pressable
                  className={`flex-1 rounded-xl py-2 items-center ${
                    isOn ? "bg-primary" : "bg-muted"
                  }`}
                  onPress={() => handleScan(row.id)}
                  disabled={busy || !isOn}
                >
                  <Text
                    className={`text-xs font-sans-bold ${
                      isOn ? "text-white" : "text-muted-foreground"
                    }`}
                  >
                    Scan
                  </Text>
                </Pressable>
                {isOn && (
                  <Pressable
                    className="rounded-xl bg-destructive px-3 py-2 items-center"
                    onPress={() => handleDisconnect(row.id)}
                    disabled={busy}
                  >
                    <Text className="text-xs font-sans-bold text-white">
                      Off
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>

      <Text className="text-sm font-sans-semibold text-primary mb-2">
        Display filters
      </Text>
      <Text className="text-xs font-sans-medium text-muted-foreground mb-2">
        Toggle does not refetch. Default is Recurring only.
      </Text>
      <View className="flex-row gap-2 mb-4">
        {(
          [
            ["recurring", "Recurring"],
            ["sparse", "Sparse"],
            ["free", "Free"],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            className={`flex-1 rounded-xl py-2 items-center border ${
              filters[key]
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
            onPress={() =>
              setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
            }
          >
            <Text className="text-xs font-sans-bold text-primary">{label}</Text>
          </Pressable>
        ))}
      </View>

      {status && (
        <Text className="text-xs font-sans-medium text-muted-foreground mb-3">
          {status}
        </Text>
      )}

      {shown.length === 0 ? (
        <Text className="text-sm font-sans-medium text-muted-foreground">
          No candidates in this view.
        </Text>
      ) : (
        <View className="gap-2">
          {shown.map((c) => (
            <View
              key={`${c.mailboxId}-${c.merchantKey}-${c.kind}`}
              className="rounded-xl border border-border bg-card p-3"
            >
              <Text className="text-sm font-sans-bold text-primary">
                {c.merchant}
              </Text>
              <Text className="text-xs font-sans-medium text-muted-foreground mb-2">
                {c.kind}
                {c.amountUnknown
                  ? " · amount unknown"
                  : c.amount !== undefined
                    ? ` · ${c.currency ?? ""} ${c.amount}`
                    : ""}
              </Text>
              <Pressable
                className="rounded-xl bg-accent py-2 items-center"
                onPress={() => handleImport(c)}
              >
                <Text className="text-xs font-sans-bold text-white">
                  Import
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={imapOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setImapOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/50"
          onPress={() => setImapOpen(false)}
        >
          <Pressable
            className="mt-auto rounded-t-3xl bg-background p-5"
            style={{ paddingBottom: sheetPadding }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-xl font-sans-bold text-primary mb-2">
              IMAP / IMAPS
            </Text>
            <Text className="text-xs font-sans-medium text-muted-foreground mb-4">
              Public IMAP only: iCloud (imap.mail.me.com), Yahoo
              (imap.mail.yahoo.com), AOL (imap.aol.com), or a custom host. Not
              Proton or Tuta. Agent never types this.
            </Text>
            <TextInput
              className="rounded-xl border border-border bg-card p-3 mb-2 text-primary"
              placeholder="Host (imap.example.com)"
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
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
