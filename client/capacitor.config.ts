import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lukemcevoy.traveltimeline',
  appName: 'TravelTimeline',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
  },
};

export default config;
