package com.gpthubli.student;

import android.Manifest;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Capacitor shell with:
 * - System notifications (status bar + default ringtone) via GpthNative
 * - PDF Share / Save via FileProvider
 * - DownloadListener for WebView file downloads
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_NOTIF = 1001;
    private static final String CH_ATTENDANCE = "gpth_attendance";
    private static final String CH_GENERAL = "gpth_general";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannels();
        requestNotificationPermissionIfNeeded();

        getBridge().getWebView().post(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) return;

            // Allow JS bridge for remote https://gpt-hubli-final.vercel.app origin
            webView.getSettings().setJavaScriptEnabled(true);
            webView.addJavascriptInterface(new GpthNativeBridge(), "GpthNative");

            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    if (url != null && (url.startsWith("blob:") || url.startsWith("data:"))) {
                        Toast.makeText(MainActivity.this,
                            "Use Share / Save in the PDF screen", Toast.LENGTH_LONG).show();
                        return;
                    }

                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimetype);
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) {
                        request.addRequestHeader("cookie", cookies);
                    }
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setDescription("Downloading " + fileName);
                    request.setTitle(fileName);
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(request);
                        Toast.makeText(MainActivity.this,
                            "Downloading " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    try {
                        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(browser);
                    } catch (Exception e2) {
                        Toast.makeText(MainActivity.this,
                            "Download failed — use Share in app", Toast.LENGTH_LONG).show();
                    }
                }
            });
        });
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel att = new NotificationChannel(
            CH_ATTENDANCE,
            "Attendance alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        att.setDescription("Absent marks and attendance alerts");
        att.enableVibration(true);
        att.setVibrationPattern(new long[]{0, 250, 120, 250});
        att.setSound(sound, audio);
        att.enableLights(true);
        att.setShowBadge(true);
        nm.createNotificationChannel(att);

        NotificationChannel gen = new NotificationChannel(
            CH_GENERAL,
            "GPT Hubli alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        gen.setDescription("General student notifications");
        gen.enableVibration(true);
        gen.setSound(sound, audio);
        gen.setShowBadge(true);
        nm.createNotificationChannel(gen);
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQ_NOTIF
                );
            }
        }
    }

    public class GpthNativeBridge {
        @JavascriptInterface
        public String requestNotificationPermission() {
            try {
                runOnUiThread(() -> requestNotificationPermissionIfNeeded());
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }

        /**
         * Post status-bar notification with default system notification ringtone.
         * Called from remote WebView JS: GpthNative.showNotification(title, body, id)
         */
        @JavascriptInterface
        public String showNotification(String title, String body, int id) {
            try {
                createNotificationChannels();

                if (Build.VERSION.SDK_INT >= 33) {
                    if (ContextCompat.checkSelfPermission(
                        MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                        runOnUiThread(() -> requestNotificationPermissionIfNeeded());
                        // Still try; may be blocked until user grants
                    }
                }

                Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (open == null) {
                    open = new Intent(MainActivity.this, MainActivity.class);
                }
                open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 23) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getActivity(
                    MainActivity.this, id > 0 ? id : 1, open, flags);

                Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

                NotificationCompat.Builder builder = new NotificationCompat.Builder(
                    MainActivity.this, CH_ATTENDANCE)
                    .setSmallIcon(R.drawable.ic_stat_icon_config_sample)
                    .setContentTitle(title != null ? title : "GPT Hubli")
                    .setContentText(body != null ? body : "")
                    .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText(body != null ? body : ""))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setAutoCancel(true)
                    .setSound(sound)
                    .setVibrate(new long[]{0, 250, 120, 250})
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setContentIntent(pi);

                NotificationManagerCompat.from(MainActivity.this)
                    .notify(id > 0 ? id : (int) (System.currentTimeMillis() % 100000), builder.build());

                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String savePdfBase64(String filename, String base64) {
            try {
                String name = filename == null || filename.trim().isEmpty()
                    ? "document.pdf"
                    : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (!name.toLowerCase().endsWith(".pdf")) name = name + ".pdf";

                String raw = base64;
                int comma = raw.indexOf(',');
                if (comma >= 0) raw = raw.substring(comma + 1);

                byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "pdf");
                if (!dir.exists()) dir.mkdirs();
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.close();

                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    out
                );

                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("application/pdf");
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.putExtra(Intent.EXTRA_SUBJECT, name);
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(share, "Save or share PDF");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);

                try {
                    File downloads = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                    if (downloads != null) {
                        if (!downloads.exists()) downloads.mkdirs();
                        File pub = new File(downloads, name);
                        FileOutputStream p = new FileOutputStream(pub);
                        p.write(bytes);
                        p.close();
                    }
                } catch (Exception ignored) {
                    /* share is enough */
                }

                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }
    }
}
