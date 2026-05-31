import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.traveltimeline.app',
  appName: 'TravelTimeline',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
  },
};

export default config;
