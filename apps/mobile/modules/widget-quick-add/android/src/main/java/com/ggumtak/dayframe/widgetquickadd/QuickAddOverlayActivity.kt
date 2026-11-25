package com.ggumtak.dayframe.widgetquickadd

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.util.Calendar
import java.util.Locale

/**
 * Transparent floating Quick-Add dialog Activity rendered directly over the home screen wallpaper.
 * Dispatches QUICK_ADD / QUICK_ADD_HABIT broadcasts directly to the installed Dayframe
 * AppWidgetProvider without pulling MainActivity to the foreground or requesting SYSTEM_ALERT_WINDOW.
 */
class QuickAddOverlayActivity : Activity() {
  private data class Palette(
    val isDark: Boolean,
    val cardBg: Int,
    val border: Int,
    val inputBg: Int,
    val text: Int,
    val muted: Int,
    val accent: Int,
    val onAccent: Int,
    val chipBg: Int,
    val chipBorder: Int,
    val accentSoftBg: Int,
    val accentSoftBorder: Int,
    val priorityMedium: Int,
    val priorityHigh: Int
  )

  private data class DateOption(
    val value: String,
    val label: String
  )

  private lateinit var palette: Palette
  private lateinit var rootContainer: FrameLayout
  private lateinit var cardContainer: MaxWidthLinearLayout
  private lateinit var titleView: TextView
  private lateinit var subtitleView: TextView
  private lateinit var detailButton: TextView
  private lateinit var inputField: EditText
  private lateinit var chipScrollView: HorizontalScrollView
  private lateinit var chipRow: LinearLayout
  private lateinit var keepOpenChip: TextView
  private lateinit var cancelButton: TextView
  private lateinit var submitButton: TextView

  private val dateChipViews = LinkedHashMap<String, TextView>()
  private var priorityChipView: TextView? = null

