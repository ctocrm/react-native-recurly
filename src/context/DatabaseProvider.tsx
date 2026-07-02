import { useAuth } from "@clerk/expo";
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
import { closeDatabase, openDatabase } from "../../services/database";

interface DatabaseContextType {
  db: SQLiteDatabase | null;
  userId: string | null;
  isReady: boolean;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const { isSignedIn, isLoaded, userId: clerkUserId } = useAuth();
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const openingRef = useRef<{
    userId: string | null;
    promise: Promise<void> | null;
  }>({
    userId: null,
    promise: null,
  });

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !clerkUserId) {
      if (db) {
        closeDatabase().then(() => setDb(null));
      }
      return;
    }

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
          const database = await openDatabase(currentUserId);
          if (!cancelled) {
            setDb(database);
            setDbError(null);
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
  }, [isLoaded, isSignedIn, clerkUserId, db]);

  const value = useMemo(
    () => ({
      db,
      userId: clerkUserId ?? null,
      isReady: isLoaded && (isSignedIn ? db !== null : true),
    }),
    [db, clerkUserId, isLoaded, isSignedIn],
  );

  if (!isLoaded || (isSignedIn && !db && !dbError)) {
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
                const currentUserId = clerkUserId;
                if (currentUserId) {
                  openDatabase(currentUserId)
                    .then((database) => setDb(database))
                    .catch((error) =>
                      setDbError(
                        error instanceof Error
                          ? error.message
                          : "Unknown database error",
                      ),
                    );
                }
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
