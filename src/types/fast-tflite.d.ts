// Ambient declaration for react-native-fast-tflite. The package is installed
// via a native dev build and is not present in the Expo Go type environment,
// so we declare its surface here to keep tsc green.
declare module "react-native-fast-tflite" {
  export function loadTfliteModel(
    modelPath: any,
    options?: any,
  ): Promise<{
    runSync: (inputs: Uint8Array[]) => Promise<Uint8Array[]>;
    run: (inputs: Uint8Array[]) => Promise<Uint8Array[]>;
    [key: string]: any;
  }>;
  const _default: any;
  export default _default;
}
