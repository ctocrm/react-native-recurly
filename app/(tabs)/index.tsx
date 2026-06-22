import "@/global.css";
import { Link } from "expo-router";
import { styled } from "nativewind";
import { Text } from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const App = () => {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="text-5xl font-sans-extrabold text-primary">Home</Text>
      <Link
        href="/onboarding"
        className="mt-4 font-sans-bold rounded bg-primary text-white p-4"
      >
        Go to Onboarding
      </Link>
      <Link
        href="/signIn"
        className="mt-4 font-sans-bold rounded bg-primary text-white p-4"
      >
        Go to SignIn
      </Link>
      <Link
        href="/signUp"
        className="mt-4 font-sans-bold rounded bg-primary text-white p-4"
      >
        Go to SignUp
      </Link>
    </SafeAreaView>
  );
};

export default App;
