package app.microteams.microteams

import android.os.Build
import android.os.Bundle
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.annotation.NonNull
import io.flutter.FlutterInjector
import io.flutter.embedding.android.FlutterTextureView
import io.flutter.embedding.android.FlutterView
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor

/**
 * DISPOSABLE SPIKE. Delete this file, SpikeNativeScroll.kt, the `<activity>` entry in
 * AndroidManifest.xml and `app/lib/src/spike/` together once the question below is answered.
 *
 * THE QUESTION: scrolling in the Flutter app is reported to be visibly rougher than WeChat on a
 * low-end Android phone. Is it meaningfully smoother when ANDROID owns the scroll gesture and
 * Flutter only renders content? This is variant B — the experiment. Variant A, the control, is an
 * ordinary Flutter ListView on the Dart side.
 *
 * The shape is the whole idea: a native header, then a plain [ScrollView] whose single child is a
 * [FlutterView] about three screens tall, running a second Dart entrypoint that paints every row
 * once. Android then pans over an already-rendered surface and Flutter does no per-frame work.
 *
 * Three details are load-bearing:
 *
 *  1. RENDER MODE MUST BE TEXTURE. Flutter's default FlutterView renders into a SurfaceView, which
 *     is a separate window layer: it does not translate with its parent, so inside a ScrollView it
 *     smears, lags a frame behind, or stays nailed to the screen while the content moves. Built
 *     here from an explicit [FlutterTextureView], which is an ordinary view a ScrollView can move.
 *     This costs something — a TextureView-backed Flutter is somewhat slower to render than a
 *     SurfaceView-backed one — so variant B is competing with a handicap the production app does
 *     not have. That asymmetry is stated in the PR rather than buried here.
 *  2. The engine runs `main` with an argument rather than a second entrypoint. Both secondary-
 *     entrypoint spellings produced a blank view on a real release build with nothing in any log,
 *     and `main` is the one name a release build certainly resolves — see the call site.
 *  3. The Flutter side must be told the app is resumed, or the engine renders nothing at all. A
 *     FlutterActivity does that for you; a hand-built FlutterView does not.
 */
/** The flag `main` looks for in its own arguments to know it is variant B. Matches lib/main.dart. */
const val SPIKE_ENTRY_ARG = "--spike-native-scroll"

class SpikeNativeScrollActivity : android.app.Activity() {
    private var engine: FlutterEngine? = null
    private var flutterView: FlutterView? = null
    private var meter: NativeFrameMeter? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val engine = FlutterEngine(this)
        // `main`, with an ARGUMENT — not a second entrypoint of its own.
        //
        // Two earlier spellings both produced a blank FlutterView on a release build with nothing
        // in any log: naming a library URI plus a function, and naming a bare secondary function.
        // Whatever the reason, a secondary entrypoint is the part of this that is hard to verify
        // from here and easy to get silently wrong in AOT — so it is gone. `main` is the one
        // entrypoint a release build is guaranteed to resolve, and Dart reads the flag out of its
        // own arguments to decide which app to run (see lib/main.dart). Nothing about the
        // hypothesis being tested needs a separate entrypoint; that was incidental.
        engine.dartExecutor.executeDartEntrypoint(
            DartExecutor.DartEntrypoint(
                FlutterInjector.instance().flutterLoader().findAppBundlePath(),
                "main",
            ),
            listOf(SPIKE_ENTRY_ARG),
        )
        this.engine = engine

        val view = FlutterView(this, FlutterTextureView(this))
        this.flutterView = view

        // Three screens tall. Not "very tall": the point is a surface Flutter can realistically
        // paint in one go, and an enormous texture would be measuring the GPU's memory bandwidth
        // instead of the hypothesis.
        val screenHeight = resources.displayMetrics.heightPixels
        val surfaceHeight = screenHeight * 3

