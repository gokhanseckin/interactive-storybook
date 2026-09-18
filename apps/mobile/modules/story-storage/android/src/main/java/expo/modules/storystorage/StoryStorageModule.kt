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
 companion object { private val requests = Any() }
 private fun pause(context:Context,id:String) {
  val generation=JSONObject(StoryDownloadWorker.prefs(context).getString(id,"{}") ?: "{}").optString("generation", "")
  WorkManager.getInstance(context).cancelUniqueWork("story-$id").result.get()
  // Cancellation acknowledgement alone does not close a Worker's file. Wait for
  // its per-asset writer lock before callers remove files or submit a new policy.
  val lock=StoryDownloadWorker.assetLocks.computeIfAbsent(id){java.util.concurrent.locks.ReentrantLock()}
  lock.lock()
  try { synchronized(StoryDownloadWorker::class.java) {
   val prefs=StoryDownloadWorker.prefs(context)
   val spec=JSONObject(prefs.getString(id,"{}") ?: "{}")
   if(spec.optString("generation", "")==generation && spec.optString("state") in listOf("queued","running")) {
    spec.put("state","paused");prefs.edit().putString(id,spec.toString()).commit()
   }
  } } finally { lock.unlock() }
 }
 override fun definition() = ModuleDefinition {
  Name("StoryStorage")
  AsyncFunction("enqueue") { json:String ->
   synchronized(requests) {
   val context=requireNotNull(appContext.reactContext);val spec=JSONObject(json);val id=spec.getString("id")
   require(spec.getLong("bytes") > 0)
   require(Regex("^[a-f0-9]{64}$").matches(id))
   require(spec.optString("extension","mp3") in listOf("mp3","png","jpg"))
   require(Uri.parse(spec.getString("url")).scheme in listOf("http","https"))
   val preferences=StoryDownloadWorker.prefs(context);val prior=JSONObject(preferences.getString(id,"{}") ?: "{}")
   val manager=WorkManager.getInstance(context)
   var existing=manager.getWorkInfosForUniqueWork("story-$id").get().any{!it.state.isFinished}
   if(existing && prior.optBoolean("wifiOnly",true)!=spec.optBoolean("wifiOnly",true)) {
    // The coordinator lock is distinct from the journal lock: cancellation must
    // let the old Worker finish its status write before acquiring its asset lock.
    pause(context,id)
    existing=false
   }
   if(!existing) {
    spec.put("generation",java.util.UUID.randomUUID().toString());spec.put("state","queued");spec.put("bytesWritten",0);preferences.edit().putString(id,spec.toString()).commit()
    val constraints=Constraints.Builder().setRequiredNetworkType(if(spec.optBoolean("wifiOnly",true))NetworkType.UNMETERED else NetworkType.CONNECTED).build()
    val work=OneTimeWorkRequestBuilder<StoryDownloadWorker>().setInputData(workDataOf("id" to id,"generation" to spec.getString("generation"))).setConstraints(constraints).addTag("story-media").build()
    manager.enqueueUniqueWork("story-$id",ExistingWorkPolicy.KEEP,work).result.get()
   }
  }
  }
  AsyncFunction("recoverAsset") { id:String, bytes:Long, ext:String ->
   require(Regex("^[a-f0-9]{64}$").matches(id) && bytes>0 && ext in listOf("mp3","png","jpg"))
   val context=requireNotNull(appContext.reactContext)
   val lock=StoryDownloadWorker.assetLocks.computeIfAbsent(id){java.util.concurrent.locks.ReentrantLock()}
   if(!lock.tryLock()) null else try {
    val root=File(context.noBackupFilesDir,"StoryMedia")
    val target=File(root,"$id.$ext");val partial=File(root,"$id.partial")
    fun valid(file:File):Boolean {
     if(!file.exists() || file.length()!=bytes)return false
     val digest=java.security.MessageDigest.getInstance("SHA-256")
     file.inputStream().use { input -> val buffer=ByteArray(262144);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)} }
     return digest.digest().joinToString(""){"%02x".format(it)}==id
    }
    val recovered=valid(target) || (valid(partial) && (!target.exists() || target.delete()) && partial.renameTo(target))
    if(recovered) Uri.fromFile(target).toString() else null
   } finally { lock.unlock() }
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
   synchronized(requests) { pause(requireNotNull(appContext.reactContext),id) }
  }
  AsyncFunction("forgetTransfer") { id:String -> StoryDownloadWorker.prefs(requireNotNull(appContext.reactContext)).edit().remove(id).commit() }
  AsyncFunction("retainTransfers") { ids:List<String> ->
   synchronized(requests) {
    val context=requireNotNull(appContext.reactContext)
    for(id in StoryDownloadWorker.prefs(context).all.keys)if(!ids.contains(id))pause(context,id)
   }
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
