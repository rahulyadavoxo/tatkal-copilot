/**
 * Reload-on-mount hook. (No react-navigation focus events in the hand-rolled
 * router, so screens reload their vault data on every mount — mounts happen
 * on each navigation, which is exactly when freshness matters.)
 */
import { useEffect } from 'react';

export function useFocusLoad(load: () => void | Promise<void>) {
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
