/**
 * Cross-Browser Compatibility Diagnostics
 *
 * Helps diagnose why courses show in Firefox but not Chrome.
 * Dumps IndexedDB state, localStorage, console errors, and network requests
 * so we can compare behaviour across browsers.
 *
 * Uses the *same seed pattern* as curriculum-filter.spec.ts — navigate
 * first (which lets Dexie initialise the DB), then seed, then reload.
 *
 * Run:  pnpm exec playwright test --project=chromium e2e/tests/browser-compat-diagnostics.spec.ts
 *       pnpm exec playwright test --project=firefox   e2e/tests/browser-compat-diagnostics.spec.ts
 */

import { test, expect } from '../fixtures/base';
import { createSettingsStorage } from '../fixtures/test-data/settings';

const SETTINGS_STORAGE = createSettingsStorage();

// ─── Helpers (run inside the browser context via page.evaluate) ────────

/**
 * Seed IndexedDB with a test classroom.
 * Must be called AFTER the page has loaded (Dexie will have created the DB).
 * The database name used by the app is 'MAIC-Database', but the raw
 * `indexedDB.open` helper here matches against whichever name appears.
 */
/**
 * Seed a diagnostic stage into IndexedDB.
 * Must be called AFTER the page has loaded so Dexie has initialised the DB.
 *
 * Uses the same pattern as curriculum-filter.spec.ts — opens via
 * indexedDB.open() and creates the store if it doesn't exist yet,
 * so it works regardless of Dexie's async init timing.
 */
