package com.ggumtak.dayframe.hardwarekeys

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import android.view.Menu
import android.view.Window
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import com.facebook.react.bridge.ReactContext
import com.facebook.react.interfaces.ExtraWindowEventListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/**
 * Intercepts Android physical hardware keyboard events on both the main Activity window and
 * React Native Modal dialog windows, normalizing physical keyCodes independently of the active IME.
 */
class HardwareKeysModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val listenerLock = Any()

  @Volatile
  private var observing = false

  @Volatile
  private var captureTabInInput = false

  @Volatile
  private var captureArrowsInInput = false

  private var registeredReactContext: WeakReference<ReactContext>? = null

  // Accessed exclusively on the Android main thread.
  private val wrappedWindows = WeakHashMap<Window, KeyWindowCallback>()

  private val extraWindowListener = object : ExtraWindowEventListener {
    override fun onExtraWindowCreate(window: Window) {
      runOnMain {
        if (observing) {
          wrapWindow(window, isModal = true)
        }
      }
    }

    override fun onExtraWindowDestroy(window: Window) {
      runOnMain {
        unwrapWindow(window)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("DayframeHardwareKeys")

    Events(EVENT_KEY_DOWN)

    OnStartObserving(EVENT_KEY_DOWN) {
      observing = true
      runOnMain {
        if (!observing) return@runOnMain
        registerExtraWindowListener()
        appContext.currentActivity?.window?.let { wrapWindow(it, isModal = false) }
      }
    }

    OnActivityEntersForeground {
      if (observing) {
        runOnMain {
          if (!observing) return@runOnMain
          registerExtraWindowListener()
          appContext.currentActivity?.window?.let { wrapWindow(it, isModal = false) }
        }
      }
    }

    OnStopObserving(EVENT_KEY_DOWN) {
      stopObserving()
    }

    OnDestroy {
      stopObserving()
    }

    Function("isAvailable") {
      true
    }

    Function("setCaptureConfig") { tabInInput: Boolean, arrowsInInput: Boolean ->
      captureTabInInput = tabInInput
      captureArrowsInInput = arrowsInInput
    }

    Function("blurFocusedInput") {
      mainHandler.post {
        val windows = LinkedHashSet<Window>()
        windows.addAll(wrappedWindows.keys)
        runCatching { appContext.currentActivity?.window }.getOrNull()?.let { windows.add(it) }
        for (window in windows) {
          val focused = window.currentFocus ?: continue
          val token = focused.windowToken
          focused.clearFocus()
          if (token != null) {
            val imm = focused.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
            imm?.hideSoftInputFromWindow(token, 0)
          }
        }
      }
    }
  }

  private fun stopObserving() {
    observing = false
    unregisterExtraWindowListener()
    runOnMain {
      if (observing) return@runOnMain
      unwrapAllWindows()
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  private fun registerExtraWindowListener() {
    val reactContext = appContext.reactContext as? ReactContext ?: return
    synchronized(listenerLock) {
      if (!observing) return
      val previous = registeredReactContext?.get()
      if (previous === reactContext) return
      previous?.removeExtraWindowEventListener(extraWindowListener)
      reactContext.addExtraWindowEventListener(extraWindowListener)
      registeredReactContext = WeakReference(reactContext)
    }
  }

  private fun unregisterExtraWindowListener() {
    synchronized(listenerLock) {
      val previous = registeredReactContext?.get()
      registeredReactContext = null
      previous?.removeExtraWindowEventListener(extraWindowListener)
      val current = runCatching { appContext.reactContext as? ReactContext }.getOrNull()
      if (current != null && current !== previous) {
        current.removeExtraWindowEventListener(extraWindowListener)
      }
    }
  }

  private fun wrapWindow(window: Window, isModal: Boolean) {
    val existing = window.callback ?: return
    if (existing is KeyWindowCallback) {
      wrappedWindows[window] = existing
      return
    }
    val wrapped = KeyWindowCallback(existing, window, isModal)
    window.callback = wrapped
    wrappedWindows[window] = wrapped
  }

  private fun unwrapWindow(window: Window) {
    val wrapped = wrappedWindows.remove(window) ?: return
    if (window.callback === wrapped) {
      window.callback = wrapped.delegate
    }
  }

  private fun unwrapAllWindows() {
    val entries = wrappedWindows.entries.toList()
    wrappedWindows.clear()
    for ((window, wrapped) in entries) {
      if (window.callback === wrapped) {
        window.callback = wrapped.delegate
      }
    }
  }

  private fun shouldInterceptWhileEditing(
    key: String,
    ctrl: Boolean,
    alt: Boolean,
    shift: Boolean,
    meta: Boolean
  ): Boolean {
    if (key == "escape") return true
    if ((ctrl || meta) && (key == "enter" || key == "k" || key == "/" || key == "f")) return true
    if (ctrl && shift && key == "a") return true
    if (ctrl && !alt && !meta && (key == "j" || key == "n")) return true
    if (key == "f1") return true
    if (alt && !ctrl && !meta && key != "space") return true
    if (key == "tab" && captureTabInInput) return true
    if ((key == "arrowup" || key == "arrowdown") && captureArrowsInInput) return true
    return false
  }

  private inner class KeyWindowCallback(
    internal val delegate: Window.Callback,
    private val window: Window,
    private val isModal: Boolean
  ) : Window.Callback by delegate {
    private val consumedKeyCodes = mutableSetOf<Int>()

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (!observing) {
        consumedKeyCodes.clear()
        return delegate.dispatchKeyEvent(event)
      }

      when (event.action) {
        KeyEvent.ACTION_UP -> {
          return if (consumedKeyCodes.remove(event.keyCode)) {
            true
          } else {
            delegate.dispatchKeyEvent(event)
          }
        }
        KeyEvent.ACTION_DOWN -> Unit
        else -> return delegate.dispatchKeyEvent(event)
      }

      val key = mapKeyCode(event.keyCode) ?: return delegate.dispatchKeyEvent(event)
      val ctrl = event.isCtrlPressed
      val alt = event.isAltPressed
      val shift = event.isShiftPressed
      val meta = event.isMetaPressed

      // Preserve Korean IME language-switch combos (Shift/Ctrl/Alt + Space).
      if (key == "space" && (shift || ctrl || alt)) {
        return delegate.dispatchKeyEvent(event)
      }

      // Preserve Android system Meta shortcuts except explicitly handled in-app combos.
      if (meta && key !in ALLOWED_META_KEYS) {
        return delegate.dispatchKeyEvent(event)
      }

      val focused = window.currentFocus
      val editing = focused is EditText || (focused != null && focused.onCheckIsTextEditor())

      if (editing && !shouldInterceptWhileEditing(key, ctrl, alt, shift, meta)) {
        return delegate.dispatchKeyEvent(event)
      }

      val repeat = event.repeatCount > 0
      if (repeat && key !in REPEATABLE_KEYS) {
        consumedKeyCodes.add(event.keyCode)
        return true
      }

      sendEvent(
        EVENT_KEY_DOWN,
        mapOf(
          "key" to key,
          "ctrl" to ctrl,
          "alt" to alt,
          "shift" to shift,
          "meta" to meta,
          "editing" to editing,
          "repeat" to repeat,
          "modal" to isModal
        )
      )
      consumedKeyCodes.add(event.keyCode)
      return true
    }

    override fun onProvideKeyboardShortcuts(
      data: MutableList<KeyboardShortcutGroup>?,
      menu: Menu?,
      deviceId: Int
    ) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        delegate.onProvideKeyboardShortcuts(data, menu, deviceId)
        data?.add(
          KeyboardShortcutGroup(
            "Dayframe",
            listOf(
              KeyboardShortcutInfo("빠른 할 일 추가", KeyEvent.KEYCODE_N, KeyEvent.META_CTRL_ON),
              KeyboardShortcutInfo("커맨드 팔레트", KeyEvent.KEYCODE_K, KeyEvent.META_CTRL_ON),
              KeyboardShortcutInfo("검색", KeyEvent.KEYCODE_F, KeyEvent.META_CTRL_ON),
              KeyboardShortcutInfo("단축키 도움말", KeyEvent.KEYCODE_SLASH, KeyEvent.META_CTRL_ON)
            )
          )
        )
      }
    }
  }

  private companion object {
    private const val EVENT_KEY_DOWN = "onKeyDown"
    private val ALLOWED_META_KEYS = setOf("k", "enter", "/", "f")
    private val REPEATABLE_KEYS = setOf(
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "j",
      "k",
      "pageup",
      "pagedown",
      "[",
      "]"
    )

    private fun mapKeyCode(keyCode: Int): String? = when (keyCode) {
      in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z ->
        ('a' + (keyCode - KeyEvent.KEYCODE_A)).toString()
      in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 ->
        ('0' + (keyCode - KeyEvent.KEYCODE_0)).toString()
      in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 ->
        ('0' + (keyCode - KeyEvent.KEYCODE_NUMPAD_0)).toString()
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "enter"
      KeyEvent.KEYCODE_ESCAPE -> "escape"
      KeyEvent.KEYCODE_SPACE -> "space"
      KeyEvent.KEYCODE_TAB -> "tab"
      KeyEvent.KEYCODE_DEL -> "backspace"
      KeyEvent.KEYCODE_FORWARD_DEL -> "delete"
      KeyEvent.KEYCODE_DPAD_UP -> "arrowup"
      KeyEvent.KEYCODE_DPAD_DOWN -> "arrowdown"
      KeyEvent.KEYCODE_DPAD_LEFT -> "arrowleft"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "arrowright"
      KeyEvent.KEYCODE_PAGE_UP -> "pageup"
      KeyEvent.KEYCODE_PAGE_DOWN -> "pagedown"
      KeyEvent.KEYCODE_MOVE_HOME -> "home"
      KeyEvent.KEYCODE_MOVE_END -> "end"
      KeyEvent.KEYCODE_SLASH -> "/"
      KeyEvent.KEYCODE_COMMA -> ","
      KeyEvent.KEYCODE_PERIOD -> "."
      KeyEvent.KEYCODE_LEFT_BRACKET -> "["
      KeyEvent.KEYCODE_RIGHT_BRACKET -> "]"
      KeyEvent.KEYCODE_MINUS, KeyEvent.KEYCODE_NUMPAD_SUBTRACT -> "-"
      KeyEvent.KEYCODE_EQUALS -> "="
      KeyEvent.KEYCODE_PLUS, KeyEvent.KEYCODE_NUMPAD_ADD -> "+"
      KeyEvent.KEYCODE_SEMICOLON -> ";"
      KeyEvent.KEYCODE_F1 -> "f1"
      else -> null
    }
  }
}
