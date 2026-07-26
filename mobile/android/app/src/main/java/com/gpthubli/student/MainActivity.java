package com.gpthubli.student;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Capacitor shell:
 * - DownloadListener for WebView file downloads
 * - JS bridge to save base64 PDF and open system Share sheet
 * - Request notification permission on Android 13+
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_NOTIF = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestNotificationPermissionIfNeeded();

        getBridge().getWebView().post(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) return;

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

    /**
     * Exposed to WebView as window.GpthNative.savePdfBase64(filename, base64)
     * Saves under cache and opens Android Share / Save sheet.
     */
    public class GpthNativeBridge {
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

                // Also try public Downloads when possible
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
                    /* cache + share is enough */
                }

                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }
    }
}
