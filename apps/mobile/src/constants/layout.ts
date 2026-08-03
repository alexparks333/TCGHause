import { Dimensions } from 'react-native';

import { Spacing } from './theme';

// One shared card width for both the 2-column browse grid and the
// horizontal strips (Hot Auctions, Recently Viewed) — computed once so
// every card everywhere is guaranteed pixel-identical, instead of the grid
// using flex-based sizing and strips using a separately-guessed constant.
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = Spacing.three;
const GRID_GAP = Spacing.three;

export const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;
