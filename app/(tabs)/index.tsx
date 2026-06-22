import "@/global.css";
import { Link } from "expo-router";
import { Text, View } from "react-native";

const App = () => {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-xl font-bold text-success">
        Welcome to Nativewind!
      </Text>
      <Link
        href="/onboarding"
        className="mt-4 rounded bg-primary text-white p-4"
      >
        Go to Onboarding
      </Link>
      <Link href="/signIn" className="mt-4 rounded bg-primary text-white p-4">
        Go to SignIn
      </Link>
      <Link href="/signUp" className="mt-4 rounded bg-primary text-white p-4">
        Go to SignUp
      </Link>
      <Link href={"/subscriptions/spotify"}>Spotify Subscription</Link>

      <Link
        href={{
          pathname: "/subscriptions/[id]",
          params: { id: "claude" },
        }}
      >
        Go to Claude
      </Link>
    </View>
  );
};

export default App;
