'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { initDatabase } from '@/lib/utils/database';

/**
 * Fetches server-configured providers on mount and merges into settings store.
 * Also initializes IndexedDB and requests persistent storage to prevent data
 * eviction (especially in Chrome, which is aggressive under storage pressure).
 * Renders nothing — purely a side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);

  useEffect(() => {
    fetchServerProviders();
    initDatabase();
  }, [fetchServerProviders]);

  return null;
}
