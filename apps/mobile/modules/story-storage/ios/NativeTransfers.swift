import CryptoKit
import Foundation
import UIKit

// Stable URLSession identity and task descriptions let a new JS runtime adopt native work.
final class NativeTransfers: NSObject, URLSessionDownloadDelegate, URLSessionDataDelegate {
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
  private lazy var foreground: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpMaximumConnectionsPerHost = 2
    configuration.urlCache = nil
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()
  private var liveTasks: [String: URLSessionTask] = [:]
  private var writers: [Int: FileHandle] = [:]
  private var handoffs: [Int: String] = [:]
  func handoffToBackground() {
    foreground.getAllTasks { tasks in
      self.lock.lock()
      defer { self.lock.unlock() }
      for task in tasks {
        guard let id = task.taskDescription, self.current(task, id),
          self.jobs[id]?["state"] as? String == "running", var spec = self.jobs[id]
        else { continue }
        spec["progressive"] = false
        if let data = try? JSONSerialization.data(withJSONObject: spec),
          let json = String(data: data, encoding: .utf8)
        {
          self.handoffs[task.taskIdentifier] = json
          task.cancel()
        }
      }
    }
  }
  private func current(_ task: URLSessionTask, _ id: String) -> Bool {
    jobs[id]?["taskId"] as? Int == task.taskIdentifier
      && (jobs[id]?["foreground"] as? Bool ?? false) == (task is URLSessionDataTask)
  }
  private func allTasks(_ completion: @escaping ([URLSessionTask]) -> Void) {
    session.getAllTasks { background in self.foreground.getAllTasks { completion(background + $0) }
    }
  }
  override init() {
    super.init()
    if let data = try? Data(contentsOf: root.appendingPathComponent("transfers.json")),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]]
    {
      jobs = value
    }
    _ = session
    _ = foreground
  }
  private func save() {
    if let data = try? JSONSerialization.data(withJSONObject: jobs) {
      try? data.write(to: root.appendingPathComponent("transfers.json"), options: .atomic)
    }
  }
  func status(_ id: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    var status = jobs[id] ?? ["state": "missing"]
    if let task = liveTasks[id] { status["nativeTaskState"] = task.state.rawValue }
    return status
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
      allTasks { tasks in
        self.lock.lock()
        defer { self.lock.unlock() }
        let candidates = [self.liveTasks[id]].compactMap { $0 } + tasks
        if let existing = candidates.first(where: {
          $0.taskDescription == id && self.current($0, id)
            && ($0.state == .running || $0.state == .suspended)
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
        let partialFile = self.root.appendingPathComponent(id + ".partial")
        let partialSize =
          ((try? self.files.attributesOfItem(atPath: partialFile.path)[.size]) as? NSNumber)?
          .intValue ?? 0
        let expected = spec["bytes"] as? Int ?? 0
        if expected > 0 && partialSize >= expected {
          do {
            let handle = try FileHandle(forReadingFrom: partialFile)
            defer { try? handle.close() }
            var hash = SHA256()
            while let data = try handle.read(upToCount: 262144), !data.isEmpty {
              hash.update(data: data)
            }
            if partialSize == expected
              && hash.finalize().map({ String(format: "%02x", $0) }).joined() == id
            {
              let target = self.root.appendingPathComponent(
                id + "." + (spec["extension"] as? String ?? "mp3"))
              if self.files.fileExists(atPath: target.path) {
                try self.files.removeItem(at: target)
              }
              try self.files.moveItem(at: partialFile, to: target)
              spec["state"] = "complete"
              spec["bytesWritten"] = expected
              spec["uri"] = target.absoluteString
              self.jobs[id] = spec
              self.save()
              completion(nil)
              return
            }
            try self.files.removeItem(at: partialFile)
          } catch {
            completion(error)
            return
          }
        }
        let prior = self.jobs[id]
        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        let wifi = spec["wifiOnly"] as? Bool ?? true
        request.allowsCellularAccess = !wifi
        request.allowsExpensiveNetworkAccess = !wifi
        request.allowsConstrainedNetworkAccess = !wifi
        let task: URLSessionTask
        let progressive = spec["progressive"] as? Bool ?? false
        let partial = self.root.appendingPathComponent(id + ".partial")
        let offset =
          ((try? self.files.attributesOfItem(atPath: partial.path)[.size]) as? NSNumber)?.intValue
          ?? 0
        if offset > 0 {
          request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range")
          request.setValue("\"\(id)\"", forHTTPHeaderField: "If-Range")
        }
        spec["prefixBytes"] = offset
        spec["foreground"] = progressive
        if progressive {
          task = self.foreground.dataTask(with: request)
        } else if prior?["url"] as? String == urlString, prior?["wifiOnly"] as? Bool == wifi,
          let encoded = prior?["resume"] as? String,
          let resume = Data(base64Encoded: encoded)
        {
          task = self.session.downloadTask(withResumeData: resume)
        } else {
          task = self.session.downloadTask(with: request)
        }
        task.taskDescription = id
        self.liveTasks[id] = task
        task.priority =
          (spec["urgent"] as? Bool ?? false)
          ? URLSessionTask.highPriority : URLSessionTask.lowPriority
        spec["taskId"] = task.taskIdentifier
        spec["state"] = "queued"
        spec["bytesWritten"] = offset
        self.jobs[id] = spec
        self.save()
        self.startNext()
        completion(nil)
      }
    } catch { completion(error) }
  }
  private func startNext() {
    allTasks { tasks in
      self.lock.lock()
      defer { self.lock.unlock() }
      // Ignore/cancel orphan tasks left by a replaced writer or previous app process.
      var seen = Set<ObjectIdentifier>()
      let currentTasks = (tasks + Array(self.liveTasks.values)).filter { task in
        guard seen.insert(ObjectIdentifier(task)).inserted else { return false }
        guard let id = task.taskDescription, self.current(task, id),
          ["queued", "running"].contains(self.jobs[id]?["state"] as? String ?? "")
        else {
          task.cancel()
          return false
        }
        return true
      }
      var active = currentTasks.filter { $0.state == .running }.count
      for task in currentTasks.sorted(by: { $0.priority > $1.priority })
      where task.state == .suspended {
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
    allTasks { tasks in
      guard
        let task = tasks.first(where: {
          $0.taskDescription == id && ($0.state == .running || $0.state == .suspended)
        })
      else {
        completion()
        return
      }
      if !(task is URLSessionDownloadTask) {
        self.lock.lock()
        self.jobs[id]?["state"] = "paused"
        self.save()
        self.lock.unlock()
        task.cancel()
        completion()
        return
      }
      let download = task as! URLSessionDownloadTask
      download.cancel(byProducingResumeData: { data in
        self.lock.lock()
        defer { self.lock.unlock() }
        guard self.current(task, id) else {
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
    allTasks { tasks in
      self.lock.lock()
      defer { self.lock.unlock() }
      for task in tasks {
        guard let id = task.taskDescription, self.retained?.contains(id) == false else { continue }
        guard let download = task as? URLSessionDownloadTask else {
          self.jobs[id]?["state"] = "paused"
          task.cancel()
          continue
        }
        download.cancel(byProducingResumeData: { data in
          self.lock.lock()
          defer { self.lock.unlock() }
          guard self.current(task, id) else { return }
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
    guard current(downloadTask, id) else { return }
    let prefix = jobs[id]?["prefixBytes"] as? Int ?? 0
    jobs[id]?["bytesWritten"] = totalBytesWritten + Int64(prefix)
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let id = downloadTask.taskDescription else { return }
    lock.lock()
    defer { lock.unlock() }
    guard current(downloadTask, id) else { return }
    do {
      guard let response = downloadTask.response as? HTTPURLResponse,
        [200, 206].contains(response.statusCode), let expected = jobs[id]?["bytes"] as? Int
      else { throw NSError(domain: "StoryTransfer", code: 2) }
      var location = location
      if response.statusCode == 206 {
        let offset = jobs[id]?["prefixBytes"] as? Int ?? 0
        guard
          response.value(forHTTPHeaderField: "Content-Range")?.hasPrefix("bytes \(offset)-") == true
        else { throw NSError(domain: "StoryTransfer", code: 5) }
        let partial = root.appendingPathComponent(id + ".partial")
        if offset > 0 {
          let output = try FileHandle(forWritingTo: partial)
          let input = try FileHandle(forReadingFrom: location)
          defer {
            try? output.close()
            try? input.close()
          }
          try output.seekToEnd()
          while let data = try input.read(upToCount: 262144), !data.isEmpty {
            try output.write(contentsOf: data)
          }
          try output.synchronize()
          location = partial
        }
      }
      let size = (try files.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.intValue
      guard size == expected else { throw NSError(domain: "StoryTransfer", code: 3) }
      let handle = try FileHandle(forReadingFrom: location)
      defer { try? handle.close() }
      var hash = SHA256()
      while let data = try handle.read(upToCount: 262144), !data.isEmpty { hash.update(data: data) }
      let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
      guard digest == id else {
        try? files.removeItem(at: root.appendingPathComponent(id + ".partial"))
        throw NSError(domain: "StoryTransfer", code: 4)
      }
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
    guard let id = task.taskDescription else { return }
    if task is URLSessionDataTask {
      lock.lock()
      defer { lock.unlock() }
      try? writers.removeValue(forKey: task.taskIdentifier)?.close()
      guard current(task, id) else { return }
      if let next = handoffs.removeValue(forKey: task.taskIdentifier) {
        jobs[id]?["state"] = "paused"
        save()
        if retained?.contains(id) != false { enqueue(next) { _ in } }
        return
      }
      if error == nil {
        do {
          let file = root.appendingPathComponent(id + ".partial")
          let expected = jobs[id]?["bytes"] as? Int ?? 0
          let size = (try files.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue
          guard size == expected else { throw NSError(domain: "StoryTransfer", code: 3) }
          let handle = try FileHandle(forReadingFrom: file)
          defer { try? handle.close() }
          var hash = SHA256()
          while let data = try handle.read(upToCount: 262144), !data.isEmpty {
            hash.update(data: data)
          }
          guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == id else {
            try? files.removeItem(at: file)
            throw NSError(domain: "StoryTransfer", code: 4)
          }
          let target = root.appendingPathComponent(id + ".mp3")
          if files.fileExists(atPath: target.path) { try files.removeItem(at: target) }
          try files.moveItem(at: file, to: target)
          jobs[id]?["state"] = "complete"
          jobs[id]?["uri"] = target.absoluteString
        } catch { jobs[id]?["state"] = "failed" }
      } else if (error as NSError?)?.code != NSURLErrorCancelled {
        jobs[id]?["state"] = "failed"
      }
      save()
      return
    }
    guard let error else { return }
    lock.lock()
    defer { lock.unlock() }
    guard current(task, id) else { return }
    if (error as NSError).code != NSURLErrorCancelled {
      jobs[id]?["state"] = "failed"
      jobs[id]?["error"] = "Transfer interrupted (\((error as NSError).code))"
      save()
      startNext()
    }
  }
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    lock.lock()
    defer { lock.unlock() }
    guard let id = dataTask.taskDescription, current(dataTask, id),
      let response = response as? HTTPURLResponse, [200, 206].contains(response.statusCode)
    else {
      if let id = dataTask.taskDescription, current(dataTask, id) {
        jobs[id]?["state"] = "failed"
        save()
      }
      completionHandler(.cancel)
      return
    }
    do {
      let file = root.appendingPathComponent(id + ".partial")
      let offset = jobs[id]?["prefixBytes"] as? Int ?? 0
      if response.statusCode == 206 {
        guard
          response.value(forHTTPHeaderField: "Content-Range")?.hasPrefix("bytes \(offset)-") == true
        else { throw NSError(domain: "StoryTransfer", code: 5) }
      } else {
        files.createFile(atPath: file.path, contents: Data())
        jobs[id]?["prefixBytes"] = 0
      }
      if !files.fileExists(atPath: file.path) {
        files.createFile(atPath: file.path, contents: Data())
      }
      let handle = try FileHandle(forWritingTo: file)
      try handle.seekToEnd()
      writers[dataTask.taskIdentifier] = handle
      completionHandler(.allow)
    } catch {
      jobs[id]?["state"] = "failed"
      save()
      completionHandler(.cancel)
    }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    defer { lock.unlock() }
    guard let id = dataTask.taskDescription, current(dataTask, id),
      let output = writers[dataTask.taskIdentifier]
    else { return }
    do {
      let count = try output.offset()
      guard count + UInt64(data.count) <= UInt64(jobs[id]?["bytes"] as? Int ?? 0) else {
        throw NSError(domain: "StoryTransfer", code: 3)
      }
      try output.write(contentsOf: data)
      jobs[id]?["bytesWritten"] = Int(count) + data.count
    } catch {
      jobs[id]?["state"] = "failed"
      dataTask.cancel()
      save()
    }
  }

}