  private var kind: String = KIND_TASK
  private var widgetName: String = DEFAULT_WIDGET
  private var explicitDate: String? = null
  private var selectedDate: String = DATE_TODAY
  private var priority: Int = PRIORITY_NORMAL
  private var keepOpen: Boolean = false
  private var initialFocusRequested: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      overrideActivityTransition(OVERRIDE_TRANSITION_OPEN, 0, 0)
      overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0)
    }

    configureWindow()
    palette = buildPalette()

    applyUriParams(intent?.data)
    if (savedInstanceState != null) {
      kind = savedInstanceState.getString(STATE_KIND, kind)
      widgetName = savedInstanceState.getString(STATE_WIDGET, widgetName)
      explicitDate = savedInstanceState.getString(STATE_EXPLICIT_DATE, explicitDate)
      selectedDate = savedInstanceState.getString(STATE_SELECTED_DATE, selectedDate)
      priority = savedInstanceState.getInt(STATE_PRIORITY, priority).coerceIn(PRIORITY_NORMAL, PRIORITY_URGENT)
      keepOpen = savedInstanceState.getBoolean(STATE_KEEP_OPEN, keepOpen)
    }

    buildUi()
    refreshUiForState()

    val savedText = savedInstanceState?.getString(STATE_INPUT_TEXT)
    if (!savedText.isNullOrEmpty()) {
      inputField.setText(savedText)
      inputField.setSelection(savedText.length)
    }
    updateSubmitButtonState()

    // Subtle calm lift-in over the dimmed wallpaper.
    cardContainer.alpha = 0f
    cardContainer.translationY = dp(12).toFloat()
    cardContainer.animate()
      .alpha(1f)
      .translationY(0f)
      .setDuration(140L)
      .setInterpolator(DecelerateInterpolator())
      .start()

    focusInputAndShowKeyboard()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    if (intent != null) {
      setIntent(intent)
    }
    applyUriParams(intent?.data)
    priority = PRIORITY_NORMAL
    refreshUiForState()
    updateSubmitButtonState()
    focusInputAndShowKeyboard()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && !initialFocusRequested) {
      initialFocusRequested = true
      focusInputAndShowKeyboard()
    }
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putString(STATE_KIND, kind)
    outState.putString(STATE_WIDGET, widgetName)
    outState.putString(STATE_EXPLICIT_DATE, explicitDate)
    outState.putString(STATE_SELECTED_DATE, selectedDate)
    outState.putInt(STATE_PRIORITY, priority)
    outState.putBoolean(STATE_KEEP_OPEN, keepOpen)
    if (::inputField.isInitialized) {
      outState.putString(STATE_INPUT_TEXT, inputField.text?.toString().orEmpty())
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent?): Boolean {
    if (event != null && event.keyCode == KeyEvent.KEYCODE_ESCAPE) {
      if (event.action == KeyEvent.ACTION_UP) {
        dismissOverlay()
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun configureWindow() {
    window?.apply {
      addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      setDimAmount(0.38f)
      setSoftInputMode(
        WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or
          WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
      )
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        setDecorFitsSystemWindows(false)
      }
    }
  }

  private fun buildPalette(): Palette {
    val isDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    val prefs = getSharedPreferences(WidgetQuickAddModule.PREFS_NAME, Context.MODE_PRIVATE)
    val defaultAccentHex = if (isDark) DEFAULT_ACCENT_DARK else DEFAULT_ACCENT_LIGHT
    val prefKey = if (isDark) WidgetQuickAddModule.KEY_ACCENT_DARK else WidgetQuickAddModule.KEY_ACCENT_LIGHT
    val accent = parseColorOrNull(prefs.getString(prefKey, null))
      ?: Color.parseColor(defaultAccentHex)

    return if (isDark) {
      Palette(
        isDark = true,
        cardBg = Color.parseColor("#23272D"),
        border = Color.parseColor("#31353C"),
        inputBg = Color.parseColor("#1D2024"),
        text = Color.parseColor("#E8EAED"),
        muted = Color.parseColor("#A0A7B2"),
        accent = accent,
        onAccent = Color.parseColor("#F5F7FA"),
        chipBg = Color.parseColor("#1D2024"),
        chipBorder = Color.parseColor("#31353C"),
        accentSoftBg = withAlpha(accent, 56),
        accentSoftBorder = withAlpha(accent, 145),
        priorityMedium = Color.parseColor("#F59E0B"),
        priorityHigh = Color.parseColor("#F87171")
      )
    } else {
      Palette(
        isDark = false,
        cardBg = Color.parseColor("#FFFFFF"),
        border = Color.parseColor("#E6E9EE"),
        inputBg = Color.parseColor("#F3F5F8"),
        text = Color.parseColor("#1D2129"),
        muted = Color.parseColor("#5C6675"),
        accent = accent,
        onAccent = Color.parseColor("#FFFFFF"),
        chipBg = Color.parseColor("#F3F5F8"),
        chipBorder = Color.parseColor("#E6E9EE"),
        accentSoftBg = withAlpha(accent, 30),
        accentSoftBorder = withAlpha(accent, 115),
        priorityMedium = Color.parseColor("#D97706"),
        priorityHigh = Color.parseColor("#DC2626")
      )
    }
  }

  private fun applyUriParams(uri: Uri?) {
    val rawKind = uri?.getQueryParameter("kind")?.trim()?.lowercase(Locale.US)
    kind = if (rawKind == KIND_HABIT) KIND_HABIT else KIND_TASK

    val rawWidget = uri?.getQueryParameter("widget")?.trim()
    widgetName = if (!rawWidget.isNullOrEmpty()) rawWidget else DEFAULT_WIDGET

    val rawDate = uri?.getQueryParameter("defaultDate")?.trim()
    val parsedIso = parseIsoDate(rawDate)
    if (parsedIso != null) {
      val normalizedIso = formatIsoDate(parsedIso.first, parsedIso.second, parsedIso.third)
      explicitDate = normalizedIso
      selectedDate = normalizedIso
    } else {
      explicitDate = null
      selectedDate = when (rawDate?.lowercase(Locale.US)) {
        DATE_TOMORROW -> DATE_TOMORROW
        DATE_EVENING -> DATE_EVENING
        DATE_NONE -> DATE_NONE
        else -> DATE_TODAY
      }
    }
  }

  private fun buildUi() {
    val outerHorizontal = dp(16)
    val outerVertical = dp(14)

    rootContainer = FrameLayout(this).apply {
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      setPadding(outerHorizontal, outerVertical, outerHorizontal, outerVertical)
      isClickable = true
      isFocusable = false
      contentDescription = "빠른 추가 닫기"
      setOnClickListener { dismissOverlay() }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      rootContainer.setOnApplyWindowInsetsListener { view, insets ->
        val barsAndIme = insets.getInsets(
          WindowInsets.Type.systemBars() or
            WindowInsets.Type.ime() or
            WindowInsets.Type.displayCutout()
        )
        view.setPadding(
          outerHorizontal + barsAndIme.left,
          outerVertical + barsAndIme.top,
          outerHorizontal + barsAndIme.right,
          outerVertical + barsAndIme.bottom
        )
        WindowInsets.CONSUMED
      }
    }

    cardContainer = MaxWidthLinearLayout(this, dp(MAX_CARD_WIDTH_DP)).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      )
      setPadding(dp(16), dp(14), dp(16), dp(12))
      background = roundedRect(
        fillColor = palette.cardBg,
        strokeColor = palette.border,
        strokeWidthPx = dp(1),
        radiusPx = dp(20).toFloat()
      )
      elevation = dp(12).toFloat()
      isClickable = true
      isFocusable = true
    }

    // Header row
    val headerRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      )
    }

    val titleColumn = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        0,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        1f
      )
    }

    titleView = TextView(this).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      setTypeface(Typeface.DEFAULT_BOLD)
      setTextColor(palette.text)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }

    subtitleView = TextView(this).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      setTextColor(palette.muted)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(2)
      }
      visibility = View.GONE
    }

    titleColumn.addView(titleView)
    titleColumn.addView(subtitleView)

    detailButton = TextView(this).apply {
      text = "앱에서 자세히"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
      setTextColor(palette.muted)
      setPadding(dp(8), dp(6), dp(4), dp(6))
      isClickable = true
      isFocusable = true
      contentDescription = "앱에서 자세히 입력"
      setOnClickListener { openFullEditorInApp() }
    }

    headerRow.addView(titleColumn)
    headerRow.addView(detailButton)
    cardContainer.addView(headerRow)

    // Input field
    inputField = EditText(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(10)
      }
      setPadding(dp(14), dp(12), dp(14), dp(12))
      background = roundedRect(
        fillColor = palette.inputBg,
        strokeColor = palette.border,
        strokeWidthPx = dp(1),
        radiusPx = dp(12).toFloat()
      )
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f)
      setTextColor(palette.text)
      setHintTextColor(withAlpha(palette.muted, 190))
      isSingleLine = true
      maxLines = 1
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI
      isFocusable = true
      isFocusableInTouchMode = true

      setOnEditorActionListener { _, actionId, _ ->
        when (actionId) {
          EditorInfo.IME_ACTION_DONE,
          EditorInfo.IME_ACTION_SEND,
          EditorInfo.IME_ACTION_GO -> {
            submitIfValid()
            true
          }
          else -> false
        }
      }

      setOnKeyListener { _, keyCode, event ->
        if (keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
          if (event != null && !event.isShiftPressed) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
              submitIfValid()
            }
            return@setOnKeyListener true
          }
        }
        false
      }

      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
        override fun afterTextChanged(s: Editable?) {
          updateSubmitButtonState()
        }
      })
    }
    cardContainer.addView(inputField)

    // Interactive chips row (date chips + priority pill, shown for tasks)
    chipScrollView = HorizontalScrollView(this).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(10)
      }
      isHorizontalScrollBarEnabled = false
      overScrollMode = View.OVER_SCROLL_NEVER
    }

    chipRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    }
    chipScrollView.addView(chipRow)
    cardContainer.addView(chipScrollView)

    // Bottom action row
    val actionRow = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        topMargin = dp(12)
      }
    }

    keepOpenChip = createPillChip("계속 추가").apply {
      contentDescription = "계속 추가 토글"
      setOnClickListener {
        keepOpen = !keepOpen
        updateKeepOpenChipStyle()
      }
    }

    val spacer = View(this).apply {
      layoutParams = LinearLayout.LayoutParams(0, 1, 1f)
    }

    cancelButton = TextView(this).apply {
      text = "취소"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTextColor(palette.muted)
      setPadding(dp(12), dp(9), dp(12), dp(9))
      isClickable = true
      isFocusable = true
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        marginEnd = dp(6)
      }
      setOnClickListener { dismissOverlay() }
    }

    submitButton = TextView(this).apply {
      text = "추가"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTypeface(Typeface.DEFAULT_BOLD)
      setTextColor(palette.onAccent)
      gravity = Gravity.CENTER
      setPadding(dp(18), dp(9), dp(18), dp(9))
      background = roundedRect(
        fillColor = palette.accent,
        strokeColor = Color.TRANSPARENT,
        strokeWidthPx = 0,
        radiusPx = dp(999).toFloat()
      )
      isClickable = true
      isFocusable = true
      setOnClickListener { submitIfValid() }
    }

    actionRow.addView(keepOpenChip)
    actionRow.addView(spacer)
    actionRow.addView(cancelButton)
    actionRow.addView(submitButton)
    cardContainer.addView(actionRow)

    rootContainer.addView(cardContainer)
    setContentView(rootContainer)
  }

  private fun refreshUiForState() {
    val isHabit = kind == KIND_HABIT
    titleView.text = if (isHabit) "습관 빠르게 추가" else "할 일 빠른 추가"
    inputField.hint = if (isHabit) {
      "습관 이름 (예: 아침 스트레칭)"
    } else {
      "할 일을 입력하세요 (예: 내일 7시 운동 #건강 !!!)"
    }

    val explicitSubtitle = if (!isHabit) formatKoreanDateSubtitle(explicitDate) else null
    if (explicitSubtitle != null) {
      subtitleView.text = explicitSubtitle
      subtitleView.visibility = View.VISIBLE
    } else {
      subtitleView.visibility = View.GONE
    }

    if (isHabit) {
      chipScrollView.visibility = View.GONE
    } else {
      chipScrollView.visibility = View.VISIBLE
      rebuildTaskChips()
    }

    updateKeepOpenChipStyle()
  }

  private fun rebuildTaskChips() {
    chipRow.removeAllViews()
    dateChipViews.clear()

    val options = mutableListOf<DateOption>()
    val explicit = explicitDate
    val explicitParsed = parseIsoDate(explicit)
    if (explicit != null && explicitParsed != null) {
      val chipLabel = String.format(Locale.US, "%02d/%02d", explicitParsed.second, explicitParsed.third)
      options.add(DateOption(explicit, chipLabel))
    }
    options.add(DateOption(DATE_TODAY, "오늘"))
    options.add(DateOption(DATE_TOMORROW, "내일"))
    options.add(DateOption(DATE_EVENING, "저녁 7시"))
    options.add(DateOption(DATE_NONE, "날짜 없음"))

    for (option in options) {
      val chip = createPillChip(option.label).apply {
        layoutParams = LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
          marginEnd = dp(6)
        }
        setOnClickListener {
          selectedDate = option.value
          updateDateChipStyles()
        }
      }
      dateChipViews[option.value] = chip
      chipRow.addView(chip)
    }

    val priorityChip = createPillChip(priorityLabel(priority)).apply {
      contentDescription = "우선순위 변경"
      setOnClickListener {
        priority = if (priority >= PRIORITY_URGENT) PRIORITY_NORMAL else priority + 1
        updatePriorityChipStyle()
      }
    }
    priorityChipView = priorityChip
    chipRow.addView(priorityChip)

    updateDateChipStyles()
    updatePriorityChipStyle()
  }

  private fun createPillChip(label: String): TextView {
    return TextView(this).apply {
      text = label
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
      gravity = Gravity.CENTER
      setPadding(dp(11), dp(6), dp(11), dp(6))
      isClickable = true
      isFocusable = true
    }
  }

  private fun updateDateChipStyles() {
    for ((value, chip) in dateChipViews) {
      val selected = value == selectedDate
      applyAccentToggleChipStyle(chip, selected)
    }
  }

  private fun updatePriorityChipStyle() {
    val chip = priorityChipView ?: return
    chip.text = priorityLabel(priority)
    if (priority > PRIORITY_NORMAL) {
      chip.setTextColor(palette.text)
      chip.setTypeface(Typeface.DEFAULT_BOLD)
      chip.background = roundedRect(
        fillColor = palette.inputBg,
        strokeColor = if (priority == PRIORITY_URGENT) palette.text else palette.border,
        strokeWidthPx = dp(1),
        radiusPx = dp(999).toFloat()
      )
    } else {
      chip.setTextColor(palette.muted)
      chip.setTypeface(Typeface.DEFAULT)
      chip.background = roundedRect(
        fillColor = palette.chipBg,
        strokeColor = palette.chipBorder,
        strokeWidthPx = dp(1),
        radiusPx = dp(999).toFloat()
      )
    }
  }

  private fun updateKeepOpenChipStyle() {
    keepOpenChip.text = if (keepOpen) "✓ 계속 추가" else "계속 추가"
    applyAccentToggleChipStyle(keepOpenChip, keepOpen)
  }

  private fun applyAccentToggleChipStyle(chip: TextView, selected: Boolean) {
    if (selected) {
      chip.setTextColor(palette.accent)
      chip.setTypeface(Typeface.DEFAULT_BOLD)
      chip.background = roundedRect(
        fillColor = palette.accentSoftBg,
        strokeColor = palette.accentSoftBorder,
        strokeWidthPx = dp(1),
        radiusPx = dp(999).toFloat()
      )
    } else {
      chip.setTextColor(palette.muted)
      chip.setTypeface(Typeface.DEFAULT)
      chip.background = roundedRect(
        fillColor = palette.chipBg,
        strokeColor = palette.chipBorder,
        strokeWidthPx = dp(1),
        radiusPx = dp(999).toFloat()
      )
    }
  }

  private fun updateSubmitButtonState() {
    val hasText = !inputField.text?.toString()?.trim().isNullOrEmpty()
    submitButton.isEnabled = hasText
    submitButton.alpha = if (hasText) 1f else 0.42f
  }

  private fun submitIfValid() {
    if (isFinishing || isDestroyed) return
    val trimmed = inputField.text?.toString()?.trim().orEmpty()
    if (trimmed.isEmpty()) return

    val isHabit = kind == KIND_HABIT
    val clickActionData = Bundle().apply {
      if (isHabit) {
        putString("name", trimmed)
        putString("widget", widgetName)
      } else {
        putString("text", trimmed)
        putString("defaultDate", selectedDate)
        putString("priority", priority.toString())
        putString("widget", widgetName)
      }
    }

    val dispatched = dispatchWidgetQuickAddBroadcast(
      clickAction = if (isHabit) ACTION_QUICK_ADD_HABIT else ACTION_QUICK_ADD,
      clickActionData = clickActionData
    )
    if (!dispatched) {
      Toast.makeText(applicationContext, "위젯을 찾을 수 없습니다", Toast.LENGTH_SHORT).show()
      return
    }

    val toastMessage = if (isHabit) "습관을 추가했습니다" else "할 일을 추가했습니다"
    Toast.makeText(applicationContext, toastMessage, Toast.LENGTH_SHORT).show()

    if (keepOpen) {
      inputField.setText("")
      if (!isHabit && priority != PRIORITY_NORMAL) {
        priority = PRIORITY_NORMAL
        updatePriorityChipStyle()
      }
      updateSubmitButtonState()
      // Reset active IME composing buffer so Hangul syllables do not carry over to the next entry.
      val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.restartInput(inputField)
      focusInputAndShowKeyboard()
    } else {
      dismissOverlay()
    }
  }

  private fun dispatchWidgetQuickAddBroadcast(
    clickAction: String,
    clickActionData: Bundle
  ): Boolean {
    val appWidgetManager = AppWidgetManager.getInstance(this)
    val targetComponent = findTargetWidgetProvider(appWidgetManager, widgetName) ?: return false
    val firstWidgetId = runCatching {
      appWidgetManager.getAppWidgetIds(targetComponent).firstOrNull()
    }.getOrNull() ?: -1

    val broadcast = Intent("${packageName}.WIDGET_CLICK").apply {
      component = targetComponent
      setPackage(packageName)
      putExtra("widgetId", firstWidgetId)
      putExtra("clickAction", clickAction)
      putExtra("clickActionData", clickActionData)
    }
    sendBroadcast(broadcast)
    return true
  }

  private fun findTargetWidgetProvider(
    appWidgetManager: AppWidgetManager,
    preferredWidgetName: String
  ): ComponentName? {
    val ownProviders = appWidgetManager.installedProviders
      .orEmpty()
      .mapNotNull { it.provider }
      .filter { it.packageName == packageName }

    if (ownProviders.isEmpty()) return null

    val preferredSuffix = ".$preferredWidgetName"
    return ownProviders.firstOrNull {
      it.shortClassName.endsWith(preferredSuffix) || it.className.endsWith(preferredSuffix)
    } ?: ownProviders.firstOrNull {
      it.shortClassName.endsWith(preferredSuffix, ignoreCase = true) ||
        it.className.endsWith(preferredSuffix, ignoreCase = true)
    } ?: ownProviders.firstOrNull {
      it.shortClassName.endsWith(".$DEFAULT_WIDGET") || it.className.endsWith(".$DEFAULT_WIDGET")
    } ?: ownProviders.first()
  }

  private fun openFullEditorInApp() {
    hideKeyboard()
    val uriString = if (kind == KIND_HABIT) "dayframe:///habit/new" else "dayframe:///add"
    val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(uriString)).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    runCatching { startActivity(openIntent) }
    dismissOverlay()
  }

  private fun focusInputAndShowKeyboard() {
    inputField.requestFocus()
    inputField.post {
      if (isFinishing || isDestroyed) return@post
      inputField.requestFocus()
      val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.showSoftInput(inputField, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  private fun hideKeyboard() {
    val token = if (::inputField.isInitialized) inputField.windowToken else window?.decorView?.windowToken
    if (token != null) {
      val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.hideSoftInputFromWindow(token, 0)
    }
  }

  private fun dismissOverlay() {
    hideKeyboard()
    finish()
  }

  @Suppress("DEPRECATION")
  override fun finish() {
    super.finish()
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      overridePendingTransition(0, 0)
    }
  }

  private fun roundedRect(
    fillColor: Int,
    strokeColor: Int,
    strokeWidthPx: Int,
    radiusPx: Float
  ): GradientDrawable {
    return GradientDrawable().apply {
      shape = GradientDrawable.RECTANGLE
      cornerRadius = radiusPx
      setColor(fillColor)
      if (strokeWidthPx > 0) {
        setStroke(strokeWidthPx, strokeColor)
      }
    }
  }

  private fun dp(value: Int): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      resources.displayMetrics
    ).toInt()
  }

  private class MaxWidthLinearLayout(
    context: Context,
    private val maxWidthPx: Int
  ) : LinearLayout(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      val widthSize = MeasureSpec.getSize(widthMeasureSpec)
      val widthMode = MeasureSpec.getMode(widthMeasureSpec)
      val clampedSpec = if (maxWidthPx > 0 && widthSize > maxWidthPx) {
        val nextMode = if (widthMode == MeasureSpec.UNSPECIFIED) MeasureSpec.AT_MOST else widthMode
        MeasureSpec.makeMeasureSpec(maxWidthPx, nextMode)
      } else {
        widthMeasureSpec
      }
      super.onMeasure(clampedSpec, heightMeasureSpec)
    }
  }

  private companion object {
    private const val MAX_CARD_WIDTH_DP = 460

    private const val KIND_TASK = "task"
    private const val KIND_HABIT = "habit"
    private const val DEFAULT_WIDGET = "Today"

    private const val DATE_TODAY = "today"
    private const val DATE_TOMORROW = "tomorrow"
    private const val DATE_EVENING = "evening"
    private const val DATE_NONE = "none"

    private const val PRIORITY_NORMAL = 1
    private const val PRIORITY_LOW_HIGH = 2
    private const val PRIORITY_HIGH = 3
    private const val PRIORITY_URGENT = 4

    private const val ACTION_QUICK_ADD = "QUICK_ADD"
    private const val ACTION_QUICK_ADD_HABIT = "QUICK_ADD_HABIT"

    private const val DEFAULT_ACCENT_LIGHT = "#2B66E0"
    private const val DEFAULT_ACCENT_DARK = "#3B6CD0"

    private const val STATE_KIND = "kind"
    private const val STATE_WIDGET = "widget"
    private const val STATE_EXPLICIT_DATE = "explicit_date"
    private const val STATE_SELECTED_DATE = "selected_date"
    private const val STATE_PRIORITY = "priority"
    private const val STATE_KEEP_OPEN = "keep_open"
    private const val STATE_INPUT_TEXT = "input_text"

    private val ISO_DATE_REGEX = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val KOREAN_WEEKDAYS = arrayOf("", "일", "월", "화", "수", "목", "금", "토")

    private fun parseColorOrNull(hex: String?): Int? {
      val trimmed = hex?.trim()
      if (trimmed.isNullOrEmpty()) return null
      return runCatching { Color.parseColor(trimmed) }.getOrNull()
    }

    private fun withAlpha(color: Int, alpha: Int): Int {
      return Color.argb(
        alpha.coerceIn(0, 255),
        Color.red(color),
        Color.green(color),
        Color.blue(color)
      )
    }

    private fun priorityLabel(level: Int): String = when (level) {
      PRIORITY_LOW_HIGH -> "!"
      PRIORITY_HIGH -> "!!"
      PRIORITY_URGENT -> "!!!"
      else -> "보통"
    }

    private fun parseIsoDate(raw: String?): Triple<Int, Int, Int>? {
      val value = raw?.trim() ?: return null
      if (!ISO_DATE_REGEX.matches(value)) return null
      val parts = value.split("-")
      val year = parts[0].toIntOrNull() ?: return null
      val month = parts[1].toIntOrNull() ?: return null
      val day = parts[2].toIntOrNull() ?: return null
      if (month !in 1..12 || day !in 1..31) return null
      val calendar = Calendar.getInstance().apply {
        isLenient = false
        clear()
        set(year, month - 1, day)
      }
      val valid = runCatching {
        calendar.get(Calendar.YEAR) == year &&
          calendar.get(Calendar.MONTH) == month - 1 &&
          calendar.get(Calendar.DAY_OF_MONTH) == day
      }.getOrDefault(false)
      return if (valid) Triple(year, month, day) else null
    }

    private fun formatIsoDate(year: Int, month: Int, day: Int): String {
      return String.format(Locale.US, "%04d-%02d-%02d", year, month, day)
    }

    private fun formatKoreanDateSubtitle(isoDate: String?): String? {
      val parsed = parseIsoDate(isoDate) ?: return null
      val (year, month, day) = parsed
      val calendar = Calendar.getInstance().apply {
        clear()
        set(year, month - 1, day)
      }
      val dow = calendar.get(Calendar.DAY_OF_WEEK)
      val weekday = KOREAN_WEEKDAYS.getOrNull(dow).orEmpty()
      return if (weekday.isNotEmpty()) {
        "${year}년 ${month}월 ${day}일 ($weekday)"
      } else {
        "${year}년 ${month}월 ${day}일"
      }
    }
  }
}
