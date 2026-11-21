#!/usr/bin/env bash
# Installs the built APK on the running emulator and proves it starts: the JavaScript runtime must
# report a passing self-check, nothing may crash, and the sign-in screen must be on display.
set -euo pipefail

apk="$1"
out="${2:-smoke}"
package="com.ggumtak.dayframe"
mkdir -p "$out"

adb install -r "$apk"
# Android 13+ asks before showing notifications; grant it so the alert check can run unattended.
adb shell pm grant "$package" android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n "$package/.MainActivity"

for _ in $(seq 1 45); do
  if adb logcat -d -s ReactNativeJS:V | grep -q "DAYFRAME_SELF_CHECK"; then break; fi
  sleep 2
done
sleep 6

adb exec-out screencap -p > "$out/launch.png"
adb logcat -d > "$out/logcat.txt"
adb shell uiautomator dump /sdcard/window.xml > /dev/null
adb shell cat /sdcard/window.xml > "$out/window.xml"

echo "--- JavaScript log"
grep "ReactNativeJS" "$out/logcat.txt" | tail -40 || true
echo "--- Text on screen"
grep -o 'text="[^"]*"' "$out/window.xml" | sort -u | head -40 || true

fail() {
  echo "::error::$1"
  grep -E "AndroidRuntime|ReactNativeJS|FATAL" "$out/logcat.txt" | tail -80 || true
  exit 1
}

grep -q "FATAL EXCEPTION" "$out/logcat.txt" && fail "The app crashed on launch."
grep -q "DAYFRAME_SELF_CHECK ok" "$out/logcat.txt" || fail "The on-device self-check did not pass."
adb shell pidof "$package" > /dev/null || fail "The app is no longer running."
grep -q 'text="Dayframe"' "$out/window.xml" || fail "The sign-in screen is not showing."

# One interaction end to end: switching to sign-up must re-render the form.
bounds="$(grep -o 'content-desc="처음이신가요? 계정 만들기"[^>]*bounds="[^"]*"' "$out/window.xml" | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1)"
[[ -n "$bounds" ]] || fail "The sign-up toggle is missing from the screen."
read -r left top right bottom <<< "$(echo "$bounds" | tr -c '0-9' ' ')"
adb shell input tap $(( (left + right) / 2 )) $(( (top + bottom) / 2 ))
sleep 2
adb shell uiautomator dump /sdcard/window.xml > /dev/null
adb shell cat /sdcard/window.xml > "$out/window-after-tap.xml"
adb exec-out screencap -p > "$out/after-tap.png"
grep -q 'content-desc="이미 계정이 있나요? 로그인"' "$out/window-after-tap.xml" || fail "Tapping the sign-up toggle did not update the screen."

# The updater's download path needs the network, so a miss here is reported without failing the run.
for _ in $(seq 1 10); do
  adb logcat -d > "$out/logcat.txt"
  if grep -q "DAYFRAME_SELF_CHECK_DOWNLOAD" "$out/logcat.txt"; then break; fi
  sleep 2
done
grep "DAYFRAME_SELF_CHECK_DOWNLOAD" "$out/logcat.txt" | tail -1 || true
grep -q "DAYFRAME_SELF_CHECK_DOWNLOAD ok" "$out/logcat.txt" || echo "::warning::The on-device download check did not complete; see the smoke-test artifact."

# Alerts and the home-screen widget: a task alert scheduled by the app's own code must appear, and the
# widget must be registered with the system.
for _ in $(seq 1 15); do
  adb logcat -d > "$out/logcat.txt"
  if grep -q "DAYFRAME_SELF_CHECK_BACKGROUND" "$out/logcat.txt"; then break; fi
  sleep 2
done
grep "DAYFRAME_SELF_CHECK_BACKGROUND" "$out/logcat.txt" | tail -1 || true
adb shell dumpsys notification --noredact > "$out/notifications.txt" || true
adb shell dumpsys appwidget > "$out/appwidget.txt" || true
adb exec-out screencap -p > "$out/after-alert.png"
grep -q "DAYFRAME_SELF_CHECK_BACKGROUND ok" "$out/logcat.txt" || fail "The on-device alert and widget check did not pass."
grep -q "Dayframe 알림 점검" "$out/notifications.txt" || fail "The test alert is not in the notification shade."
grep -q "com.ggumtak.dayframe" "$out/appwidget.txt" || fail "The home-screen widget is not registered."
echo "--- Widget providers"
grep -A2 "com.ggumtak.dayframe" "$out/appwidget.txt" | head -6 || true

echo "Smoke test passed."
