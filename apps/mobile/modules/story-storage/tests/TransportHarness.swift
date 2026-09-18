import AVFoundation
import CryptoKit
// Standalone simulator app. Compiles the actual production transport/loopback sources,
// not a reimplementation. It deliberately has no Expo/JS runtime.
import UIKit

@main
final class Harness: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  let transport = NativeTransfers.shared
  let origin = "http://127.0.0.1:46371"
  var player: AVPlayer?
  func application(
    _ app: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .white
    window?.rootViewController = controller
    window?.makeKeyAndVisible()
    Task { do { try await run() } catch { log("FAIL \(error)") } }
    return true
  }
  func applicationDidEnterBackground(_ application: UIApplication) {
    log("NATIVE didEnterBackground")
    transport.handoffToBackground()
  }
  func applicationWillEnterForeground(_ application: UIApplication) {
    transport.enteredForeground()
  }
  func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) { transport.backgroundCompletion = completionHandler }
  func log(_ text: String) {
    print(text)
    let url = transport.root.appendingPathComponent("harness.log")
    let old = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    try? (old + text + "\n").write(to: url, atomically: true, encoding: .utf8)
  }
  func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: message, code: 1) }
  }
  func json(_ path: String) async throws -> [String: Any] {
    let (data, _) = try await URLSession.shared.data(from: URL(string: origin + path)!)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
  }
  func enqueue(_ spec: [String: Any]) async throws {
    let json = String(data: try JSONSerialization.data(withJSONObject: spec), encoding: .utf8)!
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      transport.enqueue(json) { e in if let e { c.resume(throwing: e) } else { c.resume() } }
    }
  }
  func pause(_ id: String) async {
    await withCheckedContinuation { c in transport.pause(id) { c.resume() } }
  }
  func wait(_ id: String, _ predicate: ([String: Any]) -> Bool) async throws {
    for _ in 0..<1200 {
      if predicate(transport.status(id)) { return }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw NSError(domain: "Timed out: \(transport.status(id))", code: 1)
  }
  func run() async throws {
    let args = ProcessInfo.processInfo.arguments
    let mode = args.last ?? "clean"
    let saved = transport.root.appendingPathComponent("fixture.json")
    let meta: [String: Any]
    if mode.hasPrefix("recover") {
      meta = try JSONSerialization.jsonObject(with: Data(contentsOf: saved)) as! [String: Any]
    } else {
      meta = try await json("/meta")
      try JSONSerialization.data(withJSONObject: meta).write(to: saved, options: .atomic)
    }
    let id = meta["id"] as! String
    let total = meta["bytes"] as! Int
    var spec: [String: Any] = [
      "id": id, "bytes": total, "extension": "mp3", "url": origin + "/media", "wifiOnly": false,
      "urgent": true, "progressive": true,
    ]
    if mode.contains("slow") { spec["url"] = origin + "/media?delay=0.25" }
    let final = transport.root.appendingPathComponent(id + ".mp3")
    let partial = transport.root.appendingPathComponent(id + ".partial")
    if mode.hasPrefix("recover") {
      if mode != "recover" {
        try require(transport.recover(id, total, "mp3") == nil, "Invalid file recovered")
        log("PASS \(mode) rejected offline")
        return
      }
      spec["url"] = "http://127.0.0.1:1/offline"
      try require(
        transport.recover(id, total, "mp3") != nil, "Native offline recovery returned nil")
      try require(
        transport.status(id)["state"] as? String == "complete", "Offline complete recovery failed")
      player = AVPlayer(url: final)
      player?.play()
      for _ in 0..<100 {
        if (player?.currentTime().seconds ?? 0) > 0.1 { break }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      try require((player?.currentTime().seconds ?? 0) > 0.1, "Recovered local playback did not advance")
      player?.pause()
      log("PASS offline complete recovery and file playback \(transport.status(id))")
      return
    }
    if mode != "resume" {
      await pause(id)
      transport.forget(id)
      try? FileManager.default.removeItem(at: final)
      try? FileManager.default.removeItem(at: partial)
      _ = try await json("/reset")
    }
    if mode == "corrupt" { spec["url"] = origin + "/media?mode=corrupt&delay=0" }
    if mode == "interrupt" { spec["url"] = origin + "/media?mode=interrupt" }
    let start = Date()
    try await enqueue(spec)
    let writer = transport.status(id)["taskId"] as? Int
    // Simulate an offline-package observer adopting the active playback transfer.
    try await enqueue(spec)
    try require(transport.status(id)["taskId"] as? Int == writer, "Adoption replaced the writer")
    if mode == "corrupt" {
      try await wait(id) { $0["state"] as? String == "failed" }
      try require(
        !FileManager.default.fileExists(atPath: final.path)
          && !FileManager.default.fileExists(atPath: partial.path), "Corrupt bytes retained")
      log("PASS checksum failure deletes prefix")
      return
    }
    if mode == "interrupt" {
      try await wait(id) { $0["state"] as? String == "failed" }
      log("Interrupted prefix \(transport.status(id))")
      spec["url"] = origin + "/media"
      try await enqueue(spec)
    } else {
      try await wait(id) { ($0["bytesWritten"] as? Int ?? 0) >= 65536 }
      if mode.hasPrefix("background") {
        log("READY background \(transport.status(id))")
      } else {
        let url = URL(string: SharedPlayback.shared.url(id))!
        player = AVPlayer(url: url)
        player?.play()
        for _ in 0..<200 {
          if (player?.currentTime().seconds ?? 0) > 0.1 { break }
          try await Task.sleep(nanoseconds: 100_000_000)
        }
        let position = player?.currentTime().seconds ?? 0
        try require(position > 0.1, "Playback did not advance")
        log(
          "START latencyMs=\(Int(Date().timeIntervalSince(start)*1000)) stats=\(try await json("/stats"))"
        )
        player?.pause()
        // Byte-range seek ahead must wait on the same sequential file, not fetch origin.
        var request = URLRequest(url: url)
        request.timeoutInterval = 120
        request.setValue("bytes=\(total-16384)-", forHTTPHeaderField: "Range")
        let seek = Task { try await URLSession.shared.data(for: request) }
        if ["pause", "bad-range", "ignore-range", "policy"].contains(mode) {
          await pause(id)
          let before =
            (try FileManager.default.attributesOfItem(atPath: partial.path)[.size] as! NSNumber)
            .intValue
          try await Task.sleep(nanoseconds: 200_000_000)
          let after =
            (try FileManager.default.attributesOfItem(atPath: partial.path)[.size] as! NSNumber)
            .intValue
          try require(before == after, "Writer moved after pause barrier")
          log("PAUSE durablePrefix=\(after)")
          if mode == "bad-range" { spec["url"] = origin + "/media?mode=bad-range" }
          if mode == "ignore-range" { spec["url"] = origin + "/media?mode=ignore" }
          if mode == "policy" { spec["wifiOnly"] = true }
          try await enqueue(spec)
          if mode == "policy" {
            try require(transport.status(id)["wifiOnly"] as? Bool == true, "Constrained policy lost")
            spec["wifiOnly"] = false
            try await enqueue(spec)
            try require(transport.status(id)["wifiOnly"] as? Bool == false, "Relaxed policy lost")
            log("PASS native policy replaced across writer-close barriers")
          }
          if mode == "bad-range" {
            try await wait(id) { $0["state"] as? String == "failed" }
            try require(!FileManager.default.fileExists(atPath: final.path), "Bad range promoted")
            seek.cancel()
            log("PASS malformed range rejected")
            return
          }
        }
        let result: (Data, URLResponse)
        do { result = try await seek.value } catch {
          // An intentional pause closes a blocked loopback read. Reconnect to the
          // same capability after resume; never fall back to the remote origin.
          if ["pause", "ignore-range", "policy"].contains(mode) {
            result = try await URLSession.shared.data(for: request)
          } else {
            throw error
          }
        }
        let (bytes, response) = result
        try require(
          bytes.count == 16384 && (response as? HTTPURLResponse)?.statusCode == 206,
          "Seek beyond prefix failed")
        try await wait(id) { $0["state"] as? String == "complete" }
        try require(
          bytes == Data(contentsOf: final).suffix(16384), "Seek bytes differ from durable file")
        log("PASS seek beyond prefix bytes=\(bytes.count)")
      }
    }
    try await wait(id) { $0["state"] as? String == "complete" }
    let bytes = try Data(contentsOf: final)
    try require(
      bytes.count == total
        && SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() == id,
      "Final checksum failed")
    let stats = try await json("/stats")
    if mode == "clean" || mode == "slow" {
      try require(
        stats["bytes"] as? Int == total && (stats["requests"] as? [Any])?.count == 1,
        "Duplicate origin stream")
    }
    log("PASS \(mode) complete \(transport.status(id)) stats=\(stats)")
  }
}
