package expo.modules.storystorage
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import java.io.File
import androidx.work.*
import org.json.JSONObject
class StoryStorageModule : Module() {
 override fun definition() = ModuleDefinition {
  Name("StoryStorage")
  AsyncFunction("enqueue") { json:String ->
   val context=requireNotNull(appContext.reactContext);val spec=JSONObject(json);val id=spec.getString("id")
   require(Regex("^[a-f0-9]{64}$").matches(id))
   require(spec.optString("extension","mp3") in listOf("mp3","png","jpg"))
   require(Uri.parse(spec.getString("url")).scheme in listOf("http","https"))
   val preferences=StoryDownloadWorker.prefs(context);val prior=JSONObject(preferences.getString(id,"{}") ?: "{}")
   val manager=WorkManager.getInstance(context)
   val existing=manager.getWorkInfosForUniqueWork("story-$id").get().any{!it.state.isFinished}
   if(!existing && !(prior.optString("state")=="complete" && File(context.noBackupFilesDir,"StoryMedia/$id."+spec.optString("extension","mp3")).exists())) {
    spec.put("state","queued");spec.put("bytesWritten",0);preferences.edit().putString(id,spec.toString()).commit()
    val constraints=Constraints.Builder().setRequiredNetworkType(if(spec.optBoolean("wifiOnly",true))NetworkType.UNMETERED else NetworkType.CONNECTED).build()
    val work=OneTimeWorkRequestBuilder<StoryDownloadWorker>().setInputData(workDataOf("id" to id)).setConstraints(constraints).addTag("story-media").build()
    manager.enqueueUniqueWork("story-$id",ExistingWorkPolicy.KEEP,work)
   }
  }
  AsyncFunction("playbackUrl") { id:String ->
   require(Regex("^[a-f0-9]{64}$").matches(id))
   SharedPlayback.get(requireNotNull(appContext.reactContext)).url(id)
  }
  AsyncFunction("transferStatus") { id:String ->
   val json=JSONObject(StoryDownloadWorker.prefs(requireNotNull(appContext.reactContext)).getString(id,"{\"state\":\"missing\"}") ?: "{}")
   json.keys().asSequence().associateWith { json.get(it) }
  }
  AsyncFunction("pauseTransfer") { id:String ->
   val context=requireNotNull(appContext.reactContext);WorkManager.getInstance(context).cancelUniqueWork("story-$id").result.get()
  }
  AsyncFunction("forgetTransfer") { id:String -> StoryDownloadWorker.prefs(requireNotNull(appContext.reactContext)).edit().remove(id).commit() }
  AsyncFunction("retainTransfers") { ids:List<String> ->
   val context=requireNotNull(appContext.reactContext);val manager=WorkManager.getInstance(context)
   for(id in StoryDownloadWorker.prefs(context).all.keys)if(!ids.contains(id))manager.cancelUniqueWork("story-$id").result.get()
  }
  AsyncFunction("root") {
   val context = requireNotNull(appContext.reactContext)
   val dir = File(context.noBackupFilesDir, "StoryMedia")
   check(dir.exists() || dir.mkdirs())
   Uri.fromFile(dir).toString() + "/"
  }
  AsyncFunction("unconstrainedWifi") {
   val context = requireNotNull(appContext.reactContext)
   val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
   val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
   capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) && manager.restrictBackgroundStatus != ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
  }
 }
}
