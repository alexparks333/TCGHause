import { Platform } from 'react-native';

// Soft elevation for cards/sheets — iOS-style shadow props plus Android's
// `elevation` fallback, since RN doesn't unify these.
export const CardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  default: { elevation: 3 },
});

export const SoftShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  default: { elevation: 1 },
});
