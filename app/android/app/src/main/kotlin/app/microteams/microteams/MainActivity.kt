package app.microteams.microteams

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // DISPOSABLE SPIKE — the only thing this override exists for. It lets the unlinked `/__scroll`
    // dev route open SpikeNativeScrollActivity, which is variant B of the "should Android own the
    // scroll gesture?" experiment. Delete this whole override along with SpikeNativeScrollActivity
    // .kt, the manifest entry and app/lib/src/spike/ once that question is answered; MainActivity
    // then goes back to being a one-liner.
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "app.microteams.microteams/spike_scroll",
        ).setMethodCallHandler { call, result ->
            if (call.method == "open") {
                startActivity(Intent(this, SpikeNativeScrollActivity::class.java))
                result.success(null)
            } else {
                result.notImplemented()
            }
        }
    }
}