        val scroller = ScrollView(this).apply {
            isFillViewport = false
            // Left off deliberately: the overscroll glow is drawn by Android over the texture and
            // would be one more difference between the two variants.
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(
                view,
                ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, surfaceHeight),
            )
        }

        val header = TextView(this).apply {
            // Starts as a QUESTION, not a label. A blank variant B has two completely different
            // causes — the Dart entrypoint never ran, or it ran and the texture is not reaching the
            // screen — and from a phone with no adb attached they look identical. The first-frame
            // listener below turns this line into the answer.
            text = "B — waiting for the first Flutter frame…"
            setPadding(24, 24, 24, 24)
            setBackgroundColor(0xFF202020.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 12f
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(
                header,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
            addView(
                scroller,
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f),
            )
        }

        val readout = TextView(this).apply {
            setPadding(28, 18, 28, 28)
            setBackgroundColor(0xD1000000.toInt())
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
        }
        val reset = Button(this).apply { text = "reset" }

        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(
                readout,
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
            )
            addView(reset)
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFFEDEDED.toInt())
            addView(
                column,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            addView(
                overlay,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.BOTTOM,
                ),
            )
        }
        setContentView(root)

        val meter = NativeFrameMeter(readout, refreshHz())
        reset.setOnClickListener { meter.reset() }
        this.meter = meter

        // Said out loud on screen, because the alternative is a white rectangle that means three
        // different things. If this fires, Dart ran and painted and anything still wrong is about
        // the texture reaching the ScrollView; if it never fires, the entrypoint is the suspect and
        // nothing about the layout matters yet.
        view.addOnFirstFrameRenderedListener(
            object : io.flutter.embedding.engine.renderer.FlutterUiDisplayListener {
                override fun onFlutterUiDisplayed() {
                    header.text = "B — native ScrollView over a 3-screen-tall FlutterView (texture mode)"
                }

                override fun onFlutterUiNoLongerDisplayed() = Unit
            },
        )
        // A deadline, so "never" is distinguishable from "slow". Three seconds is far longer than a
        // second engine needs to paint its first frame on any phone this app runs on.
        header.postDelayed(
            {
                if (header.text.toString().startsWith("B — waiting")) {
                    header.text =
                        "B — NO Flutter frame after 3s: the second Dart entrypoint never painted"
                    header.setBackgroundColor(0xFF7F1D1D.toInt())
                }
            },
            3000L,
        )

        view.attachToFlutterEngine(engine)
        // Without this the engine sits in "detached" and never produces a frame: the ScrollView
        // would pan over a blank texture and the experiment would look like a catastrophic loss
        // rather than a wiring mistake.
        engine.lifecycleChannel.appIsResumed()
    }

    @Suppress("DEPRECATION")
    private fun refreshHz(): Float {
        val hz = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display?.refreshRate
        } else {
            windowManager.defaultDisplay.refreshRate
        }
        // A display that will not say is assumed to be 60Hz, and the readout prints what it used so
        // a wrong assumption is visible rather than silent.
        return if (hz == null || hz <= 0f) 60f else hz
    }

    override fun onResume() {
        super.onResume()
        engine?.lifecycleChannel?.appIsResumed()
        meter?.start()
    }

    override fun onPause() {
        super.onPause()
        meter?.stop()
        engine?.lifecycleChannel?.appIsInactive()
    }

    override fun onDestroy() {
        meter?.stop()
        flutterView?.detachFromFlutterEngine()
        // This engine belongs to this Activity alone — it is not in the FlutterEngineCache and
        // nothing else can reach it — so leaving it running would leak a whole isolate per visit.
        engine?.destroy()
        engine = null
        super.onDestroy()
    }
}

/**
 * DISPOSABLE SPIKE — the ruler for variant B.
 *
 * Flutter's own timings measure nothing interesting here: during a native pan the Dart side
 * produces no frames at all, so `addTimingsCallback` would report a suspiciously perfect zero. What
 * the user actually experiences is whether the DISPLAY kept up, so this counts inter-frame
 * intervals from [Choreographer] on the platform thread.
 *
 * The statistics are deliberately the same ones, computed the same way, as the Dart readout and as
 * `app/tool/measure-frames.mjs`: sample count, how many exceeded one refresh interval, and
 * percentiles picked as `sorted[floor(n * q)]`. Two rulers that disagree about what a percentile is
 * cannot be compared, and comparing is the only reason this exists.
 *
 * One honest limitation, stated here so nobody reads more into the number than it holds: a
 * Choreographer callback fires once per vsync whether or not anything was drawn, so a perfectly
 * idle screen also scores perfectly. These numbers only mean something while a finger is flicking.
 */
class NativeFrameMeter(
    @NonNull private val readout: TextView,
    private val refreshHz: Float,
) : Choreographer.FrameCallback {
    private val budgetMs = 1000f / refreshHz
    private val samples = ArrayList<Float>(4096)
    private var lastFrameNanos = 0L
    private var running = false
    private var shownBucket = -1

    fun start() {
        if (running) return
        running = true
        lastFrameNanos = 0L
        Choreographer.getInstance().postFrameCallback(this)
        render()
    }

    fun stop() {
        running = false
        Choreographer.getInstance().removeFrameCallback(this)
    }

    fun reset() {
        samples.clear()
        lastFrameNanos = 0L
        shownBucket = -1
        render()
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!running) return
        if (lastFrameNanos != 0L) {
            val deltaMs = (frameTimeNanos - lastFrameNanos) / 1_000_000f
            // A gap of a quarter second is the screen being idle or the Activity having been away,
            // not a dropped frame; counting it would let standing still look like stutter.
            if (deltaMs < 250f) samples.add(deltaMs)
        }
        lastFrameNanos = frameTimeNanos

        // Repainting the readout is itself work on the thread being measured, so it happens about
        // four times a second rather than every frame.
        val bucket = samples.size / 15
        if (bucket != shownBucket) {
            shownBucket = bucket
            render()
        }
        Choreographer.getInstance().postFrameCallback(this)
    }

    private fun percentile(q: Double): Float {
        if (samples.isEmpty()) return 0f
        val sorted = samples.sorted()
        val i = Math.floor(sorted.size * q).toInt().coerceIn(0, sorted.size - 1)
        return sorted[i]
    }

    private fun render() {
        val n = samples.size
        val over = samples.count { it > budgetMs }
        val pct = if (n == 0) 0 else Math.round(over * 100f / n)
        readout.text = String.format(
            "Android (Choreographer) — %.1fHz, budget %.1fms%n" +
                "frames %d   over budget %d (%d%%)%n" +
                "p50 %.1f  p90 %.1f  p99 %.1f  worst %.1f ms",
            refreshHz,
            budgetMs,
            n,
            over,
            pct,
            percentile(0.5),
            percentile(0.9),
            percentile(0.99),
            percentile(1.0),
        )
    }
}
