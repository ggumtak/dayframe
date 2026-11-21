// Runs before the app itself, including when Android starts the JavaScript runtime only to update the
// widget or to handle a notification button while the app is closed.
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { handleReminderAction } from '@/features/reminders/notify';
import { widgetTaskHandler } from '@/features/widget/render';

const NOTIFICATION_TASK = 'dayframe-notification-actions';

TaskManager.defineTask<Notifications.NotificationTaskPayload>(NOTIFICATION_TASK, async ({ data }) => {
  if (data && 'actionIdentifier' in data) await handleReminderAction(data);
});
Notifications.registerTaskAsync(NOTIFICATION_TASK).catch(() => {});

// Alerts that arrive while the app is open still appear as a banner with sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

registerWidgetTaskHandler(widgetTaskHandler);
