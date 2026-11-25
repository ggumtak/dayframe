package com.ggumtak.dayframe.widgetquickadd

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes native availability and syncs the user's accent palette to SharedPreferences so
 * QuickAddOverlayActivity can match the app's appearance without launching MainActivity.
 */
class WidgetQuickAddModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DayframeWidgetQuickAdd")

    Function("isAvailable") {
      true
    }

    Function("setAccentColor") { lightHex: String, darkHex: String ->
      val ctx = appContext.reactContext?.applicationContext ?: return@Function
      val light = lightHex.trim()
      val dark = darkHex.trim()
      ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_ACCENT_LIGHT, light)
        .putString(KEY_ACCENT_DARK, dark)
        .apply()
    }
  }

  internal companion object {
    const val PREFS_NAME = "dayframe_widget_overlay"
    const val KEY_ACCENT_LIGHT = "accent_light"
    const val KEY_ACCENT_DARK = "accent_dark"
  }
}
