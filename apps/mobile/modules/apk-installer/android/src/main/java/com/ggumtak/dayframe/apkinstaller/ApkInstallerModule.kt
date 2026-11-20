package com.ggumtak.dayframe.apkinstaller

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

/**
 * The few package-installer calls the in-app updater needs and Expo's own modules do not expose:
 * whether this app may install packages, the settings page that grants it, a look inside a
 * downloaded APK before it is offered to the user, and the install prompt itself.
 */
class ApkInstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("DayframeApkInstaller")

    Function("canInstallPackages") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallPermissionSettings") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
      } else {
        Intent(Settings.ACTION_SECURITY_SETTINGS)
      }
      appContext.throwingActivity.startActivity(intent)
    }

    Function("inspect") { fileUri: String ->
      val path = Uri.parse(fileUri).path ?: fileUri
      val packages = context.packageManager
      val archive = packages.getPackageArchiveInfo(path, signingFlags())
      if (archive == null) {
        null
      } else {
        val installed = packages.getPackageInfo(context.packageName, signingFlags())
        val archiveSigners = signerDigests(archive)
        val installedSigners = signerDigests(installed)
        mapOf(
          "packageName" to archive.packageName,
          "versionCode" to versionCode(archive).toDouble(),
          "versionName" to archive.versionName,
          // Null when the platform could not read the archive's certificates; the installer still checks them.
          "signerMatches" to if (archiveSigners.isEmpty() || installedSigners.isEmpty()) {
            null
          } else {
            archiveSigners.any { installedSigners.contains(it) }
          }
        )
      }
    }

    Function("install") { contentUri: String ->
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(contentUri), "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      appContext.throwingActivity.startActivity(intent)
    }
  }

  @Suppress("DEPRECATION")
  private fun signingFlags(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      PackageManager.GET_SIGNING_CERTIFICATES
    } else {
      PackageManager.GET_SIGNATURES
    }

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  @Suppress("DEPRECATION")
  private fun signerDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signing = info.signingInfo
      when {
        signing == null -> null
        signing.hasMultipleSigners() -> signing.apkContentsSigners
        else -> signing.signingCertificateHistory
      }
    } else {
      info.signatures
    }
    return signatures.orEmpty().map { signature ->
      MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).joinToString("") { "%02x".format(it) }
    }.toSet()
  }
}
