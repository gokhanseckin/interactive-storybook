import CryptoKit
import Foundation

// Stable URLSession identity and task descriptions let a new JS runtime adopt native work.
final class NativeTransfers: NSObject, URLSessionDownloadDelegate {
  var backgroundCompletion: (() -> Void)?
  static let shared = NativeTransfers()
  private let lock = NSRecursiveLock()
  private let files = FileManager.default
  private var retained: Set<String>?
  private var jobs: [String: [String: Any]] = [:]
  lazy var root: URL = {
    var url = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("StoryMedia", isDirectory: true)
    try? files.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
    return url
  }()
  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(
      withIdentifier: "com.masalyolu.story-transfers.v1")
    configuration.httpMaximumConnectionsPerHost = 2
    configuration.sessionSendsLaunchEvents = true
    configuration.isDiscretionary = false
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()
  override init() {
    super.init()
    if let data = try? Data(contentsOf: root.appendingPathComponent("transfers.json")),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]]
    {
      jobs = value
    }
    _ = session
  }
  private func save() {
    if let data = try? JSONSerialization.data(withJSONObject: jobs) {
      try? data.write(to: root.appendingPathComponent("transfers.json"), options: .atomic)
    }
  }
  func status(_ id: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return jobs[id] ?? ["state": "missing"]
  }
  func enqueue(_ json: String, completion: @escaping (Error?) -> Void) {
    do {
      guard let data = json.data(using: .utf8),
        var spec = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let id = spec["id"] as? String,
        id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
        let urlString = spec["url"] as? String, let url = URL(string: urlString),
        ["http", "https"].contains(url.scheme ?? ""),
        ["mp3", "png", "jpg"].contains(spec["extension"] as? String ?? "mp3")
      else { throw NSError(domain: "StoryTransfer", code: 1) }
      session.getAllTasks { tasks in
        self.lock.lock()
        defer { self.lock.unlock() }
        if let existing = tasks.first(where: {
          $0.taskDescription == id && ($0.state == .running || $0.state == .suspended)
        }) {
          existing.priority =
            (spec["urgent"] as? Bool ?? false)
            ? URLSessionTask.highPriority : URLSessionTask.lowPriority
          completion(nil)
          return
        }
        if self.jobs[id]?["state"] as? String == "complete",
          self.files.fileExists(
            atPath: self.root.appendingPathComponent(
              id + "." + (spec["extension"] as? String ?? "mp3")
            ).path)
        {
          completion(nil)
          return
        }
        let prior = self.jobs[id]
        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        let wifi = spec["wifiOnly"] as? Bool ?? true
        request.allowsCellularAccess = !wifi
        request.allowsExpensiveNetworkAccess = !wifi
        request.allowsConstrainedNetworkAccess = !wifi
        let task: URLSessionDownloadTask
        if prior?["url"] as? String == urlString, prior?["wifiOnly"] as? Bool == wifi,
          let encoded = prior?["resume"] as? String,
          let resume = Data(base64Encoded: encoded)
        {
          task = self.session.downloadTask(withResumeData: resume)
        } else {
          task = self.session.downloadTask(with: request)
        }
        task.taskDescription = id
        task.priority =
          (spec["urgent"] as? Bool ?? false)
          ? URLSessionTask.highPriority : URLSessionTask.lowPriority
        spec["taskId"] = task.taskIdentifier
        spec["state"] = "queued"
        spec["bytesWritten"] = 0
        self.jobs[id] = spec
        self.save()
        self.startNext()
        completion(nil)
      }
    } catch { completion(error) }
  }
  private func startNext() {
    session.getAllTasks { tasks in
      self.lock.lock()
      defer { self.lock.unlock() }
      var active = tasks.filter { $0.state == .running }.count
      for task in tasks.sorted(by: { $0.priority > $1.priority }) where task.state == .suspended {
        guard active < 2 else { break }
        guard let id = task.taskDescription, self.jobs[id]?["state"] as? String == "queued" else {
          continue
        }
        self.jobs[id]?["state"] = "running"
        task.resume()
        active += 1
      }
      self.save()
    }
  }
  func pause(_ id: String, completion: @escaping () -> Void) {
    session.getAllTasks { tasks in
      guard
        let task = tasks.first(where: {
          $0.taskDescription == id && ($0.state == .running || $0.state == .suspended)
        }) as? URLSessionDownloadTask
      else {
        completion()
        return
      }
      task.cancel(byProducingResumeData: { data in
        self.lock.lock()
        defer { self.lock.unlock() }
        guard self.jobs[id]?["taskId"] as? Int == task.taskIdentifier else {
          completion()
          return
        }
        self.jobs[id]?["state"] = "paused"
        if let data { self.jobs[id]?["resume"] = data.base64EncodedString() }
        self.save()
        self.startNext()
        completion()
      })
    }
  }
  func retain(_ ids: [String]) {
    lock.lock()
    retained = Set(ids)
    lock.unlock()
    session.getAllTasks { tasks in
      self.lock.lock()
      defer { self.lock.unlock() }
      for task in tasks {
        guard let id = task.taskDescription, self.retained?.contains(id) == false,
          let download = task as? URLSessionDownloadTask
        else { continue }
        download.cancel(byProducingResumeData: { data in
          self.lock.lock()
          defer { self.lock.unlock() }
          guard self.jobs[id]?["taskId"] as? Int == task.taskIdentifier else { return }
          self.jobs[id]?["state"] = "paused"
          if let data { self.jobs[id]?["resume"] = data.base64EncodedString() }
          self.save()
          self.startNext()
        })
      }
    }
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
      self.backgroundCompletion?()
      self.backgroundCompletion = nil
    }
  }
  func forget(_ id: String) {
    lock.lock()
    defer { lock.unlock() }
    jobs.removeValue(forKey: id)
    save()
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard let id = downloadTask.taskDescription else { return }
    lock.lock()
    defer { lock.unlock() }
    guard jobs[id]?["taskId"] as? Int == downloadTask.taskIdentifier else { return }
    jobs[id]?["bytesWritten"] = totalBytesWritten
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let id = downloadTask.taskDescription else { return }
    lock.lock()
    defer { lock.unlock() }
    guard jobs[id]?["taskId"] as? Int == downloadTask.taskIdentifier else { return }
    do {
      guard let response = downloadTask.response as? HTTPURLResponse,
        [200, 206].contains(response.statusCode), let expected = jobs[id]?["bytes"] as? Int
      else { throw NSError(domain: "StoryTransfer", code: 2) }
      let size = (try files.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.intValue
      guard size == expected else { throw NSError(domain: "StoryTransfer", code: 3) }
      let handle = try FileHandle(forReadingFrom: location)
      defer { try? handle.close() }
      var hash = SHA256()
      while let data = try handle.read(upToCount: 262144), !data.isEmpty { hash.update(data: data) }
      let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
      guard digest == id else { throw NSError(domain: "StoryTransfer", code: 4) }
      let target = root.appendingPathComponent(
        id + "." + (jobs[id]?["extension"] as? String ?? "mp3"))
      if files.fileExists(atPath: target.path) { try files.removeItem(at: target) }
      try files.moveItem(at: location, to: target)
      jobs[id]?["state"] = "complete"
      jobs[id]?["bytesWritten"] = expected
      jobs[id]?["uri"] = target.absoluteString
      jobs[id]?.removeValue(forKey: "resume")
      save()
      startNext()
    } catch {
      jobs[id]?["state"] = "failed"
      jobs[id]?["error"] = "Incomplete, expired or corrupt download"
      save()
      startNext()
    }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer { startNext() }
    guard let error, let id = task.taskDescription else { return }
    lock.lock()
    defer { lock.unlock() }
    guard jobs[id]?["taskId"] as? Int == task.taskIdentifier else { return }
    if (error as NSError).code != NSURLErrorCancelled {
      jobs[id]?["state"] = "failed"
      jobs[id]?["error"] = "Transfer interrupted (\((error as NSError).code))"
      save()
      startNext()
    }
  }
}
