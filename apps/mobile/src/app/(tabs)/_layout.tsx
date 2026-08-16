import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';

import { Brand } from '@/constants/brand';

export default function TabLayout() {
  return (
    <NativeTabs tintColor={Brand.navy}>
      <NativeTabs.Trigger name="index">
        <Label>Browse</Label>
        <Icon sf="magnifyingglass" drawable="ic_menu_search" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="bids">
        <Label>My Bids</Label>
        <Icon sf="hammer" drawable="ic_menu_recent_history" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="watchlist">
        <Label>Watchlist</Label>
        <Icon sf="heart" drawable="btn_star_big_on" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="scan">
        <Label>Scan</Label>
        <Icon sf="viewfinder" drawable="ic_menu_camera" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <Label>Account</Label>
        <Icon sf="person.crop.circle" drawable="ic_menu_myplaces" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
