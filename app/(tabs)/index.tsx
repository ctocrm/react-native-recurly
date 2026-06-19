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
        href="/Onboarding"
        className="mt-4 rounded bg-primary text-white p-4"
      >
        Go to Onboarding
      </Link>
      <Link href="/SignIn" className="mt-4 rounded bg-primary text-white p-4">
        Go to SignIn
      </Link>
      <Link href="/SignUp" className="mt-4 rounded bg-primary text-white p-4">
        Go to SignUp
      </Link>
    </View>
  );
};

export default App;
