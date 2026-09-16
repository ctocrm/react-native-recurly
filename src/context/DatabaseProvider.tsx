import { useAuth } from "@/context/AuthContext";
import { AuthGate } from "@/components/auth/AuthGate";
import type { SQLiteDatabase } from "expo-sqlite";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { closeDatabase, openDatabase } from "@/services/database";
import { resolveGate, type GateRoute } from "@/services/auth/authGate";
import { getVaultMode, isDeviceSecure } from "@/services/auth/vault";

interface DatabaseContextType {
  db: SQLiteDatabase | null;
  userId: string | null;
  isReady: boolean;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

/**
 * Phase A gate lifecycle: checking -> locked (AuthGate owns the flow) ->
 * open (db set). The gate resolves ONCE per sign-in cycle; completeGate
 * performs the actual open with the unwrapped passphrase.
 */
type GateState =
  | { status: "checking" }
  | { status: "locked"; route: GateRoute }
  | { status: "open" };

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const { isSignedIn, isLoaded, userId: clerkUserId } = useAuth();
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [gate, setGate] = useState<GateState>({ status: "checking" });
  const openingRef = useRef<{
    userId: string | null;
    promise: Promise<void> | null;
  }>({
    userId: null,
    promise: null,
  });

  const completeGate = async (passphrase?: string) => {
    if (!clerkUserId) return;
    const database = passphrase
      ? await openDatabase(clerkUserId, { passphrase })
      : await openDatabase(clerkUserId);
    setDb(database);
    setDbError(null);
    setGate({ status: "open" });
  };

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !clerkUserId) {
      setGate({ status: "checking" });
      if (db) {
        closeDatabase().then(() => setDb(null));
      }
      return;
    }
    // Already open (openDatabase is idempotent per user) — nothing to do.
    if (db) return;
    // Locked or open: the gate owns the flow; do not re-resolve mid-flow.
    if (gate.status !== "checking") return;

    let cancelled = false;

    const init = async () => {
      const currentUserId = clerkUserId;

      // If already opening for this user, wait for that promise
      if (
        openingRef.current.userId === currentUserId &&
        openingRef.current.promise
      ) {
        await openingRef.current.promise;
        return;
      }

      // If a different user's open is in flight, start fresh after it settles
      if (openingRef.current.promise) {
        await openingRef.current.promise;
      }

      const openPromise = (async () => {
        try {
          // Phase A: resolve the factor gate BEFORE any DB open. A locked
          // vault must never mint a key over an encrypted database.
          const mode = await getVaultMode(currentUserId);
          const secure = await isDeviceSecure();
          if (cancelled) return;
          const route = resolveGate(mode, secure);
          if (route !== "open") {
            setGate({ status: "locked", route });
            return;
          }
          const database = await openDatabase(currentUserId);
          console.log("[BOOT] db opened");
          if (!cancelled) {
            setDb(database);
            setDbError(null);
            setGate({ status: "open" });
          }
        } catch (error) {
          if (!cancelled) {
            console.error("Failed to open database:", error);
            setDbError(
              error instanceof Error ? error.message : "Unknown database error",
            );
          }
        }
      })();

      openingRef.current = { userId: currentUserId, promise: openPromise };

      await openPromise;
      openingRef.current = { userId: null, promise: null };
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, clerkUserId, db, gate]);

  const value = useMemo(
    () => ({
      db,
      userId: clerkUserId ?? null,
      isReady: isLoaded && (isSignedIn ? gate.status === "open" && db !== null : true),
    }),
    [db, clerkUserId, isLoaded, isSignedIn, gate],
  );

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isSignedIn && !db && !dbError) {
    if (gate.status === "locked" && clerkUserId) {
      return (
        <View className="flex-1 bg-background">
          <AuthGate
            key={clerkUserId}
            userId={clerkUserId}
            onUnlocked={(passphrase) => {
              completeGate(passphrase).catch((error) => {
                console.error("Gate unlock failed:", error);
                setDbError(
                  error instanceof Error ? error.message : "Unknown database error",
                );
              });
            }}
          />
        </View>
      );
    }
    // checking, or locked-route not yet resolved
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (dbError) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-5">
        <View className="auth-card p-6">
          <View className="items-center gap-4">
            <View className="size-12 items-center justify-center rounded-full bg-destructive/20">
              <Text className="text-destructive text-2xl">!</Text>
            </View>
            <View className="items-center gap-2">
              <Text className="text-lg font-sans-bold text-primary">
                Database Error
              </Text>
              <Text className="text-sm font-sans-medium text-muted-foreground text-center">
                {dbError}
              </Text>
            </View>
            <Pressable
              className="mt-2 rounded-xl bg-accent px-6 py-2"
              onPress={() => {
                setDbError(null);
                // Re-run the whole gate flow rather than a bare open — a
                // locked vault needs the passphrase, not a retry open.
                setGate({ status: "checking" });
              }}
            >
              <Text className="text-sm font-sans-bold text-white">Retry</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <DatabaseContext.Provider value={value}>
      {children}
    </DatabaseContext.Provider>
  );
};

export const useDatabase = (): DatabaseContextType => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error("useDatabase must be used within a DatabaseProvider");
  }
  return context;
};
