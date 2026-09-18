import Darwin
import Foundation

// Loopback-only, per-launch capability URL. Reads the transfer's durable prefix;
// it never downloads from the origin or promotes unverified bytes to offline media.
final class SharedPlayback {
  static let shared = SharedPlayback()
  private let secret = UUID().uuidString
  private let slots = DispatchSemaphore(value: 4)
  private let server: Int32
  private let port: UInt16
  private init() {
    let socketFD = socket(AF_INET, SOCK_STREAM, 0)
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    address.sin_port = 0
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    var size = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socketFD, $0, &size) }
    }
    server = socketFD
    port = UInt16(bigEndian: address.sin_port)
    guard bound == 0, listen(server, 4) == 0 else { return }
    DispatchQueue.global(qos: .utility).async { [self] in
      while true {
        let client = accept(server, nil, nil)
        if client < 0 { return }
        if slots.wait(timeout: .now()) != .success {
          close(client)
          continue
        }
        DispatchQueue.global(qos: .userInitiated).async { [self] in
          defer {
            close(client)
            slots.signal()
          }
          var flag: Int32 = 1
          setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &flag, socklen_t(MemoryLayout<Int32>.size))
          var timeout = timeval(tv_sec: 15, tv_usec: 0)
          setsockopt(
            client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
          setsockopt(
            client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
          serve(client)
        }
      }
    }
  }
  func url(_ id: String) -> String { "http://127.0.0.1:\(port)/\(secret)/\(id).mp3" }
  private func sendAll(_ client: Int32, _ data: Data) -> Bool {
    data.withUnsafeBytes { bytes in
      var offset = 0
      while offset < bytes.count {
        let n = Darwin.send(
          client, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
        if n <= 0 { return false }
        offset += n
      }
      return true
    }
  }
  private func serve(_ client: Int32) {
    var header = Data()
    var byte: UInt8 = 0
    while !header.suffix(4).elementsEqual([13, 10, 13, 10]) {
      if header.count >= 8192 || recv(client, &byte, 1, 0) != 1 { return }
      header.append(byte)
    }
    guard let text = String(data: header, encoding: .utf8) else { return }
    let lines = text.components(separatedBy: "\r\n")
    let request = lines[0].components(separatedBy: " ")
    guard request.count == 3, ["GET", "HEAD"].contains(request[0]) else { return }
    let components = request[1].components(separatedBy: "/")
    guard components.count == 3, components[1] == secret, components[2].hasSuffix(".mp3") else {
      return
    }
    let id = String(components[2].dropLast(4))
    guard id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      let total = NativeTransfers.shared.status(id)["bytes"] as? Int, total > 0
    else { return }
    var start = 0
    var end = total - 1
    var status = 200
    if let range = lines.first(where: { $0.lowercased().hasPrefix("range:") })?.components(
      separatedBy: ":"
    ).dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces) {
      guard range.hasPrefix("bytes=") else { return }
      let r = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
      guard r.count == 2 else { return }
      if r[0].isEmpty {
        guard let suffix = Int(r[1]), suffix >= 0 else { return }
        start = max(0, total - suffix)
      } else {
        guard let offset = Int(r[0]), offset >= 0 else { return }
        start = offset
        if !r[1].isEmpty {
          guard let last = Int(r[1]), last >= 0 else { return }
          end = min(end, last)
        }
      }
      status = 206
    }
    if start > end || start >= total {
      _ = sendAll(
        client,
        Data(
          "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\(total)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .utf8))
      return
    }
    let rangeHeader = status == 206 ? "Content-Range: bytes \(start)-\(end)/\(total)\r\n" : ""
    guard
      sendAll(
        client,
        Data(
          "HTTP/1.1 \(status) OK\r\nContent-Type: audio/mpeg\r\nAccept-Ranges: bytes\r\nETag: \"\(id)\"\r\nCache-Control: no-store\r\nContent-Length: \(end-start+1)\r\n\(rangeHeader)Connection: close\r\n\r\n"
            .utf8))
    else { return }
    if request[0] == "HEAD" { return }
    let root = NativeTransfers.shared.root
    let final = root.appendingPathComponent(id + ".mp3")
    let partial = root.appendingPathComponent(id + ".partial")
    var position = start
    var deadline = Date().addingTimeInterval(120)
    while position <= end {
      let file = FileManager.default.fileExists(atPath: final.path) ? final : partial
      let size =
        ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?
        .intValue ?? 0
      if size > position {
        guard let handle = try? FileHandle(forReadingFrom: file) else { continue }
        defer { try? handle.close() }
        do {
          try handle.seek(toOffset: UInt64(position))
          guard
            let data = try handle.read(upToCount: min(65536, end - position + 1, size - position)),
            !data.isEmpty
          else { return }
          guard sendAll(client, data) else { return }
          position += data.count
          deadline = Date().addingTimeInterval(120)
        } catch { return }
      } else {
        let state = NativeTransfers.shared.status(id)["state"] as? String ?? "missing"
        if ["failed", "paused", "missing"].contains(state) || Date() > deadline { return }
        Thread.sleep(forTimeInterval: 0.025)
      }
    }
  }
}
