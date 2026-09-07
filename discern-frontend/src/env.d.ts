declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_DEV_DEVICE_ID?: string;
  }
}

// Injected by the React Native bundler (true in development).
declare const __DEV__: boolean;

// PNG imports. Needed because tsconfig pins `types` to ["react"], so nothing
// else declares them and `import seed from "../assets/seed.png"` would not
// resolve. React Native's bundler turns the import into an asset id, which is
// why the type is `number` — that is `ImageRequireSource`, and it is what
// <Image source={...} /> expects.
declare module "*.png" {
  const asset: number;
  export default asset;
}
