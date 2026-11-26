package com.stormcore.rift;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final String GAME_HOST = "appassets.androidplatform.net";
    private static final String GAME_PATH = "/stormcore.html";
    private static final String GAME_URL = "https://" + GAME_HOST + GAME_PATH;
    private static final Pattern PILOT_CODE =
        Pattern.compile("^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$");

    private WebView gameView;
    private AlertDialog loadError;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        openGame();
    }

    private void openGame() {
        WebView view = new WebView(this);
        view.setBackgroundColor(Color.rgb(10, 8, 16));
        view.setFocusableInTouchMode(true);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        view.addJavascriptInterface(new ClipboardBridge(), "StormcoreAndroid");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!GAME_HOST.equals(uri.getHost())) return null;
                if (isGame(uri) && "GET".equals(request.getMethod())) {
                    try {
                        return new WebResourceResponse("text/html", "UTF-8", getAssets().open("stormcore.html"));
                    } catch (IOException ignored) {
                        return emptyResponse();
                    }
                }
                return emptyResponse();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                return !isGame(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showLoadError();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail info) {
                setContentView(new View(MainActivity.this));
                view.destroy();
                gameView = null;
                showLoadError();
                return true;
            }
        });
        gameView = view;
        setContentView(view);
        view.requestFocus();
        hideBars();
        view.loadUrl(GAME_URL);
    }

    private static boolean isGame(Uri uri) {
        return "https".equals(uri.getScheme()) && GAME_HOST.equals(uri.getHost())
            && GAME_PATH.equals(uri.getPath());
    }

    private static WebResourceResponse emptyResponse() {
        return new WebResourceResponse(
            "text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0])
        );
    }

    private void showLoadError() {
        if (loadError != null && loadError.isShowing()) return;
        loadError = new AlertDialog.Builder(this)
            .setTitle("Игра не загрузилась")
            .setMessage("Для вылета нужен актуальный Android System WebView с поддержкой WebGL 2.")
            .setPositiveButton("Повторить", (dialog, which) -> {
                if (gameView != null) gameView.reload();
                else openGame();
            })
            .setNegativeButton("Закрыть", (dialog, which) -> finish())
            .show();
    }

    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) hideBars();
    }

    @Override
    public void onPause() {
        if (gameView != null) gameView.onPause();
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (gameView != null) gameView.onResume();
    }

    @Override
    public void onBackPressed() {
        if (gameView == null) {
            super.onBackPressed();
            return;
        }
        gameView.evaluateJavascript(
            "(function(){const dialog=document.querySelector('dialog[open]');" +
            "if(dialog){if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();return true;}" +
            "const game=document.getElementById('game');" +
            "if(!game || game.hidden)return false;" +
            "document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape'}));return true;})()",
            handled -> { if (!"true".equals(handled)) super.onBackPressed(); }
        );
    }

    @Override
    public void onDestroy() {
        if (gameView != null) {
            setContentView(new View(this));
            gameView.destroy();
            gameView = null;
        }
        super.onDestroy();
    }

    public final class ClipboardBridge {
        @JavascriptInterface
        public void copyCode(String code) {
            if (code == null || code.length() > 40 || !PILOT_CODE.matcher(code).matches()) return;
            runOnUiThread(() -> {
                ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Stormcore", code));
            });
        }
    }
}