function seedDiagnosticStage(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('MAIC-Database');
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('stages')) {
          db.createObjectStore('stages', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        try {
          // Wait briefly — if Dexie's upgrade is still in progress in another
          // tab/connection, the store may exist but the schema not be finalised.
          if (!db.objectStoreNames.contains('stages')) {
            db.close();
            // Retry once after a short delay
            setTimeout(() => {
              const retry = indexedDB.open('MAIC-Database');
              retry.onupgradeneeded = () => {
                const rdb = retry.result;
                if (!rdb.objectStoreNames.contains('stages')) {
                  rdb.createObjectStore('stages', { keyPath: 'id' });
                }
              };
              retry.onsuccess = () => {
                const rdb = retry.result;
                const tx = rdb.transaction('stages', 'readwrite');
                tx.objectStore('stages').put({
                  id: 'diagnostic-test-stage',
                  name: 'Diagnostic Test Course',
                  description: 'Created by compatibility diagnostic test',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                });
                tx.oncomplete = () => { rdb.close(); resolve(); };
                tx.onerror = (e) => {
                  const t = e.target as IDBRequest;
                  rdb.close();
                  reject(t.error || new Error('Retry tx failed'));
                };
              };
              retry.onerror = (e) => {
                const t = e.target as IDBRequest;
                reject(t.error || new Error('Retry open failed'));
              };
            }, 500);
            return;
          }
          const tx = db.transaction('stages', 'readwrite');
          const store = tx.objectStore('stages');
          store.put({
            id: 'diagnostic-test-stage',
            name: 'Diagnostic Test Course',
            description: 'Created by compatibility diagnostic test',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = (event) => {
            const target = event.target as IDBRequest;
            db.close();
            reject(target.error || new Error('Transaction failed'));
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
      request.onerror = (event) => {
        const target = event.target as IDBRequest;
        reject(target.error || new Error('Failed to open database'));
      };
    });
  });
}

/** Open the MAIC database and dump its stages table contents. */
async function dumpStagesTable(): Promise<{
  exists: boolean;
  version: number | null;
  stageCount: number;
  stages: Record<string, unknown>[];
  stores: string[];
  error?: string;
}> {
  try {
    const databases = await indexedDB.databases();
    const maicDb = databases.find(
      (d) => d.name === 'MAIC-Database' || d.name === 'MAICDatabase',
    );
    if (!maicDb) {
      return {
        exists: false,
        version: null,
        stageCount: 0,
        stages: [],
        stores: [],
        error: 'Database not found',
      };
    }

    return new Promise((resolve) => {
      const request = indexedDB.open(maicDb.name!, maicDb.version);
      request.onerror = () =>
        resolve({
          exists: true,
          version: maicDb.version!,
          stageCount: 0,
          stages: [],
          stores: [],
          error: `Failed to open: ${request.error?.message}`,
        });

      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames);
        const tx = db.transaction('stages', 'readonly');
        const store = tx.objectStore('stages');
        const getAll = store.getAll();

        getAll.onerror = () =>
          resolve({
            exists: true,
            version: maicDb.version!,
            stageCount: 0,
            stages: [],
            stores: storeNames,
            error: `Failed to read stages: ${getAll.error?.message}`,
          });

        getAll.onsuccess = () => {
          const stages = getAll.result.map((r: Record<string, unknown>) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            gradeId: r.gradeId,
            subjectId: r.subjectId,
            weekId: r.weekId,
            lessonId: r.lessonId,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            sceneCount: r.sceneCount,
          }));
          resolve({
            exists: true,
            version: maicDb.version!,
            stageCount: stages.length,
            stages,
            stores: storeNames,
          });
          db.close();
        };
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        resolve({
          exists: true,
          version: maicDb.version!,
          stageCount: 0,
          stages: [],
          stores: Array.from(db.objectStoreNames),
          error: 'Upgrade needed — schema version mismatch',
        });
        db.close();
      };
    });
  } catch (err) {
    return {
      exists: false,
      version: null,
      stageCount: 0,
      stages: [],
      stores: [],
      error: `Exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Dump all localStorage keys and their values (truncated). */
function dumpLocalStorage(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const val = localStorage.getItem(key) ?? '';
      result[key] = val.length > 200 ? val.slice(0, 200) + '...' : val;
    }
  }
  return result;
}

// ─── Tests ────────────────────────────────────────────────────────────

test.describe('Browser Compatibility Diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
    }, SETTINGS_STORAGE);
  });

  test('diagnostic dump — IndexedDB, localStorage, console errors, network', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const networkRequests: Array<{ url: string; status: number }> = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning') consoleWarnings.push(msg.text());
    });
    page.on('response', (response) => {
      networkRequests.push({ url: response.url(), status: response.status() });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // ── 1. Dump IndexedDB state ──
    const dbState = await page.evaluate(dumpStagesTable);

    // ── 2. Dump localStorage ──
    const ls = await page.evaluate(dumpLocalStorage);

    // ── 3. Dump catalogue.json fetch ──
    const catalog = await page.evaluate(() =>
      fetch('/catalogue.json').then(async (res) => ({
        status: res.status,
        ok: res.ok,
        body: (await res.text()).slice(0, 500),
      })),
    );

    // ── Log the full diagnostic report ──
    console.log('══════════════════════════════════════════════');
    console.log(
      'BROWSER COMPAT DIAGNOSTIC REPORT — ' +
        `${(await page.evaluate(() => navigator.userAgent)).slice(0, 80)}`,
    );
    console.log('──────────────────────────────────────────────');
    console.log('1. INDEXEDDB STATE:', JSON.stringify(dbState, null, 2));
    console.log('──────────────────────────────────────────────');
    console.log('2. LOCALSTORAGE:', JSON.stringify(ls, null, 2));
    console.log('──────────────────────────────────────────────');
    console.log('3. CATALOGUE FETCH:', JSON.stringify(catalog, null, 2));
    console.log('──────────────────────────────────────────────');
    console.log('4. CONSOLE ERRORS (%d):', consoleErrors.length);
    consoleErrors.forEach((e) => console.log('  ✗', e));
    console.log('5. CONSOLE WARNINGS (%d):', consoleWarnings.length);
    consoleWarnings.forEach((w) => console.log('  ⚠', w));
    console.log('6. NETWORK REQUESTS (%d):', networkRequests.length);
    networkRequests.forEach((r) => console.log(`  ${r.status} ${r.url}`));
    console.log('══════════════════════════════════════════════');

    // Annotations for test result comparison
    test.info().annotations.push(
      { type: 'indexeddb', description: JSON.stringify(dbState) },
      { type: 'localStorage', description: JSON.stringify(ls) },
      { type: 'catalogue', description: JSON.stringify(catalog) },
      { type: 'consoleErrors', description: consoleErrors.join('\n') },
      { type: 'networkRequests', description: networkRequests.map((r) => `${r.status} ${r.url}`).join('\n') },
    );

    // Assertions
    expect(consoleErrors.filter((e) => !e.includes('favicon.ico'))).toHaveLength(0);
    expect(catalog.ok).toBe(true);
    expect(catalog.status).toBe(200);
    if (dbState.exists) expect(dbState.error).toBeUndefined();
  });

  test('seed data then verify courses appear on home page', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.addInitScript((settings) => {
      localStorage.setItem('settings-storage', settings);
    }, SETTINGS_STORAGE);

    // Step 1: Navigate FIRST (lets Dexie initialise the IndexedDB schema)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Step 2: Seed data via the same pattern as curriculum-filter.spec.ts
    await seedDiagnosticStage(page);

    // Step 3: Reload so the app picks up the seeded record
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Log console errors
    if (consoleErrors.length > 0) {
      console.log('Console errors after seeding + reload:');
      consoleErrors.forEach((e) => console.log('  ✗', e));
    }

    // Dump IndexedDB to verify seeding worked
    const dbState = await page.evaluate(dumpStagesTable);
    console.log('IndexedDB state after seeding:', JSON.stringify(dbState, null, 2));

    test.info().annotations.push({
      type: 'dbStateAfterSeed',
      description: JSON.stringify(dbState),
    });

    // Assert seeded record exists
    expect(dbState.stageCount).toBeGreaterThanOrEqual(1);
    const seededStage = dbState.stages.find((s) => s.id === 'diagnostic-test-stage');
    expect(seededStage).toBeDefined();
    expect(seededStage?.name).toBe('Diagnostic Test Course');

    // Assert the classroom card is visible
    const courseCard = page.locator('text=Diagnostic Test Course');
    await expect(courseCard).toBeVisible({ timeout: 5000 });
  });
});
