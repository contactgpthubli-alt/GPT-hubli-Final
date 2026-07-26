package com.gpthubli.student;

import android.app.DownloadManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor shell with download support for PDF / files from the WebView.
 * Without a DownloadListener, Android silently ignores download attempts.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Defer until bridge/WebView is ready
        getBridge().getWebView().post(() -> {
            WebView webView = getBridge().getWebView();
            if (webView == null) return;

            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    // blob: / data: cannot go through DownloadManager — open share intent via browser
                    if (url != null && (url.startsWith("blob:") || url.startsWith("data:"))) {
                        Intent view = new Intent(Intent.ACTION_VIEW);
                        view.setDataAndType(Uri.parse(url), mimetype != null ? mimetype : "application/pdf");
                        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try {
                            startActivity(view);
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this, "Use Share / Save in the app PDF preview", Toast.LENGTH_LONG).show();
                        }
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
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(request);
                        Toast.makeText(MainActivity.this, "Downloading " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    try {
                        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(browser);
                    } catch (Exception e2) {
                        Toast.makeText(MainActivity.this, "Download failed — use Share in app", Toast.LENGTH_LONG).show();
                    }
                }
            });
        });
    }
}
