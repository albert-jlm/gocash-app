import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gocash.tracker",
  appName: "GoCash Tracker",
  webDir: "out",
  // During development, point to the Next.js dev server for hot reload.
  // Comment out for production builds (Capacitor will serve from webDir).
  // server: {
  //   url: "http://192.168.188.106:3000",
  //   cleartext: true,
  // },
  plugins: {
    Camera: {
      // iOS: added to Info.plist automatically by Capacitor
      // Android: added to AndroidManifest.xml automatically
    },
    CapacitorShareTarget: {
      appGroupId: "group.com.gocash.tracker.share",
    },
  },
  ios: {
    scheme: "GoCash Tracker",
  },
  android: {
    // Allow cleartext for local dev server only
    // allowMixedContent: true,
  },
};

export default config;
