package expo.modules.storystorage

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import org.json.JSONObject

// AV/ExoPlayer reads the same sequential partial file that WorkManager is writing.
// No upstream HTTP requests originate here: ranges and seeks reuse durable bytes.
class SharedPlayback private constructor(private val context: Context) {
 companion object {
  @Volatile private var instance: SharedPlayback? = null
  fun get(context: Context): SharedPlayback = synchronized(this) {
   instance ?: SharedPlayback(context.applicationContext).also { instance = it }
  }
 }
 private val secret = UUID.randomUUID().toString()
 private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
 private val slots = Semaphore(4)
 private val readers = Executors.newFixedThreadPool(4)
 init {
  Thread({ while (!server.isClosed) {
   val client = try { server.accept() } catch (_: Exception) { break }
   if (!slots.tryAcquire()) { client.close(); continue }
   readers.execute { try { serve(client) } catch (_: Exception) {} finally { client.close(); slots.release() } }
  } }, "story-loopback").apply { isDaemon = true; start() }
 }
 fun url(id: String): String = "http://127.0.0.1:${server.localPort}/$secret/$id.mp3"
 private fun serve(client: Socket) {
  client.soTimeout = 15000
  val input = client.getInputStream()
  val header = StringBuilder()
  while (!header.endsWith("\r\n\r\n")) {
   val byte = input.read(); if (byte < 0 || header.length >= 8192) return
   header.append(byte.toChar())
  }
  val lines = header.toString().split("\r\n")
  val request = lines[0].split(" ")
  if (request.size != 3 || request[0] !in listOf("GET", "HEAD")) return
  val match = Regex("^/$secret/([a-f0-9]{64})\\.mp3$").matchEntire(request[1]) ?: return
  val id = match.groupValues[1]
  val spec = JSONObject(StoryDownloadWorker.prefs(context).getString(id, "{}") ?: "{}")
  val total = spec.optLong("bytes", 0); if (total <= 0) return
  var start = 0L; var end = total - 1; var status = 200
  val range = lines.firstOrNull { it.startsWith("Range:", true) }?.substringAfter(":")?.trim()
  if (range != null) {
   val r = Regex("bytes=(\\d*)-(\\d*)").matchEntire(range)
   if (r == null || (r.groupValues[1].isEmpty() && r.groupValues[2].isEmpty())) return
   if (r.groupValues[1].isEmpty()) start = maxOf(0, total - (r.groupValues[2].toLongOrNull() ?: return))
   else { start = r.groupValues[1].toLongOrNull() ?: return; if (r.groupValues[2].isNotEmpty()) end = minOf(end, r.groupValues[2].toLongOrNull() ?: return) }
   status = 206
  }
  val output = client.getOutputStream()
  if (start > end || start >= total) { output.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$total\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return }
  output.write(("HTTP/1.1 $status OK\r\nContent-Type: audio/mpeg\r\nAccept-Ranges: bytes\r\nETag: \"$id\"\r\nCache-Control: no-store\r\nContent-Length: ${end-start+1}\r\n" + (if (status == 206) "Content-Range: bytes $start-$end/$total\r\n" else "") + "Connection: close\r\n\r\n").toByteArray())
  if (request[0] == "HEAD") return
  val root = File(context.noBackupFilesDir, "StoryMedia")
  val final = File(root, "$id.mp3"); val partial = File(root, "$id.partial")
  var position = start; var deadline = System.currentTimeMillis() + 120000
  val buffer = ByteArray(65536)
  while (position <= end) {
   val state = JSONObject(StoryDownloadWorker.prefs(context).getString(id,"{}") ?: "{}").optString("state")
   val file = if (final.exists()) final else partial
   if (file.exists() && file.length() > position) {
    try { RandomAccessFile(file, "r").use { f -> f.seek(position); val n=f.read(buffer,0,minOf(buffer.size.toLong(),end-position+1,file.length()-position).toInt()); if(n>0){output.write(buffer,0,n);position+=n;deadline=System.currentTimeMillis()+120000} } }
    catch (_: java.io.FileNotFoundException) { continue } // atomic promotion raced this read
   } else {
    if (state in listOf("failed","paused","missing") || System.currentTimeMillis()>deadline) return
    Thread.sleep(25)
   }
  }
 }
}
