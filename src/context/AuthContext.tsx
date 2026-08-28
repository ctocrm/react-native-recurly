import * as SecureStore from "expo-secure-store";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const SESSION_KEY = "cadence_local_session";
export const LOCAL_USER_ID = "local";

export type LocalUser = {
  id: typeof LOCAL_USER_ID;
  firstName: string;
  lastName: string;
  fullName: string;
  imageUrl: string | undefined;
  createdAt: number;
  emailAddresses: { emailAddress: string }[];
  primaryEmailAddress: { emailAddress: string } | undefined;
};

type SessionBlob = {
  signedIn: true;
  createdAt: number;
};

type AuthContextType = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: LocalUser | null;
  signInLocal: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

function userFromSession(createdAt: number): LocalUser {
  return {
    id: LOCAL_USER_ID,
    firstName: "Local",
    lastName: "",
    fullName: "Local",
    imageUrl: undefined,
    createdAt,
    emailAddresses: [],
    primaryEmailAddress: undefined,
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [createdAt, setCreatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as SessionBlob;
          if (parsed?.signedIn && typeof parsed.createdAt === "number") {
            setCreatedAt(parsed.createdAt);
          }
        }
      } catch (error) {
        console.error("Failed to restore local session:", error);
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInLocal = useCallback(async () => {
    const at = createdAt ?? Date.now();
    const blob: SessionBlob = { signedIn: true, createdAt: at };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(blob));
    setCreatedAt(at);
  }, [createdAt]);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setCreatedAt(null);
  }, []);

  const isSignedIn = createdAt !== null;
  const user = useMemo(
    () => (createdAt !== null ? userFromSession(createdAt) : null),
    [createdAt],
  );

  const value = useMemo(
    () => ({
      isLoaded,
      isSignedIn,
      userId: isSignedIn ? LOCAL_USER_ID : null,
      user,
      signInLocal,
      signOut,
    }),
    [isLoaded, isSignedIn, user, signInLocal, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const useUser = (): { user: LocalUser | null } => {
  const { user } = useAuth();
  return { user };
};
