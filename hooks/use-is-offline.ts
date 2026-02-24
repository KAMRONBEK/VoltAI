import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // `isInternetReachable` can be null on first load; treat it as unknown (not offline).
      const reachable = state.isInternetReachable;
      if (reachable === false) {
        setOffline(true);
        return;
      }

      if (state.isConnected === false) {
        setOffline(true);
        return;
      }

      setOffline(false);
    });

    return () => unsub();
  }, []);

  return offline;
}

