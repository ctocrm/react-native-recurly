import { Redirect, type Href } from "expo-router";

const SignUp = () => {
  return <Redirect href={"/(auth)/signIn" as Href} />;
};

export default SignUp;
