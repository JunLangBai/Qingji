import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.qingji.app",
  appName: "清记",
  webDir: "../../packages/client/dist",
  backgroundColor: "#f6f3ec",
  android: {
    backgroundColor: "#f6f3ec",
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: "解锁清记",
        biometricSubTitle: "验证身份后打开本机事项",
      },
    },
  },
};

export default config;
