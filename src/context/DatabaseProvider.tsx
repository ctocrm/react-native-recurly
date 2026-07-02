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
import { ActivityIndicator, Text, View } from "react-native";
import { closeDatabase, openDatabase } from "../../services/database";

interface DatabaseContextType {
  db: SQLiteDatabase | null;
  userId: string | null;
  isReady: boolean;
}

const DatabaseContext = createContext<DatabaseContextType>({
  db: null,
  userId: null,
  isReady: false,
});

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  const { isSignedIn, isLoaded, userId: clerkUserId } = useAuth();
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const isOpening = useRef(false);

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
      if (isOpening.current) return;
      isOpening.current = true;

      try {
        const database = await openDatabase(clerkUserId);
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
      } finally {
        isOpening.current = false;
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, clerkUserId]);

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
