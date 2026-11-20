import { Platform } from 'react-native';

import ApkInstaller from '../../modules/apk-installer';
import { deviceTimeZone, formatDue, Temporal } from './dates';
import { uuid } from './ids';
import { analyzeTask, nextOccurrence } from './shared';

/**
 * Exercises the date engine on the device's own JavaScript runtime and logs one line for CI to read.
 * Only smoke-test builds call this (EXPO_PUBLIC_SELF_CHECK=1); it is how a build is proven to parse
 * Korean dates and cross time zones on a real Android runtime before anyone installs it.
 */
export function runSelfCheck(): void {
  const checks: Record<string, () => boolean> = {
    parser: () => {
      const { task, tokens } = analyzeTask({
        text: '내일 저녁 7시 운동 매주 월수금 #건강 @외출 p2', timezone: 'Asia/Seoul', now: '2026-11-22T09:00:00Z',
      });
      return task.due_at === '2026-11-23T10:00:00Z' && task.recurrence_rule === 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
        && task.title === '운동' && task.project === '건강' && task.priority === 2 && tokens.length === 6;
    },
    daylightSaving: () => nextOccurrence('FREQ=DAILY', 'America/New_York', '2026-03-07T07:30:00Z',
      Temporal.Instant.from('2026-03-08T07:30:00Z'), false) === '2026-03-09T06:30:00Z',
    formatting: () => formatDue({ due_at: '2026-11-23T10:00:00Z', timezone: 'Asia/Seoul', all_day: false })?.endsWith('오후 7:00') === true,
    deviceZone: () => Temporal.Now.plainDateISO(deviceTimeZone()).year > 2000,
    ids: () => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid()),
    // The updater's native module must survive code shrinking and answer across the bridge.
    apkInstaller: () => Platform.OS !== 'android' || (!!ApkInstaller
      && typeof ApkInstaller.canInstallPackages() === 'boolean' && ApkInstaller.inspect('file:///missing.apk') === null),
  };
  const failed: string[] = [];
  for (const [name, check] of Object.entries(checks)) {
    try {
      if (!check()) failed.push(name);
    } catch (error) {
      failed.push(name + ' (' + (error instanceof Error ? error.message : String(error)) + ')');
    }
  }
  console.log('DAYFRAME_SELF_CHECK ' + (failed.length ? 'fail: ' + failed.join(', ') : 'ok'));
  if (Platform.OS === 'android') void checkDownload();
}

/** Runs the updater's download path (redirect, progress events, shareable content URI) against a small public file. */
async function checkDownload(): Promise<void> {
  try {
    const { File, Paths } = await import('expo-file-system');
    const target = new File(Paths.cache, 'dayframe-self-check.bin');
    if (target.exists) target.delete();
    let events = 0;
    const file = await File.downloadFileAsync('https://github.com/expo/expo/raw/main/LICENSE', target, {
      idempotent: true, onProgress: () => { events += 1; },
    });
    const ok = file.exists && file.size > 0 && file.contentUri.startsWith('content://');
    console.log(`DAYFRAME_SELF_CHECK_DOWNLOAD ${ok ? 'ok' : 'fail'} bytes=${file.size} progressEvents=${events}`);
    file.delete();
  } catch (error) {
    console.log('DAYFRAME_SELF_CHECK_DOWNLOAD fail: ' + (error instanceof Error ? error.message : String(error)));
  }
}
