package expo.modules.storystorage
import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Semaphore
import org.json.JSONObject

class StoryDownloadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
 @Volatile private var activeConnection: HttpURLConnection? = null
 override fun onStopped() {
  activeConnection?.disconnect()
  super.onStopped()
 }
 companion object { val slots = Semaphore(2); val assetLocks = java.util.concurrent.ConcurrentHashMap<String,java.util.concurrent.locks.ReentrantLock>(); fun prefs(c:Context)=c.getSharedPreferences("story-transfers",Context.MODE_PRIVATE) }
 override fun doWork(): Result {
  val id=inputData.getString("id") ?: return Result.failure()
  val assetLock=assetLocks.computeIfAbsent(id){java.util.concurrent.locks.ReentrantLock()}
  assetLock.lock()
  try { return transfer(id) } finally { assetLock.unlock() }
 }
 private fun transfer(id:String): Result {
  val preferences=prefs(applicationContext)
  val spec=JSONObject(preferences.getString(id,"{}") ?: "{}")
  val generation=inputData.getString("generation") ?: ""
  if(generation != spec.optString("generation", "")) return Result.failure()
  val root=File(applicationContext.noBackupFilesDir,"StoryMedia");root.mkdirs()
  val partial=File(root,"$id.partial");val target=File(root,id+"."+spec.optString("extension","mp3"))
  slots.acquire()
  var connection:HttpURLConnection?=null
  fun status(state:String,bytes:Long=partial.length()) { synchronized(StoryDownloadWorker::class.java){val updated=JSONObject(preferences.getString(id,spec.toString()) ?: spec.toString());if(updated.optString("generation", "") != generation)return;updated.put("state",state);updated.put("bytesWritten",bytes);if(state=="complete")updated.put("uri",android.net.Uri.fromFile(target).toString());preferences.edit().putString(id,updated.toString()).commit()} }
  try {
   if(isStopped)return Result.failure()
   val expected=spec.getLong("bytes")
   require(expected > 0)
   fun valid(file:File):Boolean {
    if(!file.exists() || file.length()!=expected)return false
    val hash=MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input -> val buffer=ByteArray(262144);while(true){val n=input.read(buffer);if(n<0)break;hash.update(buffer,0,n)} }
    return hash.digest().joinToString(""){"%02x".format(it)}==id
   }
   if(valid(target)){status("complete",expected);return Result.success()}
   if(target.exists())check(target.delete())
   // Process death may occur after the last write and before promotion. Do not request bytes=size-.
   if(partial.length()>=expected && partial.exists()) {
    val hash=MessageDigest.getInstance("SHA-256")
    FileInputStream(partial).use { input -> val buffer=ByteArray(262144);while(true){val n=input.read(buffer);if(n<0)break;hash.update(buffer,0,n)} }
    if(partial.length()==expected && hash.digest().joinToString(""){"%02x".format(it)}==id) {
     if(target.exists())target.delete();check(partial.renameTo(target));status("complete",target.length());return Result.success()
    }
    partial.delete()
   }
   if(root.usableSpace < maxOf(0L,expected-partial.length()) + 20L*1024*1024)throw java.io.IOException("Not enough storage")
   status("running")
   connection=URL(spec.getString("url")).openConnection() as HttpURLConnection
   activeConnection=connection
   connection.setRequestProperty("Accept-Encoding","identity")
   connection.connectTimeout=30000;connection.readTimeout=30000
   val offset=partial.length()
   if(offset>0){connection.setRequestProperty("Range","bytes=$offset-");connection.setRequestProperty("If-Range","\"$id\"")}
   val code=connection.responseCode
   if(code!=200&&code!=206){status("failed");return Result.failure()}
   if(connection.getHeaderField("Content-Encoding")?.let { it != "identity" } == true)throw java.io.IOException("Encoded media")
   if(code==206 && connection.getHeaderField("Content-Range") != "bytes $offset-${expected-1}/$expected")throw java.io.IOException("Invalid resume range")
   val append=code==206&&offset>0
   connection.inputStream.use { input -> FileOutputStream(partial,append).use { output ->
    val buffer=ByteArray(65536);var written=if(append)offset else 0L;var last=0L
    while(true){if(isStopped){status("paused",written);return Result.failure()};val n=input.read(buffer);if(n<0)break;if(written+n>expected)throw java.io.IOException("Oversized media");output.write(buffer,0,n);written+=n;if(System.currentTimeMillis()-last>500){status("running",written);last=System.currentTimeMillis()}}
    output.fd.sync()
   }}
   if(partial.length()!=spec.getLong("bytes")){status("failed");return Result.failure()}
   val digest=MessageDigest.getInstance("SHA-256");FileInputStream(partial).use {input->val buffer=ByteArray(262144);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)}}
   if(digest.digest().joinToString(""){"%02x".format(it)}!=id){partial.delete();status("failed");return Result.failure()}
   if(isStopped){status("paused");return Result.failure()}
   if(target.exists())target.delete();check(partial.renameTo(target));status("complete",target.length());return Result.success()
  }catch(e:Exception){status(if(isStopped)"paused" else "failed");return Result.failure()}finally{connection?.disconnect();activeConnection=null;slots.release()}
 }
}
